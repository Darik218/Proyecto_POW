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
describe('Planning MVC boundaries', () => {
  it('keeps repository callbacks out of flexible HTTP handlers and the public service API', () => {
    const read = (name: string) => ts.createSourceFile(name,
      readFileSync(file(name), 'utf8'), ts.ScriptTarget.Latest, true);
    const controller = read('controllers/training-plans/flexible-planning.controller.ts');
    const callbacks: ts.Node[] = [];
    function inspect(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        for (const argument of node.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) callbacks.push(argument);
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(controller);
    expect(callbacks).toEqual([]);
    const service = read('training-plans/flexible-planning.service.ts');
    for (const declaration of service.statements.filter(ts.isClassDeclaration)) {
      for (const method of declaration.members.filter(ts.isMethodDeclaration)) {
        if (method.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword)) continue;
        for (const parameter of method.parameters) {
          expect(parameter.type && ts.isFunctionTypeNode(parameter.type)).not.toBe(true);
        }
      }
    }
  });
  it('keeps domain models free of runtime HTTP/persistence dependencies and views limited to presentation', () => {
    for (const name of [
      'training-plan.model',
      'daily-planning.model',
      'scheduled-activity.model',
    ])
      expect(imports(file(`models/training-plans/${name}.ts`))).toEqual([]);
    for (const name of [
      'training-plans',
      'daily-planning',
      'flexible-planning',
    ])
      expect(
        imports(file(`views/training-plans/${name}.presenter.ts`)).every(
          (path) => path === './training-plans.presenter',
        ),
      ).toBe(true);
  });
  it('keeps persistence and planning policy imports outside HTTP controllers and views outside services/repositories', () => {
    for (const name of [
      'training-plans',
      'daily-planning',
      'flexible-planning',
    ]) {
      const controller = imports(
        file(`controllers/training-plans/${name}.controller.ts`),
      );
      expect(controller).toContain(`../../training-plans/${name}.service`);
      expect(controller).toContain(
        `../../views/training-plans/${name}.presenter`,
      );
      expect(
        controller.some((path) =>
          /prisma|generated|repository|policy/.test(path),
        ),
      ).toBe(false);
      for (const path of [
        `training-plans/${name}.service.ts`,
        `training-plans/prisma-${name}.repository.ts`,
      ])
        expect(
          imports(file(path)).some((value) =>
            /views\/|controllers\//.test(value),
          ),
        ).toBe(false);
    }
  });
  it('has no circular runtime imports reachable from the planning module', () => {
    const visited = new Set<string>();
    const active = new Set<string>();
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
    visit(file('training-plans/training-plans.module.ts'));
    for (const name of [
      'training-plans',
      'daily-planning',
      'flexible-planning',
    ]) {
      expect(visited).toContain(
        file(`controllers/training-plans/${name}.controller.ts`),
      );
      expect(visited).toContain(
        file(`views/training-plans/${name}.presenter.ts`),
      );
    }
    expect(visited).toContain(
      file('models/training-plans/training-plan.model.ts'),
    );
    expect(visited).toContain(
      file('models/training-plans/scheduled-activity.model.ts'),
    );
  });
});
