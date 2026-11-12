import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const source = (p: string) => readFileSync(resolve('src', p), 'utf8');
describe('SETTINGS-1 MVC boundaries and non-operational configuration', () => {
  it('registers the settings controller and service exactly once', () => {
    const m = source('progression/progression.module.ts');
    expect(
      m.match(/controllers:\s*\[[^\]]*ProgressionSettingsController[^\]]*\]/g),
    ).toHaveLength(1);
    expect(m.match(/^\s*ProgressionSettingsPresenter,$/gm)).toHaveLength(1);
  });
  it('keeps bearer/origin on all mutations and exposes no delete or arbitrary patch', () => {
    const c = source(
      'controllers/progression/progression-settings.controller.ts',
    );
    expect(c).toContain('@UseGuards(AccessTokenGuard)');
    expect(c.match(/@Post\(/g)).toHaveLength(3);
    expect(c.match(/@Put\(/g)).toHaveLength(1);
    expect(c.match(/@UseGuards\(AuthOriginGuard\)/g)).toHaveLength(4);
    expect(c).not.toMatch(/PrismaService|\$queryRaw|@Delete|@Patch/);
  });
  it('has no mathematical calculation, consent mutation or application in configuration', () => {
    for (const p of [
      'progression/progression-settings.service.ts',
      'progression/progression-settings.persistence.ts',
      'views/progression/progression-settings.presenter.ts',
    ])
      expect(source(p)).not.toMatch(
        /deriveRecommendation|calculateIncrement|applyMyApprovedRecommendation|progressionApplication\.(create|update)|progressionAutomationConsent\.(create|update)|@Cron|setInterval/,
      );
    expect(
      source('views/progression/progression-settings.presenter.ts'),
    ).not.toMatch(/PrismaService|\$queryRaw|\$transaction/);
  });
});
