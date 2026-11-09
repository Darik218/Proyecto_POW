import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
const file = (name: string) => resolve('src', name);
function imports(path: string) {
  return ts
    .createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    .statements.filter(ts.isImportDeclaration)
    .filter(
      (node) =>
        !node.importClause?.isTypeOnly &&
        !(
          node.importClause?.namedBindings &&
          ts.isNamedImports(node.importClause.namedBindings) &&
          node.importClause.namedBindings.elements.every(
            (element) => element.isTypeOnly,
          )
        ),
    )
    .map((node) => (node.moduleSpecifier as ts.StringLiteral).text);
}
function dependency(parent: string, specifier: string) {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(parent), specifier);
  return [
    base,
    base.replace(/\.js$/, '.ts'),
    base + '.ts',
    resolve(base, 'index.ts'),
  ].find((candidate) => candidate.endsWith('.ts') && existsSync(candidate));
}
describe('Workout MVC dependency boundaries', () => {
  it('keeps models and views independent of runtime HTTP, persistence and application operations', () => {
    for (const name of [
      'workout-session.model',
      'workout-exercise.model',
      'set-record.model',
    ])
      expect(imports(file(`models/workout-sessions/${name}.ts`))).toEqual([]);
    expect(
      imports(file('views/workout-sessions/workout-sessions.presenter.ts')),
    ).toEqual([]);
  });
  it('keeps controller delegation separate from persistence and services separate from JSON views', () => {
    const controller = imports(
      file('controllers/workout-sessions/workout-sessions.controller.ts'),
    );
    expect(controller).toContain(
      '../../workout-sessions/workout-sessions.service',
    );
    expect(controller).toContain(
      '../../views/workout-sessions/workout-sessions.presenter',
    );
    expect(
      controller.some((path) =>
        /prisma|repository|policy|generated/.test(path),
      ),
    ).toBe(false);
    for (const name of [
      'workout-sessions.service',
      'prisma-workout-sessions.repository',
    ])
      expect(
        imports(file(`workout-sessions/${name}.ts`)).some((path) =>
          /views\/|controllers\//.test(path),
        ),
      ).toBe(false);
  });
  it('has no circular runtime imports reachable from WorkoutSessionsModule', () => {
    const visited = new Set<string>(),
      active = new Set<string>();
    function visit(path: string) {
      if (path.includes('/generated/') || visited.has(path)) return;
      expect(active.has(path)).toBe(false);
      active.add(path);
      for (const specifier of imports(path)) {
        const child = dependency(path, specifier);
        if (child) visit(child);
      }
      active.delete(path);
      visited.add(path);
    }
    visit(file('workout-sessions/workout-sessions.module.ts'));
    for (const path of [
      'models/workout-sessions/workout-session.model.ts',
      'views/workout-sessions/workout-sessions.presenter.ts',
      'controllers/workout-sessions/workout-sessions.controller.ts',
    ])
      expect(visited).toContain(file(path));
  });
});
