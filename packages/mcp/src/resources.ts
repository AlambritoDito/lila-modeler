/**
 * What an MCP-only client could not read before (#637): the agent guide, the outline and scenario
 * formats and the scenario JSON Schema as resources, and the guide's flow as the prompt
 * `interview-to-process`. Everything comes from `docs/`, in the server's language, so the docs stay
 * the single source: in a checkout the server reads the repository's `docs/`; the published
 * package carries copies of the same files in `dist/resources/` (`scripts/bundle-resources.mjs`,
 * run by `prepack`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

import type { Locale } from '@lila-modeler/engine/messages';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

/** The files under `docs/` the resources and the prompt read; `prepack` copies exactly these. */
export const BUNDLED_DOCS = [
  'AGENT_GUIDE.md',
  'es/GUIA-AGENTES.md',
  'MCP.md',
  'es/MCP.md',
  'SCENARIO_FORMAT.md',
  'es/SCENARIO_FORMAT.md',
  'scenario.schema.json',
] as const;

type DocFile = (typeof BUNDLED_DOCS)[number];

/** A checkout has `packages/mcp` three levels up from `src/` or `dist/`; an installed package does not. */
const inCheckout = existsSync(new URL('../../../packages/mcp/package.json', import.meta.url));
const docsRoot = inCheckout ? new URL('../../../docs/', import.meta.url) : new URL('./resources/', import.meta.url);

/** Where a doc's relative links point once they leave the repository (#645). */
export const DOCS_URL = 'https://github.com/AlambritoDito/lila-modeler/blob/main/docs/';

/**
 * `markdown` (the doc `file`) with its relative inline links made absolute GitHub links (#645): a
 * client that only has MCP cannot follow `SCENARIO_FORMAT.md` or `#saving-a-run`. Links with a
 * scheme (`https:`, `lila:`) and fenced code blocks stay as they are; links with a title and
 * reference-style links are not rewritten (the served docs have none).
 */
export function absoluteLinks(markdown: string, file: string): string {
  return markdown
    .split(/(^```[\s\S]*?^```)/m)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/\]\(([^()\s]+)\)/g, (link, target: string) => {
            if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return link;
            const resolved = target.startsWith('#') ? `${file}${target}` : posix.normalize(posix.join(posix.dirname(file), target));
            return `](${new URL(resolved, DOCS_URL).href})`;
          }),
    )
    .join('');
}

function readDoc(file: DocFile): string {
  const text = readFileSync(new URL(file, docsRoot), 'utf8');
  return file.endsWith('.md') ? absoluteLinks(text, file) : text;
}

/** The section that starts at the line `heading`, up to the next heading of the same level or higher. */
export function section(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) throw new Error(`docs: no heading "${heading}"`);
  const level = /^#+/.exec(heading)![0].length;
  let end = start + 1;
  while (end < lines.length && !new RegExp(`^#{1,${level}} `).test(lines[end]!)) end += 1;
  return lines.slice(start, end).join('\n').trimEnd();
}

const GUIDE: Record<Locale, DocFile> = { en: 'AGENT_GUIDE.md', es: 'es/GUIA-AGENTES.md' };
const MCP_DOC: Record<Locale, DocFile> = { en: 'MCP.md', es: 'es/MCP.md' };
const SCENARIO_FORMAT: Record<Locale, DocFile> = { en: 'SCENARIO_FORMAT.md', es: 'es/SCENARIO_FORMAT.md' };
const HEADINGS = {
  en: { flow: '## The flow', outline: '## The outline format', rules: '## Creating a process from an outline' },
  es: { flow: '## El flujo', outline: '## El formato del esquema', rules: '## Crear un proceso desde un esquema' },
} as const;

/** The outline format: the guide's example and field table, then the full rules of `MCP.md`. */
function outlineFormat(locale: Locale): string {
  return `${section(readDoc(GUIDE[locale]), HEADINGS[locale].outline)}\n\n${section(readDoc(MCP_DOC[locale]), HEADINGS[locale].rules)}\n`;
}

/** Steps 1 to 8 of the guide: its `## The flow` section, table, rules and every step. */
export function guideFlow(locale: Locale): string {
  return section(readDoc(GUIDE[locale]), HEADINGS[locale].flow);
}

const PROMPT_TEXT = {
  en: {
    intro:
      'Turn an interview about a process into a Lila model, a simulation and a document with the Lila MCP tools. ' +
      'Follow these steps; the formats are the resources lila://outline-format and lila://scenario-format.',
    project: (project: string) => `Work in the project ${project}.`,
    transcript: 'The interview:',
    noTranscript: 'Ask for the interview transcript before step 1.',
  },
  es: {
    intro:
      'Convierte una entrevista sobre un proceso en un modelo de Lila, una simulación y un documento con las tools ' +
      'MCP de Lila. Sigue estos pasos; los formatos son los recursos lila://outline-format y lila://scenario-format.',
    project: (project: string) => `Trabaja en el proyecto ${project}.`,
    transcript: 'La entrevista:',
    noTranscript: 'Pide la transcripción de la entrevista antes del paso 1.',
  },
} as const;

export function interviewPrompt(locale: Locale, transcript: string | undefined, project: string | undefined): string {
  const T = PROMPT_TEXT[locale];
  const parts: string[] = [T.intro];
  if (project !== undefined && project !== '') parts.push(T.project(project));
  parts.push(guideFlow(locale));
  parts.push(transcript === undefined || transcript.trim() === '' ? T.noTranscript : `${T.transcript}\n\n${transcript.trim()}`);
  return parts.join('\n\n');
}

/** Registers the four resources and the prompt, in `locale` (the server's language). */
export function registerResourcesAndPrompts(server: McpServer, locale: Locale): void {
  const text = (uri: URL, mimeType: string, body: string) => ({ contents: [{ uri: uri.href, mimeType, text: body }] });

  server.registerResource(
    'guide',
    'lila://guide',
    {
      title: 'Agent guide',
      description: 'How an agent goes from an interview to a model, a simulation and a document: the flow, the outline format, failures and limits.',
      mimeType: 'text/markdown',
    },
    (uri) => text(uri, 'text/markdown', readDoc(GUIDE[locale])),
  );
  server.registerResource(
    'outline-format',
    'lila://outline-format',
    {
      title: 'Outline format',
      description: 'The outline create_process takes and get_process_outline returns: an example, every field, and the rules.',
      mimeType: 'text/markdown',
    },
    (uri) => text(uri, 'text/markdown', outlineFormat(locale)),
  );
  server.registerResource(
    'scenario-format',
    'lila://scenario-format',
    {
      title: 'Scenario format',
      description: 'The scenario format v1: arrivals, processing times, resources, calendars, costs, distributions, extends.',
      mimeType: 'text/markdown',
    },
    (uri) => text(uri, 'text/markdown', readDoc(SCENARIO_FORMAT[locale])),
  );
  server.registerResource(
    'scenario-schema',
    'lila://scenario-schema',
    {
      title: 'Scenario JSON Schema',
      description: 'The JSON Schema of a scenario (docs/scenario.schema.json).',
      mimeType: 'application/schema+json',
    },
    (uri) => text(uri, 'application/schema+json', readDoc('scenario.schema.json')),
  );

  server.registerPrompt(
    'interview-to-process',
    {
      title: 'Interview to process',
      description:
        'The agent guide\'s flow, steps 1 to 8: from an interview transcript to an outline, create_process, ' +
        'the scenario, run_simulation with saveRun, the exports and the app.',
      argsSchema: z.object({
        transcript: z.string().optional().describe('The interview transcript. Without it, the prompt asks for it first.'),
        project: z.string().optional().describe('The .lila to work in (created if missing).'),
      })
        // Both arguments are optional, so a client may send none at all.
        .optional(),
    },
    (args) => ({
      messages: [{ role: 'user', content: { type: 'text', text: interviewPrompt(locale, args?.transcript, args?.project) } }],
    }),
  );
}
