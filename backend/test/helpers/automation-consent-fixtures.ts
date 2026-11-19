import type { PrismaService } from '../../src/database/prisma.service';
import type { ConsentContract } from '../../src/models/progression/automation-consent.model';
import {
  reviewFixture,
  plannedReviewTarget,
} from './recommendation-review-fixtures';
export async function automationConsentFixture(db: PrismaService) {
  const f = await reviewFixture(db),
    target = await plannedReviewTarget(db, f);
  const [dates] = await db.$queryRaw<
    { from: string; until: string }[]
  >`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "from",to_char((clock_timestamp()+interval '30 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS until`;
  const contract: ConsentContract = {
    schemaVersion: 'automation-consent-contract-v1',
    exerciseId: f.e.id,
    trainingPlanId: target.plan.id,
    policy: { ...f.command.policy!, incrementMode: 'ABSOLUTE' },
    historyWindowDays: 28,
    limits: {
      unit: 'KG',
      loadMeaning: 'EXTERNAL_TOTAL',
      maximumAbsoluteIncrement: '2.5',
      maximumPercentIncrement: '5',
      maximumLoad: '200',
      maximumApplicationsPerWeek: 1,
      weekStartsOn: 1,
    },
    selector: {
      kind: 'EXACT_PRESCRIPTION_ALLOWLIST',
      prescriptionIds: [target.p.id],
      futureOnly: true,
      planState: 'DRAFT',
      versionPolicy: 'READ_CURRENT_AND_CAS',
    },
    validity: { startsAt: dates.from, endsAt: dates.until, timeZone: 'UTC' },
    termsVersion: 'fixture-terms-v1',
    provenance: {
      source: 'INTERNAL_CONFIGURATION_REQUEST',
      reference: 'automated-test-not-human-acceptance',
    },
  };
  return { ...f, target, contract };
}
