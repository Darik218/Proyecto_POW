import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const source = (p: string) => readFileSync(resolve('src', p), 'utf8');
describe('PROG-5C-B1 non-operational architecture boundary', () => {
  it('keeps evaluation/model independent of HTTP, repositories, identity forgery and clocks', () => {
    for (const p of [
      'domain/progression/operational-readiness.policy.ts',
      'models/progression/operational-readiness.model.ts',
    ])
      expect(source(p)).not.toMatch(
        /@nestjs|PrismaService|\$transaction|fetch\(|Date\.now|new Date\(\)|Math\.random|AuthenticatedIdentity|refreshToken|accessToken/,
      );
  });
  it('reuses consent rules and never creates an application, session, scheduler or real authorization', () => {
    const s = source('domain/progression/operational-readiness.policy.ts');
    expect(s).toContain('evaluateAutomationConsent(i.evaluation)');
    expect(s).not.toMatch(
      /applyMyApprovedRecommendation|applyExactPrescriptionLoad|\.create\(|\.update\(|@Controller|@Cron|setInterval|executionAuthorized:\s*true/,
    );
    expect(s).toContain("'NOT_AVAILABLE_IN_B1'");
  });
  it('does not install public or executable consumers or weaken accepted-inactive contracts', () => {
    expect(source('progression/progression.module.ts')).not.toMatch(
      /OperationalReadiness|OperationalAuthorization|Scheduler|Worker/,
    );
    expect(
      source('domain/progression/automation-eligibility.policy.ts'),
    ).not.toContain('executionAuthorized: true');
    expect(source('models/progression/automation-consent.model.ts')).toContain(
      "'ACCEPTED_INACTIVE'",
    );
  });
});
