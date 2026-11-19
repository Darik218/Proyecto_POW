import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  PROGRESSION_REPOSITORY,
  type ProgressionRepository,
} from './progression.repository';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { consentUuid } from '../domain/progression/automation-consent.policy';
import {
  AutomaticProgressionError as Failure,
  type ActivateOperationalInput,
  type RevokeOperationalInput,
} from '../models/progression/automatic-progression.model';
import { internalProgressionCapability } from './internal-progression-principal';
@Injectable()
export class AutomaticProgressionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly capability = internalProgressionCapability();
  private readonly logger = new Logger(AutomaticProgressionService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private inFlight: Promise<number | undefined> | undefined;
  private stopping = false;
  constructor(
    @Inject(PROGRESSION_REPOSITORY)
    private readonly repository: ProgressionRepository,
  ) {}
  private actor(i: AuthenticatedIdentity) {
    if (!consentUuid(i?.account?.id) || !consentUuid(i?.sessionId))
      throw new Failure('AUTHENTICATION_REQUIRED');
    return { userId: i.account.id, sessionId: i.sessionId };
  }
  private id(id: string) {
    if (!consentUuid(id)) throw new Failure('INVALID_OPERATIONAL_COMMAND');
    return id.toLowerCase();
  }
  private batch() {
    const v = Number(process.env.PULSO_AUTOMATION_BATCH_SIZE ?? 20);
    return Number.isInteger(v) && v >= 1 && v <= 100 ? v : 20;
  }
  async status(i: AuthenticatedIdentity, id: string) {
    return this.repository.operationalStatus(this.actor(i), this.id(id));
  }
  async activate(
    i: AuthenticatedIdentity,
    id: string,
    input: ActivateOperationalInput,
  ) {
    this.id(input.intentId);
    this.id(input.acceptanceEventId);
    if (input.confirmActivation !== true)
      throw new Failure('INVALID_OPERATIONAL_COMMAND');
    return this.repository.mutateOperationalGrant(
      this.actor(i),
      this.id(id),
      'ACTIVATE',
      input,
    );
  }
  async revoke(
    i: AuthenticatedIdentity,
    id: string,
    input: RevokeOperationalInput,
  ) {
    this.id(input.intentId);
    this.id(input.grantId);
    if (input.confirmRevocation !== true)
      throw new Failure('INVALID_OPERATIONAL_COMMAND');
    return this.repository.mutateOperationalGrant(
      this.actor(i),
      this.id(id),
      'REVOKE',
      input,
    );
  }
  async operation(i: AuthenticatedIdentity, id: string) {
    return this.repository.operationalOperation(this.actor(i), this.id(id));
  }
  async history(
    i: AuthenticatedIdentity,
    id: string,
    page: number,
    limit: number,
  ) {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Failure('INVALID_OPERATIONAL_COMMAND');
    return this.repository.automaticHistory(
      this.actor(i),
      this.id(id),
      page,
      limit,
    );
  }
  async receipt(i: AuthenticatedIdentity, id: string) {
    return this.repository.automaticReceipt(this.actor(i), this.id(id));
  }
  async process(i: AuthenticatedIdentity, id: string, intentId: string) {
    return this.repository.processOwnAutomatic(
      this.capability,
      this.actor(i),
      this.id(id),
      this.id(intentId),
      this.batch(),
    );
  }
  tick() {
    if (this.running || this.stopping) return Promise.resolve(undefined);
    this.running = true;
    this.inFlight = (async () => {
      try {
        return await this.repository.processActiveAutomatic(
          this.capability,
          this.batch(),
        );
      } catch {
        this.logger.warn(
          'Automatic progression batch unavailable; retry on next interval.',
        );
        return undefined;
      } finally {
        this.running = false;
      }
    })();
    return this.inFlight;
  }

  onModuleInit() {
    if (process.env.PULSO_AUTOMATION_ENABLED !== 'true') return;
    const value = Number(process.env.PULSO_AUTOMATION_INTERVAL_MS ?? 60000),
      interval = Number.isInteger(value) && value >= 1000 ? value : 60000;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    this.timer.unref?.();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }
}
