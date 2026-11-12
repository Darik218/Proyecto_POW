import type {
  OperationalStatus,
  OperationalCommandReceipt,
  AutomaticRunPublic,
  GrantPublic,
} from '../../models/progression/automatic-progression.model';
export class AutomaticProgressionPresenter {
  grant(g: GrantPublic) {
    return {
      id: g.id,
      consentId: g.consentId,
      state: g.state,
      version: g.version,
      activatedAt: g.activatedAt,
      revokedAt: g.revokedAt,
    };
  }
  run(r: AutomaticRunPublic) {
    return {
      id: r.id,
      grantId: r.grantId,
      recommendationId: r.recommendationId,
      result: r.result,
      reasons: [...r.reasons],
      applicationId: r.applicationId,
      previousLoad: r.previousLoad,
      appliedLoad: r.appliedLoad,
      unit: r.unit,
      recordedAt: r.recordedAt,
      cycleKey: r.cycleKey,
    };
  }
  status(s: OperationalStatus) {
    return {
      consentId: s.consentId,
      consentVersion: s.consentVersion,
      contractKey: s.contractKey,
      acceptanceEventId: s.acceptanceEventId,
      activationTermsVersion: s.activationTermsVersion,
      conditionsKey: s.conditionsKey,
      grant: s.grant ? this.grant(s.grant) : null,
      effectiveState: s.effectiveState,
      executionAuthorized: s.executionAuthorized,
      reasons: [...s.reasons],
      principal: s.principal,
    };
  }
  command(r: OperationalCommandReceipt) {
    return {
      eventId: r.eventId,
      intentId: r.intentId,
      action: r.action,
      consentId: r.consentId,
      grant: r.grant ? this.grant(r.grant) : null,
      results: r.results.map((v) => this.run(v)),
      recordedAt: r.recordedAt,
    };
  }
}
