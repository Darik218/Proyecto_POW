import { defineStore } from "pinia";
import { ref, shallowRef, watch, onScopeDispose } from "vue";
import { useAuthStore } from "./auth.store";
import { operationalProgressionService as service } from "../services/operational-progression.service";
import { progressionError } from "../services/progression.service";
import {
  rememberOperationalIntent,
  recoverOperationalIntent,
  forgetOperationalIntent,
  type PendingOperational,
} from "../utils/operational-intents";
import type {
  OperationalStatus,
  OperationalReceipt,
  AutomaticHistory,
  OperationalActivation,
  OperationalRevocation,
} from "../types/operational-progression";
const storage = () => {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
};
type Command =
  | {
      action: "ACTIVATE";
      id: string;
      input: OperationalActivation;
    }
  | {
      action: "REVOKE";
      id: string;
      input: OperationalRevocation;
    }
  | {
      action: "CHECK";
      id: string;
      input: {
        intentId: string;
      };
    };
export const useOperationalProgressionStore = defineStore(
  "operational-progression",
  () => {
    const auth = useAuthStore(),
      status = shallowRef<OperationalStatus | null>(null),
      receipt = shallowRef<OperationalReceipt | null>(null),
      history = shallowRef<AutomaticHistory | null>(null),
      pending = shallowRef<PendingOperational | null>(null),
      busy = ref(false),
      error = shallowRef<ReturnType<typeof progressionError> | null>(null),
      notice = ref("");
    let viewedId = "";
    let epoch = 0,
      memory: Command | null = null,
      timer: ReturnType<typeof setTimeout> | undefined,
      stamp = "";
    const context = () =>
      `${auth.user?.id ?? ""}:${auth.getSessionContextId() ?? ""}:${auth.getSessionGeneration()}`;
    function drop() {
      memory = null;
      pending.value = null;
      clearTimeout(timer);
      forgetOperationalIntent(storage());
    }
    function retain() {
      clearTimeout(timer);
      if (pending.value) {
        timer = setTimeout(
          () => {
            drop();
            notice.value =
              "Caducó el identificador local. Consulta el historial antes de iniciar otra operación.";
          },
          Math.max(0, 30 * 60000 - (Date.now() - pending.value.createdAt)),
        );
        (
          timer as unknown as {
            unref?: () => void;
          }
        ).unref?.();
      }
    }
    watch(
      () => [auth.user?.id, auth.status, auth.accessToken],
      () => {
        const next = context();
        if (next === stamp) return;
        stamp = next;
        epoch++;
        status.value = null;
        history.value = null;
        receipt.value = null;
        busy.value = false;
        error.value = null;
        notice.value = "";
        memory = null;
        const id = auth.user?.id,
          session = auth.getSessionContextId();
        pending.value =
          id && session
            ? recoverOperationalIntent(storage(), id, session, Date.now())
            : null;
        if (!id || !session) forgetOperationalIntent(storage());
        retain();
      },
      { immediate: true, flush: "sync" },
    );
    onScopeDispose(() => clearTimeout(timer));
    async function read<T>(
      operation: () => Promise<T>,
      accept: (value: T) => void,
    ) {
      if (busy.value) return;
      const n = ++epoch,
        s = context();
      busy.value = true;
      error.value = null;
      try {
        const value = await operation();
        if (n === epoch && s === context()) {
          accept(value);
          return value;
        }
      } catch (e) {
        if (n === epoch && s === context()) error.value = progressionError(e);
      } finally {
        if (n === epoch && s === context()) busy.value = false;
      }
    }
    async function refresh(id: string, n: number, s: string) {
      if (viewedId && viewedId !== id) return;
      const current = await service.status(id);
      if (n !== epoch || s !== context()) return;
      status.value = current;
      const runs = await service.history(id);
      if (n === epoch && s === context()) history.value = runs;
    }
    async function send() {
      if (!memory || busy.value) return;
      const op = structuredClone(memory),
        n = ++epoch,
        s = context();
      busy.value = true;
      error.value = null;
      let confirmed = false;
      try {
        const value =
          op.action === "ACTIVATE"
            ? await service.activate(op.id, op.input)
            : op.action === "REVOKE"
              ? await service.revoke(op.id, op.input)
              : await service.process(op.id, op.input);
        if (n !== epoch || s !== context()) return;
        receipt.value = value;
        confirmed = true;
        notice.value =
          "Operación confirmada. Los resultados BLOCKED no son aplicaciones.";
        await refresh(op.id, n, s);
        if (n === epoch && s === context()) drop();
      } catch (e) {
        if (n === epoch && s === context()) {
          const parsed = progressionError(e);
          error.value = {
            ...parsed,
            uncertain:
              confirmed ||
              parsed.uncertain ||
              parsed.code === "INVALID_RESPONSE",
          };
          if (!error.value.uncertain) drop();
        }
      } finally {
        if (n === epoch && s === context()) busy.value = false;
      }
    }
    async function command(action: Command["action"], confirmed = false) {
      const v = status.value,
        accountId = auth.user?.id,
        sessionContext = auth.getSessionContextId();
      if (!v || !accountId || !sessionContext || busy.value || pending.value)
        return;
      const intentId = crypto.randomUUID();
      if (action === "ACTIVATE") {
        if (
          !confirmed ||
          !v.acceptanceEventId ||
          v.effectiveState !== "INACTIVE" ||
          v.executionAuthorized
        )
          return;
        memory = {
          action,
          id: v.consentId,
          input: {
            intentId,
            expectedConsentVersion: v.consentVersion,
            expectedContractKey: v.contractKey,
            acceptanceEventId: v.acceptanceEventId,
            activationTermsVersion: v.activationTermsVersion,
            conditionsKey: v.conditionsKey,
            confirmActivation: true,
          },
        };
      } else if (action === "REVOKE") {
        if (!confirmed || !v.grant || v.grant.state !== "ACTIVE") return;
        memory = {
          action,
          id: v.consentId,
          input: {
            intentId,
            grantId: v.grant.id,
            expectedGrantVersion: v.grant.version,
            confirmRevocation: true,
          },
        };
      } else {
        if (!v.executionAuthorized) return;
        memory = { action, id: v.consentId, input: { intentId } };
      }
      pending.value = {
        accountId,
        sessionContext,
        intentId,
        consentId: v.consentId,
        action,
        createdAt: Date.now(),
      };
      rememberOperationalIntent(storage(), pending.value);
      retain();
      await send();
    }
    async function recover() {
      const p = pending.value;
      if (!p || busy.value) return;
      const n = ++epoch,
        s = context();
      busy.value = true;
      error.value = null;
      try {
        let value: OperationalReceipt;
        try {
          value = await service.operation(p.intentId);
        } catch (e) {
          if (n !== epoch || s !== context()) return;
          if (
            progressionError(e).code !== "SOURCE_BUSY" ||
            p.action !== "CHECK" ||
            !p.consentId
          )
            throw e;
          // Explicit recovery resumes the server's persisted batch with its original identity.
          // Activation and revocation cannot be reconstructed from identifiers alone.
          notice.value =
            "Reanudando el procesamiento pendiente con la misma intención y el mismo lote guardado.";
          value = await service.process(p.consentId, { intentId: p.intentId });
        }
        if (n !== epoch || s !== context()) return;
        receipt.value = value;
        await refresh(value.consentId, n, s);
        if (n === epoch && s === context()) {
          drop();
          notice.value =
            "Resultado recuperado; se muestra el estado actual del permiso.";
        }
      } catch (e) {
        if (n === epoch && s === context()) {
          error.value = progressionError(e);
          notice.value =
            "No se reenviará automáticamente la operación. Conserva esta intención y vuelve a consultar.";
        }
      } finally {
        if (n === epoch && s === context()) busy.value = false;
      }
    }
    function open(id: string) {
      viewedId = id;
      if (receipt.value?.consentId !== id) receipt.value = null;
      epoch++;
      busy.value = false;
      status.value = null;
      history.value = null;
      return read(
        async () => ({
          current: await service.status(id),
          runs: await service.history(id),
        }),
        ({ current, runs }) => {
          status.value = current;
          history.value = runs;
        },
      );
    }
    return {
      status,
      receipt,
      history,
      pending,
      busy,
      error,
      notice,
      command,
      recover,
      open,
      loadHistory: (page: number) => {
        const id = status.value?.consentId;
        if (id)
          return read(
            () => service.history(id, page),
            (v) => {
              history.value = v;
            },
          );
      },
      retry: send,
      canRetry: () => memory !== null,
    };
  },
);
