import type {
  ConsentAcceptanceChallenge,
  ConsentAcceptanceEvidence,
} from '../../models/progression/consent-acceptance.model';
import { policyProjection } from '../../domain/progression/recommendation-query.policy';
import type {
  ConsentSnapshot,
  ConsentInspection,
  ConsentReceipt,
  ConsentPreview,
  ConsentListResult,
  ConsentCandidates,
} from '../../models/progression/automation-consent.model';
import { changedConsentConditions } from '../../domain/progression/automation-consent.policy';
export class AutomationConsentPresenter {
  private contract(c: ConsentSnapshot['contract']) {
    return {
      schemaVersion: c.schemaVersion,
      exerciseId: c.exerciseId,
      trainingPlanId: c.trainingPlanId,
      policy: policyProjection(c.policy)!,
      historyWindowDays: c.historyWindowDays,
      limits: {
        unit: c.limits.unit,
        loadMeaning: c.limits.loadMeaning,
        maximumAbsoluteIncrement: c.limits.maximumAbsoluteIncrement,
        maximumPercentIncrement: c.limits.maximumPercentIncrement,
        maximumLoad: c.limits.maximumLoad,
        maximumApplicationsPerWeek: c.limits.maximumApplicationsPerWeek,
        weekStartsOn: c.limits.weekStartsOn,
      },
      selector: {
        kind: c.selector.kind,
        prescriptionIds: [...c.selector.prescriptionIds],
        futureOnly: c.selector.futureOnly,
        planState: c.selector.planState,
        versionPolicy: c.selector.versionPolicy,
      },
      validity: {
        startsAt: c.validity.startsAt,
        endsAt: c.validity.endsAt,
        timeZone: c.validity.timeZone,
      },
      termsVersion: c.termsVersion,
      provenance: {
        source: c.provenance.source,
        reference: c.provenance.reference,
      },
    };
  }
  private setting(s: ConsentSnapshot['bindings'][number]['selected'] | null) {
    return s
      ? {
          minSuccessfulSessions: s.minSuccessfulSessions,
          targetRpeMin: s.targetRpeMin,
          targetRpeMax: s.targetRpeMax,
          incrementAbsolute: s.incrementAbsolute,
          incrementPercent: s.incrementPercent,
          maxIncrementPercent: s.maxIncrementPercent,
          maxLoad: s.maxLoad,
        }
      : null;
  }
  snapshot(s: ConsentSnapshot) {
    return {
      schemaVersion: s.schemaVersion,
      engine: {
        recommendation: s.engine.recommendation,
        numeric: s.engine.numeric,
      },
      contract: this.contract(s.contract),
      destinations: s.destinations.map((d) => ({
        prescriptionId: d.prescriptionId,
        exerciseId: d.exerciseId,
        planId: d.planId,
        weekId: d.weekId,
        dayId: d.dayId,
        recordedPlanVersion: d.recordedPlanVersion,
      })),
      bindings: s.bindings.map((b) => ({
        planId: b.planId,
        selected: this.setting(b.selected),
      })),
      humanAcceptance: s.humanAcceptance,
      operationalAuthorization: s.operationalAuthorization,
    };
  }
  private evidence(e: ConsentAcceptanceEvidence | null | undefined) {
    return e
      ? {
          schemaVersion: e.schemaVersion,
          challengeId: e.challengeId,
          acceptedVersion: e.acceptedVersion,
          contractKey: e.contractKey,
          conditionsKey: e.conditionsKey,
          contextKey: e.contextKey,
          termsVersion: e.termsVersion,
          presentationVersion: e.presentationVersion,
          conditionsPresented: e.conditionsPresented,
          acknowledgments: {
            policy: e.acknowledgments.policy,
            limits: e.acknowledgments.limits,
            destinations: e.acknowledgments.destinations,
            validity: e.acknowledgments.validity,
            revocation: e.acknowledgments.revocation,
          },
          provenance: e.provenance,
          acceptanceKey: e.acceptanceKey,
        }
      : null;
  }
  challenge(c: ConsentAcceptanceChallenge) {
    return {
      id: c.id,
      consentId: c.consentId,
      version: c.version,
      state: c.state,
      contractKey: c.contractKey,
      conditionsKey: c.conditionsKey,
      contextKey: c.contextKey,
      termsVersion: c.termsVersion,
      presentationVersion: c.presentationVersion,
      schemaVersion: 'recurring-consent-acceptance-v1' as const,
      scope: 'RECURRING_BOUNDED' as const,
      snapshot: this.snapshot(c.snapshot),
      requiredAcknowledgments: [
        'policy',
        'limits',
        'destinations',
        'validity',
        'revocation',
      ],
      issuedAt: c.issuedAt.toISOString(),
      expiresAt: c.expiresAt.toISOString(),
      executionAuthorized: false as const,
    };
  }
  receipt(e: ConsentReceipt) {
    return {
      id: e.id,
      consentId: e.consentId,
      intentId: e.intentId,
      action: e.action,
      fromVersion: e.fromVersion,
      version: e.version,
      fromState: e.fromState,
      state: e.state,
      snapshot: this.snapshot(e.snapshot),
      recordedAt: e.recordedAt.toISOString(),
      reason: e.reason,
      acceptanceEvidence: this.evidence(e.acceptanceEvidence),
      executionAuthorized: false as const,
    };
  }
  inspection(v: ConsentInspection) {
    const current = v.currentSnapshot ?? null;
    const accepted = v.events.find((e) => e.action === 'ACCEPT');
    const changed = current
      ? changedConsentConditions(v.snapshot, current)
      : ['CURRENT_CONDITIONS_UNAVAILABLE'];
    return {
      id: v.id,
      exerciseId: v.exerciseId,
      trainingPlanId: v.trainingPlanId,
      state: v.state,
      version: v.version,
      snapshot: this.snapshot(v.snapshot),
      currentSnapshot: current ? this.snapshot(current) : null,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      revokedAt: v.revokedAt?.toISOString() ?? null,
      effectiveState: v.effectiveState,
      currentConfiguration: v.currentConfiguration,
      conditionChanges: current
        ? changedConsentConditions(v.snapshot, current)
        : ['CURRENT_CONDITIONS_UNAVAILABLE'],
      inspectedAt: v.inspectedAt.toISOString(),
      events: v.events.map((e) => this.receipt(e)),
      acceptance: {
        available:
          v.state === 'PENDING_CONFIRMATION' &&
          v.effectiveState !== 'EXPIRED' &&
          changed.length === 0,
        reason: accepted
          ? 'ALREADY_RECORDED'
          : v.state === 'REVOKED'
            ? 'CONSENT_REVOKED'
            : v.effectiveState === 'EXPIRED'
              ? 'CONSENT_EXPIRED'
              : changed.length
                ? 'CONDITIONS_CHANGED'
                : 'AVAILABLE',
        schemaVersion: 'recurring-consent-acceptance-v1' as const,
        scope: 'RECURRING_BOUNDED' as const,
        humanAcceptance: accepted
          ? ('RECORDED' as const)
          : ('NOT_RECORDED' as const),
        recordedEventId: accepted?.id ?? null,
        recordedAt: accepted?.recordedAt.toISOString() ?? null,
      },
      executionAuthorized: false as const,
    };
  }
  preview(v: ConsentPreview) {
    return {
      snapshot: this.snapshot(v.snapshot),
      inspectedAt: v.inspectedAt.toISOString(),
      executionAuthorized: false as const,
      acceptanceAvailable: false as const,
    };
  }
  list(v: ConsentListResult) {
    return {
      items: v.items.map((i) => ({
        ...i,
        startsAt: i.startsAt.toISOString(),
        endsAt: i.endsAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
        executionAuthorized: false as const,
      })),
      page: v.page,
      limit: v.limit,
      total: v.total,
    };
  }
  candidates(v: ConsentCandidates) {
    return {
      items: v.items.map((i) => ({ ...i })),
      hasMore: v.hasMore,
      page: v.page,
      settings: v.settings.map((s) => ({
        planId: s.planId,
        status: s.status,
        scope: s.scope,
        reasons: s.reasons,
        selected: this.setting(s.selected),
      })),
      tasks: v.tasks.map((t) => ({ ...t })),
      tasksTruncated: v.tasksTruncated,
      futureApplicabilityVerified: false as const,
    };
  }
}
