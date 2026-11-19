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
function sourceFile(parent: string, specifier: string) {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(parent), specifier);
  return [
    base,
    base.replace(/\.js$/, '.ts'),
    base + '.ts',
    resolve(base, 'index.ts'),
  ].find((candidate) => candidate.endsWith('.ts') && existsSync(candidate));
}

describe('Athletes MVC dependency boundaries', () => {
  it('keeps models and the JSON view free of runtime persistence, HTTP and use-case imports', () => {
    for (const path of [
      'models/athletes/athlete.model.ts',
      'models/athletes/body-measurement.model.ts',
      'views/athletes/athletes.presenter.ts',
    ])
      expect(imports(file(path))).toEqual([]);
  });
  it('keeps HTTP handling in the controller and JSON presentation outside the service and repository', () => {
    const controller = imports(
      file('controllers/athletes/athletes.controller.ts'),
    );
    expect(controller).toContain('../../athletes/athletes.service');
    expect(controller).toContain('../../views/athletes/athletes.presenter');
    expect(
      controller.some((path) => /prisma|generated|repository/.test(path)),
    ).toBe(false);
    for (const path of [
      'athletes/athletes.service.ts',
      'athletes/prisma-athletes.repository.ts',
    ]) {
      expect(
        imports(file(path)).some((dependency) =>
          /views\/|controllers\//.test(dependency),
        ),
      ).toBe(false);
    }
  });
  it('has no circular runtime imports reachable from AthletesModule', () => {
    const visited = new Set<string>();
    const active = new Set<string>();
    function visit(path: string) {
      if (path.includes('/generated/') || visited.has(path)) return;
      expect(active.has(path)).toBe(false);
      active.add(path);
      for (const specifier of imports(path)) {
        const child = sourceFile(path, specifier);
        if (child) visit(child);
      }
      active.delete(path);
      visited.add(path);
    }
    visit(file('athletes/athletes.module.ts'));
    for (const path of [
      'controllers/athletes/athletes.controller.ts',
      'models/athletes/athlete.model.ts',
      'models/athletes/body-measurement.model.ts',
      'views/athletes/athletes.presenter.ts',
    ]) {
      expect(visited).toContain(file(path));
    }
  });
});
