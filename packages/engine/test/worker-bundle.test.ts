import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { afterEach, describe, expect, test } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(TEST_DIR, '../../..');
const CORE_ROOT = resolve(TEST_DIR, '../src/core');

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  resolveJsonModule: true,
  target: ts.ScriptTarget.ES2022,
};

interface DependencyReference {
  readonly specifier?: string;
  readonly line: number;
  readonly kind: string;
}

interface IsolationViolation extends DependencyReference {
  readonly file: string;
  readonly reason: string;
}

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
  );
}

function isTypeScriptSource(name: string): boolean {
  return /\.(?:[cm]?ts|tsx)$/.test(name);
}

function isDeclarationFile(name: string): boolean {
  return /\.d\.(?:[cm]?ts|tsx)$/.test(name);
}

function findTypeScriptFiles(root: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTypeScriptFiles(path));
    } else if (entry.isFile() && isTypeScriptSource(entry.name)) {
      files.push(path);
    }
  }

  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function literalSpecifier(node: ts.Node | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function sourceLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function dependencyReferences(file: string): DependencyReference[] {
  const sourceText = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references: DependencyReference[] = [];

  function add(node: ts.Node, kind: string, specifier?: string): void {
    references.push({
      ...(specifier === undefined ? {} : { specifier }),
      kind,
      line: sourceLine(sourceFile, node),
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) {
        add(node, ts.isImportDeclaration(node) ? 'import' : 'export', literalSpecifier(node.moduleSpecifier));
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      add(
        node,
        'import equals',
        ts.isExternalModuleReference(reference) ? literalSpecifier(reference.expression) : undefined,
      );
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, 'import type expression', literalSpecifier(node.argument.literal));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node, 'dynamic import', literalSpecifier(node.arguments[0]));
    } else if (
      ts.isCallExpression(node) &&
      (ts.isIdentifier(node.expression) && node.expression.text === 'require' ||
        ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'require' &&
          node.expression.name.text === 'resolve')
    ) {
      add(node, 'require', literalSpecifier(node.arguments[0]));
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Math' &&
      node.expression.name.text === 'random'
    ) {
      add(node, 'Math.random');
    } else if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Date'
    ) {
      add(node, 'Date');
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Date'
    ) {
      add(node, 'Date');
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const preprocessed = ts.preProcessFile(sourceText, true, true);
  for (const directive of preprocessed.typeReferenceDirectives) {
    references.push({
      kind: 'reference types',
      line: sourceFile.getLineAndCharacterOfPosition(directive.pos).line + 1,
      specifier: directive.fileName,
    });
  }
  for (const directive of preprocessed.referencedFiles) {
    references.push({
      kind: 'reference path',
      line: sourceFile.getLineAndCharacterOfPosition(directive.pos).line + 1,
      specifier: directive.fileName,
    });
  }

  return references;
}

function inspectStaticIsolation(root: string): IsolationViolation[] {
  const canonicalRoot = realpathSync(root);
  const violations: IsolationViolation[] = [];

  for (const file of findTypeScriptFiles(canonicalRoot)) {
    for (const reference of dependencyReferences(file)) {
      const base = {
        ...reference,
        file: normalizePath(relative(canonicalRoot, file)),
      };

      if (reference.kind === 'Math.random' || reference.kind === 'Date') {
        violations.push({ ...base, reason: `${reference.kind} no está permitido en core/` });
        continue;
      }

      if (reference.specifier === undefined) {
        violations.push({ ...base, reason: `${reference.kind} debe usar un literal estático` });
        continue;
      }

      if (!reference.specifier.startsWith('.')) {
        violations.push({ ...base, reason: 'la dependencia no pertenece a core/' });
        continue;
      }

      const resolvedModule = ts.resolveModuleName(
        reference.specifier,
        file,
        compilerOptions,
        ts.sys,
      ).resolvedModule;
      if (resolvedModule === undefined) {
        violations.push({ ...base, reason: 'la dependencia relativa no se puede resolver' });
        continue;
      }

      const dependency = realpathSync(resolvedModule.resolvedFileName);
      if (!isWithin(canonicalRoot, dependency)) {
        violations.push({ ...base, reason: 'la dependencia relativa sale de core/' });
      }
    }
  }

  return violations;
}

function formatViolations(violations: readonly IsolationViolation[]): string {
  return violations
    .map(
      ({ file, kind, line, reason, specifier }) =>
        `${file}:${line} — ${kind}${specifier === undefined ? '' : ` “${specifier}”`}: ${reason}`,
    )
    .join('\n');
}

async function assertBrowserBundleIsIsolated(root: string): Promise<void> {
  const canonicalRoot = realpathSync(root);
  const sources = findTypeScriptFiles(canonicalRoot).filter((file) => !isDeclarationFile(file));
  const staticViolations = inspectStaticIsolation(canonicalRoot);
  if (staticViolations.length > 0) {
    throw new Error(formatViolations(staticViolations));
  }

  const result = await build({
    absWorkingDir: REPOSITORY_ROOT,
    bundle: true,
    entryNames: '[dir]/[name]',
    entryPoints: sources,
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
    outbase: canonicalRoot,
    outdir: 'core-worker-test',
    platform: 'browser',
    target: 'es2022',
    write: false,
  });

  const outsideInputs = Object.keys(result.metafile.inputs).filter((input) => {
    const absoluteInput = realpathSync(resolve(REPOSITORY_ROOT, input));
    return !isWithin(canonicalRoot, absoluteInput);
  });
  const externalImports = Object.entries(result.metafile.outputs).flatMap(([output, metadata]) =>
    metadata.imports
      .filter((dependency) => dependency.external)
      .map((dependency) => `${output} -> ${dependency.path}`),
  );
  const actualEntryPoints = Object.values(result.metafile.outputs)
    .flatMap((output) => output.entryPoint === undefined ? [] : [normalizePath(output.entryPoint)])
    .sort();
  const expectedEntryPoints = sources
    .map((file) => normalizePath(relative(REPOSITORY_ROOT, file)))
    .sort();

  if (outsideInputs.length > 0) {
    throw new Error(`el bundle incluyó dependencias fuera de core/: ${outsideInputs.join(', ')}`);
  }
  if (externalImports.length > 0) {
    throw new Error(`el bundle dejó imports externos: ${externalImports.join(', ')}`);
  }
  if (actualEntryPoints.join('\n') !== expectedEntryPoints.join('\n')) {
    throw new Error(
      `no se empaquetaron todos los entrypoints de core/\nesperados: ${expectedEntryPoints.join(', ')}\nreales: ${actualEntryPoints.join(', ')}`,
    );
  }
}

const fixtureRoots: string[] = [];

function coreFixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'lila-core-isolation-'));
  fixtureRoots.push(root);

  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  }

  return root;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('aislamiento del bundle de core (LILA-032)', () => {
  test('cada archivo de core es un entrypoint browser sin dependencias externas', async () => {
    await expect(assertBrowserBundleIsIsolated(CORE_ROOT)).resolves.toBeUndefined();
  });

  test.each(['node:fs', 'bpmn-moddle', 'zod', 'react'])(
    'rechaza el import de runtime %s',
    (specifier) => {
      const root = coreFixture({ 'sim.ts': `import value from '${specifier}';\nexport { value };\n` });
      const violations = inspectStaticIsolation(root);

      expect(violations).toEqual([
        expect.objectContaining({ kind: 'import', specifier }),
      ]);
    },
  );

  test('rechaza dependencias borradas por TypeScript', () => {
    const root = coreFixture({
      'sim.ts': [
        "import type { ZodType } from 'zod';",
        "export type ReactNode = import('react').ReactNode;",
        'export type Schema = ZodType;',
      ].join('\n'),
    });

    expect(inspectStaticIsolation(root)).toEqual([
      expect.objectContaining({ kind: 'import', specifier: 'zod' }),
      expect.objectContaining({ kind: 'import type expression', specifier: 'react' }),
    ]);
  });

  test('también inspecciona declaraciones que no llegan al bundle', () => {
    const root = coreFixture({
      'public.d.ts': "export type { ZodType } from 'zod';\n",
      'sim.ts': 'export const value = 42;\n',
    });

    expect(inspectStaticIsolation(root)).toEqual([
      expect.objectContaining({ file: 'public.d.ts', kind: 'export', specifier: 'zod' }),
    ]);
  });

  test('acepta imports locales de runtime y de tipos entre módulos de core', async () => {
    const root = coreFixture({
      'index.ts': [
        "import type { Shape } from './types.js';",
        "import { value } from './value.js';",
        'export type Output = Shape;',
        'export const output = value;',
      ].join('\n'),
      'types.ts': 'export interface Shape { readonly value: number; }\n',
      'value.ts': 'export const value = 42;\n',
    });

    expect(inspectStaticIsolation(root)).toEqual([]);
    await expect(assertBrowserBundleIsIsolated(root)).resolves.toBeUndefined();
  });

  test('rechaza imports relativos que escapan de core', () => {
    const root = coreFixture({
      'core/sim.ts': "export { value } from '../adapter.js';\n",
      'adapter.ts': 'export const value = 42;\n',
    });

    expect(inspectStaticIsolation(join(root, 'core'))).toEqual([
      expect.objectContaining({ reason: 'la dependencia relativa sale de core/' }),
    ]);
  });

  test.each([
    ['Math.random', 'export const sample = Math.random();\n'],
    ['Date', 'export const now = Date.now();\n'],
  ])('rechaza el acceso global a %s', (kind, source) => {
    const root = coreFixture({ 'sim.ts': source });

    expect(inspectStaticIsolation(root)).toEqual([
      expect.objectContaining({ kind }),
    ]);
  });
});
