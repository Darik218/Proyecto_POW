import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const source = (path: string) => readFileSync(resolve('src', path), 'utf8');
describe('PROG-6A MVC and authorization boundaries (real registration also exercised by PostgreSQL HTTP tests)', () => {
  it('registers one HTTP controller and reuses the existing service and presenter', () => {
    const module = source('progression/progression.module.ts'),
      controller = source('controllers/progression/progression.controller.ts');
    expect(
      module.match(
        /controllers:\s*\[\s*AutomaticProgressionController,\s*ProgressionController,\s*AutomationConsentController,\s*ProgressionSettingsController,?\s*\]/g,
      ),
    ).toHaveLength(1);
    expect(controller).toMatch(/recommendations:\s*RecommendationService/);
    expect(controller).toMatch(/presenter:\s*ProgressionPresenter/);
    expect(controller).toMatch(/@UseGuards\(AccessTokenGuard\)/);
  });
  it('uses the existing origin guard on all eight POST routes', () => {
    const controller = source(
      'controllers/progression/progression.controller.ts',
    );
    expect(controller.match(/@Post\(/g)).toHaveLength(8);
    expect(controller.match(/@UseGuards\(AuthOriginGuard\)/g)).toHaveLength(8);
    expect(source('auth/auth.module.ts')).toMatch(
      /exports:\s*\[[\s\S]*AuthOriginGuard/,
    );
  });
  it('keeps SQL, transactions and domain calculations outside controllers and views', () => {
    const controller = source(
        'controllers/progression/progression.controller.ts',
      ),
      view = source('views/progression/progression.presenter.ts');
    for (const text of [controller, view])
      expect(text).not.toMatch(
        /PrismaService|\$transaction|\$queryRaw|new Decimal|deriveRecommendation\(/,
      );
    expect(controller).not.toMatch(
      /automationConsent|autoApplyAuthorized|\.status\s*=/,
    );
  });
});
