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

describe('Auth MVC dependency boundaries', () => {
  it('keeps models and the JSON view free of runtime persistence, HTTP and use-case imports', () => {
    for (const path of [
      'models/auth/auth-account.model.ts',
      'models/auth/auth-session.model.ts',
      'views/auth/auth.presenter.ts',
    ])
      expect(imports(file(path))).toEqual([]);
  });
  it('keeps HTTP handling in the controller and JSON presentation outside the service and repository', () => {
    const controller = imports(file('controllers/auth/auth.controller.ts'));
    expect(controller).toContain('../../auth/services/auth.service');
    expect(controller).toContain('../../views/auth/auth.presenter');
    expect(
      controller.some((path) => /prisma|generated|repository/.test(path)),
    ).toBe(false);
    for (const path of [
      'auth/services/auth.service.ts',
      'auth/prisma-auth.repository.ts',
    ]) {
      expect(
        imports(file(path)).some((dependency) =>
          /views\/|controllers\//.test(dependency),
        ),
      ).toBe(false);
    }
  });
  it('has no circular runtime imports reachable from AuthModule', () => {
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
    visit(file('auth/auth.module.ts'));
    for (const path of [
      'controllers/auth/auth.controller.ts',
      'models/auth/auth-account.model.ts',
      'views/auth/auth.presenter.ts',
    ]) {
      expect(visited).toContain(file(path));
    }
  });
});
