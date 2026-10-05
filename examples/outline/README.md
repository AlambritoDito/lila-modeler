# Outline: credit application

A synthetic example of the outline format (#97): the process as data — lanes plus an ordered list
of steps with branches — which `lila process create` and the MCP tool `create_process` turn into
a laid-out, validated BPMN process inside a `.lila`. Invented for this documentation; it is the
example of issue #97, verbatim.

- `credit-application.json`: two lanes, a check with a normal duration (`normal(20m, 5m)`) and an
  approval XOR whose "No" branch has probability 0.3 (the "Yes" branch takes the rest, 0.7).
- `pedido-edit.json`: a list of edit operations (#98) for `lila process edit` and the MCP tool
  `edit_process` on `examples/pedido.lila`: a "Charge" step with a duration and the cashier after
  "Take order", a rename, a type change, two lanes and a move to the kitchen lane.
- `pedido-edit-ambiguous.json`: an edit that is refused as a whole: removing the parallel split
  would leave its two branches with nowhere to come from.

```bash
npx lila process create --outline examples/outline/credit-application.json -p credit.lila --dry-run
npx lila process edit -p examples/pedido.lila --ops examples/outline/pedido-edit.json --dry-run
```

Assumptions: arrivals are the app's defaults for a new process (20 cases, one per minute) and the
steps without a duration take no time; edit `as-is.scenario.json` in the app or with
`patch_scenario` for anything else. Run from the repository root after `npm ci` and
`npm run build`. See `docs/CLI.md` and `docs/MCP.md`.
