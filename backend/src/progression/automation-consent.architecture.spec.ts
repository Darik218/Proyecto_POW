import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const source = (name: string) => readFileSync(resolve('src', name), 'utf8');
describe('PROG-5C-A internal-only architecture boundary', () => {
  it('never calls an increment application or installs a job/HTTP consumer', () => {
    for (const file of [
      'progression/automation-consent.service.ts',
      'progression/automation-consent.persistence.ts',
      'domain/progression/automation-consent.policy.ts',
      'domain/progression/automation-eligibility.policy.ts',
    ])
      expect(source(file)).not.toMatch(
        /applyMyApprovedRecommendation|applyExactPrescriptionLoad|progressionApplication\.(create|update)|@Controller|@Cron|setInterval/,
      );
  });
  it('keeps models and pure policies independent of database/HTTP operations', () => {
    expect(
      source('models/progression/automation-consent.model.ts'),
    ).not.toMatch(/PrismaService|@nestjs|\$transaction|fetch\(/);
    for (const file of [
      'domain/progression/automation-consent.policy.ts',
      'domain/progression/automation-eligibility.policy.ts',
    ])
      expect(source(file)).not.toMatch(
        /PrismaService|\$transaction|Date\.now|Math\.random|fetch\(/,
      );
  });
  it('has one existing-module service registration and repository delegation', () => {
    const module = source('progression/progression.module.ts');
    expect(module.match(/^\s*AutomationConsentService,$/gm) || []).toHaveLength(
      2,
    );
    expect(source('progression/automation-consent.service.ts')).toContain(
      '@Inject(PROGRESSION_REPOSITORY)',
    );
    expect(source('progression/prisma-progression.repository.ts')).toContain(
      'return mutateAutomationConsent(',
    );
  });
  it('has no operational activation method and represents every result as non-operational', () => {
    const service = source('progression/automation-consent.service.ts');
    expect(service).not.toMatch(/\b(activate|execute|apply)\w*\(/i);
    expect(source('models/progression/automation-consent.model.ts')).toContain(
      "'ACCEPTED_INACTIVE'",
    );
    expect(
      source('domain/progression/automation-eligibility.policy.ts'),
    ).not.toContain('executionAuthorized: true');
  });
});
