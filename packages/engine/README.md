# @lila-modeler/engine

Discrete-event simulation for BPMN processes. Part of [Lila Modeler](https://github.com/AlambritoDito/lila-modeler), inspired by the simulation workflow of Bizagi Modeler and validated against public examples. Coverage and remaining differences are documented in [BIZAGI_PARITY.md](https://github.com/AlambritoDito/lila-modeler/blob/main/docs/BIZAGI_PARITY.md).

## Preliminary release

This is a pre-1.0 public beta, published for validation; it does not mark the project's 1.0
milestone complete. See [CHANGELOG.md](https://github.com/AlambritoDito/lila-modeler/blob/main/CHANGELOG.md)
for the exact version. Requires Node.js 22 or later. Registry availability depends on the
repository owner's first publication (#48).

## CLI

```bash
npx @lila-modeler/engine@beta validate model.bpmn
npx @lila-modeler/engine@beta run model.bpmn scenario.json --seed 42 --replications 3 --json result.json
npx @lila-modeler/engine@beta compare model.bpmn a.json b.json --seed 42 --replications 3
npx @lila-modeler/engine@beta --version
```

English is the default. Use `--lang es` or `LILA_LANG=es` for Spanish diagnostics. Diagnostic
codes, model IDs and result columns remain stable. The optional `lila mcp` command requires the
separate MCP workspace from a repository checkout; the engine package alone does not include the
server. Full reference, worked examples and a "for agents" section:
[docs/CLI.md](https://github.com/AlambritoDito/lila-modeler/blob/main/docs/CLI.md).

## Library

```ts
import { simulate } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';
import { validateScenario } from '@lila-modeler/engine/schema';
```

Typed entry points also include `messages`, `cli-shared`, `result-schema`, `csv`, and `format`. The dependency-free simulation core runs in Node.js and browser Web Workers.

See the [scenario format](https://github.com/AlambritoDito/lila-modeler/blob/main/docs/SCENARIO_FORMAT.md), [result format](https://github.com/AlambritoDito/lila-modeler/blob/main/docs/RESULTS_FORMAT.md) and [semantics](https://github.com/AlambritoDito/lila-modeler/blob/main/docs/SEMANTICS.md) for contracts and limitations.

## License

Apache-2.0. See LICENSE and NOTICE for terms and attribution. Product names and logos are not covered by the license grant.

## Validate the unpublished package

From a repository checkout, run `npm ci`, `npm run build`, and `npm run test:package`.
The last command packs and installs the actual archive in a temporary directory outside the
workspace. It checks every runtime export, the JSON descriptor, TypeScript Node16 and bundler
resolution, English/Spanish CLI commands, and byte-identical simulation results against the
checkout. It does not publish anything; it retains the temporary directory for inspection.
