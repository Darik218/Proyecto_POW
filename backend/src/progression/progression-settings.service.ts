import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { PROGRESSION_REPOSITORY } from './progression.repository';
import type { ProgressionRepository } from './progression.repository';
import { ProgressionSettingError as Failure } from '../models/progression/progression-setting.model';
import type { SettingContext } from '../models/progression/progression-setting.model';
import { consentUuid } from '../domain/progression/automation-consent.policy';
import {
  normalizeSettingParameters,
  settingOperation,
} from '../domain/progression/progression-settings.policy';
import { policyProjection } from '../domain/progression/recommendation-query.policy';
@Injectable()
export class ProgressionSettingsService {
  constructor(
    @Inject(PROGRESSION_REPOSITORY)
    private readonly repository: ProgressionRepository,
  ) {}
  private actor(i: AuthenticatedIdentity) {
    if (!consentUuid(i?.account?.id) || !consentUuid(i?.sessionId))
      throw new Failure('AUTHENTICATION_REQUIRED');
    return {
      userId: i.account.id.toLowerCase(),
      sessionId: i.sessionId.toLowerCase(),
    };
  }
  private id(id: string) {
    if (!consentUuid(id)) throw new Failure('INVALID_SETTING');
    return id.toLowerCase();
  }
  async list(i: AuthenticatedIdentity, q: { page: number; limit: number }) {
    const a = this.actor(i);
    if (
      !Number.isSafeInteger(q.page) ||
      q.page < 1 ||
      q.page > 100000 ||
      !Number.isSafeInteger(q.limit) ||
      q.limit < 1 ||
      q.limit > 100
    )
      throw new Failure('INVALID_SETTING');
    return this.repository.listProgressionSettings(a.userId, a.sessionId, q);
  }
  async get(i: AuthenticatedIdentity, id: string) {
    const a = this.actor(i);
    return this.repository.getProgressionSetting(
      a.userId,
      a.sessionId,
      this.id(id),
    );
  }
  async effective(i: AuthenticatedIdentity, c: SettingContext) {
    const a = this.actor(i);
    this.id(c?.exerciseId);
    if (c.trainingPlanId !== null) this.id(c.trainingPlanId);
    if (
      c.policy &&
      (typeof c.policy !== 'object' ||
        Array.isArray(c.policy) ||
        JSON.stringify(c.policy).length > 131072)
    )
      throw new Failure('INVALID_SETTING');
    return this.repository.effectiveProgressionSetting(a.userId, a.sessionId, {
      exerciseId: c.exerciseId.toLowerCase(),
      trainingPlanId: c.trainingPlanId?.toLowerCase() ?? null,
      ...(c.policy ? { policy: policyProjection(c.policy)! } : {}),
    });
  }
  async create(i: AuthenticatedIdentity, input: unknown) {
    const a = this.actor(i);
    return this.repository.mutateProgressionSetting(
      a.userId,
      a.sessionId,
      settingOperation('CREATE', input),
    );
  }
  async replace(i: AuthenticatedIdentity, id: string, input: unknown) {
    const a = this.actor(i);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Failure('INVALID_SETTING');
    return this.repository.mutateProgressionSetting(
      a.userId,
      a.sessionId,
      settingOperation('REPLACE', { ...input, settingId: this.id(id) }),
    );
  }
  async operation(i: AuthenticatedIdentity, id: string) {
    const a = this.actor(i);
    return this.repository.getSettingMutation(
      a.userId,
      a.sessionId,
      this.id(id),
    );
  }
  async impact(
    i: AuthenticatedIdentity,
    id: string,
    expectedRevision: string,
    parameters: unknown,
  ) {
    const a = this.actor(i);
    if (
      typeof expectedRevision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expectedRevision)
    )
      throw new Failure('INVALID_SETTING');
    return this.repository.progressionSettingImpact(
      a.userId,
      a.sessionId,
      this.id(id),
      expectedRevision,
      normalizeSettingParameters(parameters),
    );
  }
}
