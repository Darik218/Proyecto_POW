import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
const root = resolve('src');
const file = (name: string) => resolve(root, name);
const imports = (path: string) => {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  return source.statements
    .filter(ts.isImportDeclaration)
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
};
const resolveSource = (parent: string, specifier: string) => {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(parent), specifier);
  return [
    base,
    base.replace(/\.js$/, '.ts'),
    base + '.ts',
    resolve(base, 'index.ts'),
  ].find((path) => path.endsWith('.ts') && existsSync(path));
};
describe('Exercises MVC dependency boundaries', () => {
  it('keeps the domain model free from runtime HTTP, DTO, view and persistence imports', () => {
    expect(imports(file('models/exercises/exercise.model.ts'))).toEqual([]);
  });
  it('keeps the public view independent of persistence and application use cases', () => {
    expect(imports(file('views/exercises/exercises.presenter.ts'))).toEqual([]);
    const controller = imports(
      file('controllers/exercises/exercises.controller.ts'),
    );
    expect(controller).toContain('../../exercises/exercises.service');
    expect(controller).toContain('../../views/exercises/exercises.presenter');
    expect(
      controller.some((path) => /generated|prisma|repository/.test(path)),
    ).toBe(false);
    expect(
      imports(file('exercises/exercises.service.ts')).some((path) =>
        path.includes('/views/'),
      ),
    ).toBe(false);
  });
  it('has no circular runtime imports reachable from the MVC composition root', () => {
    const visited = new Set<string>(),
      active = new Set<string>();
    function visit(path: string) {
      if (path.includes('/generated/') || visited.has(path)) return;
      expect(active.has(path)).toBe(false);
      active.add(path);
      for (const specifier of imports(path)) {
        const dependency = resolveSource(path, specifier);
        if (dependency) visit(dependency);
      }
      active.delete(path);
      visited.add(path);
    }
    visit(file('exercises/exercises.module.ts'));
    expect(visited).toContain(
      file('controllers/exercises/exercises.controller.ts'),
    );
    expect(visited).toContain(file('models/exercises/exercise.model.ts'));
    expect(visited).toContain(file('views/exercises/exercises.presenter.ts'));
  });
});
