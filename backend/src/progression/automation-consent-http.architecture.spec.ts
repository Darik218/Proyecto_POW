import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const source = (p: string) => readFileSync(resolve('src', p), 'utf8');
describe('PROG-6B pending consent HTTP separation', () => {
  it('registers one new controller and presenter with the existing consent service', () => {
    const module = source('progression/progression.module.ts');
    expect(
      module.match(
        /controllers:\s*\[\s*AutomaticProgressionController,\s*ProgressionController,\s*AutomationConsentController,\s*ProgressionSettingsController,?\s*\]/g,
      ),
    ).toHaveLength(1);
    const c = source(
      'controllers/progression/automation-consent.controller.ts',
    );
    expect(c).toMatch(/consents:\s*AutomationConsentService/);
    expect(c).toMatch(/presenter:\s*AutomationConsentPresenter/);
    expect(c).not.toMatch(
      /PrismaService|\$transaction|\$queryRaw|applyMyApprovedRecommendation/,
    );
  });
  it('protects every write/preview with bearer and existing origin validation', () => {
    const c = source(
      'controllers/progression/automation-consent.controller.ts',
    );
    expect(c).toContain('@UseGuards(AccessTokenGuard)');
    expect(c.match(/@Post\(/g)).toHaveLength(6);
    expect(c.match(/@UseGuards\(AuthOriginGuard\)/g)).toHaveLength(6);
  });
  it('never creates an executor or direct plan writes', () => {
    for (const p of [
      'controllers/progression/automation-consent.controller.ts',
      'progression/automation-consent.service.ts',
      'progression/automation-consent-queries.persistence.ts',
    ])
      expect(source(p)).not.toMatch(
        /@Cron|setInterval|progressionApplication\.(create|update)|autoApplyAuthorized:\s*true|state:\s*'ACTIVE'|applyMyApprovedRecommendation/,
      );
    expect(
      source('views/progression/automation-consent.presenter.ts'),
    ).not.toMatch(
      /PrismaService|\$queryRaw|new Decimal|recommendationIdentity/,
    );
  });
});
