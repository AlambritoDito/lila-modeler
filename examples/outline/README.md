# Outline: credit application

A synthetic example of the outline format (#97): the process as data — lanes plus an ordered list
of steps with branches — which `lila process create` and the MCP tool `create_process` turn into
a laid-out, validated BPMN process inside a `.lila`. Invented for this documentation; it is the
example of issue #97, verbatim.

- `credit-application.json`: two lanes, a check with a normal duration (`normal(20m, 5m)`) and an
  approval XOR whose "No" branch has probability 0.3 (the "Yes" branch takes the rest, 0.7).
- `claim-escalation.json`: the 48-hour escalation of #631 (`docs/AGENT_GUIDE.md`): a
  non-interrupting boundary timer on «Assess claim» that sends the claim to a supervisor after
  48 hours, a default flow, task variants, and an event gateway where the customer's confirmation
  races a five-day timer that closes the case with a terminate end event. Its base scenario runs
  for one hour: lengthen `run.duration` before simulating, or no case reaches the deadline.
- `pedido-edit.json`: a list of edit operations (#98) for `lila process edit` and the MCP tool
  `edit_process` on `examples/pedido.lila`: a "Charge" step with a duration and the cashier after
  "Take order", a rename, a type change, two lanes and a move to the kitchen lane.
- `pedido-edit-ambiguous.json`: an edit that is refused as a whole: removing the parallel split
  would leave its two branches with nowhere to come from.
- `pedido-patch.json`: a JSON Patch (#635) for `lila scenario patch` and the MCP tool
  `patch_scenario` on the `as-is` scenario of `examples/pedido.lila`: it checks that there are three
  cooks, then makes it four.

```bash
npx lila process create --outline examples/outline/credit-application.json -p credit.lila --dry-run
npx lila process create --outline examples/outline/claim-escalation.json -p claims.lila --dry-run
npx lila process edit -p examples/pedido.lila --ops examples/outline/pedido-edit.json --dry-run
npx lila scenario patch examples/pedido.lila as-is --patch examples/outline/pedido-patch.json --save-to to-be-4-cocineros --dry-run
```

Assumptions: arrivals are the app's defaults for a new process (20 cases, one per minute) and the
steps without a duration take no time; edit `as-is.scenario.json` in the app or with
`patch_scenario` for anything else. Run from the repository root after `npm ci` and
`npm run build`. See `docs/CLI.md` and `docs/MCP.md`.
