/**
 * Resources and the `interview-to-process` prompt (#637), in both server languages, over an
 * in-memory transport: each one is the docs it names, so the docs stay the single source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locale } from '@lila-modeler/engine/messages';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, test } from 'vitest';

import { absoluteLinks, BUNDLED_DOCS, DOCS_URL, section } from '../src/resources.js';
import { createServer } from '../src/server.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const doc = (file: string): string => readFileSync(join(repo, 'docs', file), 'utf8');

async function connect(locale: Locale): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'resources-test', version: '0' });
  await Promise.all([client.connect(clientTransport), createServer({ locale }).connect(serverTransport)]);
  return client;
}

async function read(client: Client, uri: string): Promise<string> {
  const { contents } = await client.readResource({ uri });
  expect(contents).toHaveLength(1);
  return (contents[0] as { text: string }).text;
}

const cases = [
  { locale: 'en', guide: 'AGENT_GUIDE.md', format: 'SCENARIO_FORMAT.md', outline: '## The outline format', rules: '## Creating a process from an outline', step8: '### 8. Open it in the app', transcript: 'The interview:' },
  { locale: 'es', guide: 'es/GUIA-AGENTES.md', format: 'es/SCENARIO_FORMAT.md', outline: '## El formato del esquema', rules: '## Crear un proceso desde un esquema', step8: '### 8. Abrirlo en la app', transcript: 'La entrevista:' },
] as const;

describe.each(cases)('server language $locale', ({ locale, guide, format, outline, rules, step8, transcript }) => {
  test('the four resources are the docs, in the server language', async () => {
    const client = await connect(locale);
    try {
      const { resources } = await client.listResources();
      expect(resources.map((resource) => [resource.uri, resource.mimeType])).toEqual([
        ['lila://guide', 'text/markdown'],
        ['lila://outline-format', 'text/markdown'],
        ['lila://scenario-format', 'text/markdown'],
        ['lila://scenario-schema', 'application/schema+json'],
      ]);
      expect(await read(client, 'lila://guide')).toBe(absoluteLinks(doc(guide), guide));
      expect(await read(client, 'lila://scenario-format')).toBe(absoluteLinks(doc(format), format));
      expect(await read(client, 'lila://scenario-schema')).toBe(doc('scenario.schema.json'));
      expect(JSON.parse(await read(client, 'lila://scenario-schema'))).toHaveProperty('$schema');
      const outlineFormat = await read(client, 'lila://outline-format');
      expect(outlineFormat.startsWith(`${outline}\n`)).toBe(true);
      expect(outlineFormat).toContain(`\n${rules}\n`);
      expect(outlineFormat).toContain('"steps"');
      // Each section ends before the next one of its level.
      expect(outlineFormat.split('\n').filter((line) => line.startsWith('## '))).toEqual([outline, rules]);
      // #645: an MCP-only client cannot follow a relative link.
      for (const uri of ['lila://guide', 'lila://outline-format', 'lila://scenario-format']) {
        const links = [...(await read(client, uri)).matchAll(/\]\(([^()\s]+)\)/g)].map((match) => match[1]!);
        expect(links.length, uri).toBeGreaterThan(0);
        for (const link of links) expect(link, uri).toMatch(/^(https:|lila:)/);
      }
    } finally {
      await client.close();
    }
  });

  test('interview-to-process carries steps 1 to 8 of the guide and the transcript', async () => {
    const client = await connect(locale);
    try {
      const { prompts } = await client.listPrompts();
      expect(prompts).toEqual([expect.objectContaining({ name: 'interview-to-process' })]);
      expect(prompts[0]!.arguments?.map((argument) => [argument.name, argument.required ?? false])).toEqual([
        ['transcript', false],
        ['project', false],
      ]);
      const { messages } = await client.getPrompt({ name: 'interview-to-process', arguments: { transcript: 'Q: How does it start?\nA: A form arrives.', project: 'card.lila' } });
      expect(messages).toHaveLength(1);
      const text = (messages[0]!.content as { text: string }).text;
      for (let step = 1; step <= 8; step++) expect(text, `step ${step}`).toMatch(new RegExp(`^### ${step}\\. `, 'm'));
      expect(text).toContain(step8);
      expect(text).toContain('card.lila');
      expect(text.endsWith(`${transcript}\n\nQ: How does it start?\nA: A form arrives.`)).toBe(true);
      // The flow, not the whole guide: the outline format is a resource of its own.
      expect(text).not.toContain(outline);

      const bare = await client.getPrompt({ name: 'interview-to-process' });
      expect((bare.messages[0]!.content as { text: string }).text).not.toContain(transcript);
    } finally {
      await client.close();
    }
  });
});

test('section() stops at the next heading of its level or higher, and names a missing heading', () => {
  const markdown = '# T\n\n## A\n\ntext\n\n### A.1\n\nmore\n\n## B\n\nb';
  expect(section(markdown, '## A')).toBe('## A\n\ntext\n\n### A.1\n\nmore');
  expect(() => section(markdown, '## C')).toThrow('docs: no heading "## C"');
});

test('absoluteLinks() resolves relative links and anchors against the doc, and keeps links with a scheme', () => {
  const markdown = '[a](SCENARIO_FORMAT.md) [b](#saving-a-run) [c](../MCP.md#installation) [d](https://example.com/x) [e](lila://guide)';
  expect(absoluteLinks(markdown, 'es/MCP.md')).toBe(
    `[a](${DOCS_URL}es/SCENARIO_FORMAT.md) [b](${DOCS_URL}es/MCP.md#saving-a-run) [c](${DOCS_URL}MCP.md#installation) ` +
      '[d](https://example.com/x) [e](lila://guide)',
  );
  const fenced = '```md\n[x](MCP.md)\n```\n[y](MCP.md)';
  expect(absoluteLinks(fenced, 'MCP.md')).toBe(`\`\`\`md\n[x](MCP.md)\n\`\`\`\n[y](${DOCS_URL}MCP.md)`);
});

test('every bundled doc exists', () => {
  for (const file of BUNDLED_DOCS) expect(doc(file).length, file).toBeGreaterThan(0);
});
