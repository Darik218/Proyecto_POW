import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import { parse } from '@vue/compiler-sfc'

const src = resolve('src')
const required = ['config', 'layouts', 'schemas', 'types', 'utils']
const preserved = ['components', 'composables', 'router', 'services', 'stores', 'views', 'assets']
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? files(path) : entry.name === '.gitkeep' ? [] : [path]
  })
}
function imports(path) {
  let code = readFileSync(path, 'utf8')
  if (path.endsWith('.vue')) {
    const { descriptor } = parse(code)
    code = [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join('\n')
  }
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true)
  const result = []
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) result.push(node.moduleSpecifier.text)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) result.push(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result.filter(name => name.startsWith('.')).map(name => {
    const base = resolve(dirname(path), name)
    const target = [base, base + '.ts', base + '.vue', resolve(base, 'index.ts')].find(candidate => existsSync(candidate) && statSync(candidate).isFile())
    assert.ok(target, `Unresolved local import ${name} from ${path}`)
    return target
  })
}
function graph() {
  return new Map(files(src).filter(path => /\.(ts|vue)$/.test(path)).map(path => [path, imports(path)]))
}

test('las carpetas complementarias tienen consumidores desde la aplicación y las existentes siguen conectadas', () => {
  const edges = graph()
  const reached = new Set()
  function visit(path) {
    if (reached.has(path)) return
    reached.add(path)
    for (const child of edges.get(path) ?? []) visit(child)
  }
  visit(resolve(src, 'main.ts'))
  for (const folder of [...required, ...preserved]) {
    const members = files(resolve(src, folder))
    assert.ok(members.length > 0, `${folder} must contain functional files`)
    assert.ok(members.some(path => reached.has(path)), `${folder} must have real application consumers`)
    if (required.includes(folder)) for (const path of members) assert.ok(reached.has(path), `${path} must not be decorative`)
  }
})

test('los imports locales no crean ciclos y schemas, types, config y utils no dependen de capas de interfaz o HTTP', () => {
  const edges = graph(), visited = new Set(), active = new Set()
  function visit(path) {
    assert.equal(active.has(path), false, `Circular dependency at ${path}`)
    if (visited.has(path)) return
    active.add(path)
    for (const child of edges.get(path) ?? []) visit(child)
    active.delete(path); visited.add(path)
  }
  for (const path of edges.keys()) visit(path)
  for (const folder of ['config', 'schemas', 'types', 'utils']) {
    for (const path of files(resolve(src, folder))) {
      for (const child of edges.get(path) ?? []) {
        assert.equal(['components', 'composables', 'layouts', 'router', 'services', 'stores', 'views']
          .some(dependency => child.startsWith(resolve(src, dependency) + '/')), false, `Wrong layer dependency from ${path}`)
      }
    }
  }
})

// These agent instructions are locally maintained and intentionally ignored by Git.
const instructionPaths = ['AGENTS.md', '.agents/skills/pulso-frontend-ux/SKILL.md'].map(name => resolve('..', name))
test('las instrucciones permanentes exigen implementaciones complementarias, consumidores y conservación de carpetas', {
  skip: instructionPaths.every(path => existsSync(path)) ? false : 'Local agent instructions are not included in this checkout.',
}, () => {
  for (const name of instructionPaths) {
    const instructions = readFileSync(name, 'utf8')
    for (const folder of [...required, ...preserved]) assert.match(instructions, new RegExp('`(?:frontend/src/)?' + folder + '/`'), `${name} must describe ${folder}`)
    assert.match(instructions, /real consumers/i)
    assert.match(instructions, /complement/i)
    assert.match(instructions, /empty.*functional|functional.*empt/i)
    assert.match(instructions, /backend MVC/i)
  }
})
