/**
 * `docs/CLI.md` (LILA-188 pattern, #450): every `npx lila …` example has to run as documented, not
 * just read well. Each fenced ```bash block that starts with `npx lila` is followed by an
 * `Exit code: `N`.` line — this test extracts both, replays the command through `main()` and
 * checks the exit code. `--json` output from `run` additionally has to validate against
 * `runResultSchema`, the stable contract agents parse (docs/CLI.md § For agents).
 *
 * Blocks that are not runnable in a test process (the `mcp` example, which blocks on stdin) are
 * fenced as ```text in the doc, not ```bash, so they never match here.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';

import { main } from '../src/cli.js';
import { runResultSchema } from '../src/result.schema.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const doc = readFileSync(join(repoRoot, 'docs/CLI.md'), 'utf8');

interface DocExample {
  command: string;
  exitCode: number;
}

/**
 * Every ```bash block immediately followed by its documented `Exit code: `N`.` line. Matched in
 * two passes, not one combined regex: a single lazy pattern spanning "```bash…```…Exit code" would
 * skip an untagged block (the `git clone`/`npm ci` install steps have no exit code of their own)
 * by backtracking straight through its closing fence into the next block's, silently merging two
 * examples into one bad match. Finding every fenced block first, then checking the line right
 * after each one independently, keeps every block's boundary exact.
 */
function extractExamples(markdown: string): DocExample[] {
  const examples: DocExample[] = [];
  for (const block of markdown.matchAll(/```bash\n([\s\S]*?)```\n/g)) {
    const after = markdown.slice(block.index! + block[0].length);
    const exitCode = /^Exit code: `(\d+)`\./.exec(after);
    if (exitCode !== null) examples.push({ command: block[1]!.trim(), exitCode: Number(exitCode[1]) });
  }
  return examples;
}

const VALUE_FLAGS = new Set(['--seed', '--replications', '--lang']);
const OUTPUT_FLAGS = new Set(['--json', '--csv', '--xlsx']);

/**
 * Turns one documented `npx lila …` command into an argv for `main()`: positionals resolve
 * against the repo root (the doc says every example runs from there), `--seed`/`--replications`
 * pass through untouched, and `--json`/`--csv`/`--xlsx` targets are redirected into `outputDir`
 * so the test never writes into the repository itself.
 */
function toArgv(command: string, outputDir: string): { argv: string[]; outputs: Map<string, string> } {
  const tokens = command
    .replace(/\\\n\s*/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(2); // drop the leading `npx lila`
  const [head, ...rest] = tokens;
  const argv: string[] = [head!];
  const outputs = new Map<string, string>();

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (VALUE_FLAGS.has(token)) {
      argv.push(token, rest[++i]!);
    } else if (token === '--json' && head === 'validate') {
      // `validate --json` is a boolean flag; only `run`/`compare` take `--json <file>`.
      argv.push(token);
    } else if (OUTPUT_FLAGS.has(token)) {
      const target = join(outputDir, basename(rest[++i]!));
      outputs.set(token, target);
      argv.push(token, target);
    } else if (token.startsWith('--') || token.startsWith('-')) {
      argv.push(token);
    } else {
      argv.push(resolve(repoRoot, token));
    }
  }
  return { argv, outputs };
}

let out: string[];

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('docs/CLI.md examples run as documented', () => {
  const examples = extractExamples(doc).filter((example) => example.command.startsWith('npx lila'));

  test('found the examples this test is meant to cover', () => {
    // Guards against a doc edit silently dropping every example (a markdown slip that makes the
    // regex match nothing would otherwise leave this suite green with zero assertions).
    expect(examples.length).toBeGreaterThanOrEqual(5);
  });

  for (const example of examples) {
    test(`\`${example.command.split('\n')[0]}\` exits ${example.exitCode}`, async () => {
      const outputDir = mkdtempSync(join(tmpdir(), 'lila-cli-docs-'));
      onTestFinished(() => rmSync(outputDir, { recursive: true, force: true }));
      const { argv, outputs } = toArgv(example.command, outputDir);

      const code = await main(argv);
      expect(code, out.join('\n')).toBe(example.exitCode);

      const jsonOutput = outputs.get('--json');
      if (jsonOutput !== undefined && argv[0] === 'run') {
        expect(existsSync(jsonOutput)).toBe(true);
        const parsed: unknown = JSON.parse(readFileSync(jsonOutput, 'utf8'));
        expect(runResultSchema.safeParse(parsed).success).toBe(true);
      }
    });
  }
});

describe('README', () => {
  test('links docs/CLI.md', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    expect(readme).toContain('docs/CLI.md');
  });
});
