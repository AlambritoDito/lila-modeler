# Restaurant order benchmark

The default Lila demo and CLI benchmark. The model takes an order, prepares and packs it in
parallel, reviews it, then either rejects it or waits before delivery. The customer pool is
context only; message flows are preserved but do not transport simulation tokens.

- `model.bpmn`: English labels with stable BPMN IDs.
- `as-is.scenario.json`: current operation with two cashiers and three cooks.
- `to-be-3-cajeros.scenario.json`: inherits AS-IS and increases cashier capacity to three.

```bash
npx lila validate examples/pedido/model.bpmn
npx lila run examples/pedido/model.bpmn examples/pedido/as-is.scenario.json --seed 42 --replications 3
npx lila compare examples/pedido/model.bpmn examples/pedido/as-is.scenario.json examples/pedido/to-be-3-cajeros.scenario.json --seed 42 --replications 3
```

Run these commands from the repository root after `npm ci` and `npm run build`. Resource and
calendar keys (`cajero`, `cocinero`, `horno`, `oficina`) and file names remain stable in both UI
languages. The demo does not maintain a separate Spanish copy of the model. Times are seconds;
`baseTimeUnit` only controls presentation. The packing task intentionally has no parameters:
it uses zero processing time and infinite capacity, and produces the corresponding warning.
