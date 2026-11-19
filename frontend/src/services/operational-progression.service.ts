import { z } from "zod";
import { api } from "./api";
import {
  activationSchema,
  operationalRevocationSchema,
  processAutomaticSchema,
  operationalStatusSchema,
  operationalReceiptSchema,
  automaticHistorySchema,
  automaticApplicationSchema,
} from "../schemas/operational-progression.schema";
import type {
  OperationalActivation,
  OperationalRevocation,
} from "../types/operational-progression";
const root = "/progression/automatic",
  path = (id: string) => root + "/consents/" + z.uuid().parse(id);
export const operationalProgressionService = {
  async status(id: string) {
    return operationalStatusSchema.parse((await api.get(path(id))).data);
  },
  async activate(id: string, input: OperationalActivation) {
    return operationalReceiptSchema.parse(
      (await api.post(path(id) + "/activations", activationSchema.parse(input)))
        .data,
    );
  },
  async revoke(id: string, input: OperationalRevocation) {
    return operationalReceiptSchema.parse(
      (
        await api.post(
          path(id) + "/revocations",
          operationalRevocationSchema.parse(input),
        )
      ).data,
    );
  },
  async process(
    id: string,
    input: {
      intentId: string;
    },
  ) {
    return operationalReceiptSchema.parse(
      (
        await api.post(
          path(id) + "/process",
          processAutomaticSchema.parse(input),
        )
      ).data,
    );
  },
  async operation(id: string) {
    return operationalReceiptSchema.parse(
      (await api.get(root + "/operations/" + z.uuid().parse(id))).data,
    );
  },
  async history(id: string, page = 1) {
    return automaticHistorySchema.parse(
      (
        await api.get(path(id) + "/history", {
          params: { page: z.number().int().positive().parse(page), limit: 20 },
        })
      ).data,
    );
  },
  async application(id: string) {
    return automaticApplicationSchema.parse(
      (
        await api.get(
          root + "/recommendations/" + z.uuid().parse(id) + "/receipt",
        )
      ).data,
    );
  },
};
