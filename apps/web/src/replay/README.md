# Replay inference

`buildReplay` reads replication 0. Activity lifecycles and resource assignments come from
`EventLogRow`; it does not rerun simulation or consume random streams. `stateAt` scans the
result without a mutable cursor, so seeking backwards gives the same state as a fresh lookup.

## Counters and concurrent paths

An activity occurrence is grouped by `activityInstanceId`, not by case or element. Multiple
allocation rows count once for its lifecycle and independently for occupied resource units.
Each completed occurrence releases its own normal continuation. Silent AND forks split that
continuation; AND joins count every arrival and release once per incoming-flow count. The
optional `ReplayPassage.completed` override represents an arrival that has not released yet.

An interrupted occurrence has no normal continuation. Its `observedUntil` identifies the firing
time; a unique attached interrupting boundary identifies the branch. Non-interrupting firings
need an observed branch activity enabled during the host's open interval and uniquely attributable
to that boundary occurrence. A boundary has no incoming sequence flow: its outgoing hop starts
at the firing time, while the host's independent continuation starts at its completion time.

End overlays count **tokens**, matching `result.elements[endId].started/completed` for identifiable
transitions. `process.byEndEvent` counts **case outcomes**, attributing each case to the end that
consumes its last token. One case with two concurrent branches can therefore produce `1/1` on
both end overlays but only one completed case in `byEndEvent`. Tests compare the same replication,
without warmup, and assert these two meanings separately. Replay still includes pre-warmup log
activities; aggregate results filter their cohort as documented in `RESULTS_FORMAT.md`.

## Evidence and limitations

- Tasks and unattached timers are observation barriers. Inference never crosses a missing
  activity row to find a later end, including when `truncated` is true. A completed activity
  can still establish a direct deterministic end even in a truncated prefix.
- XOR/event-gateway choices require a uniquely evidenced outgoing route to an activity at that
  instant. Multiple routes to the same observation do not justify choosing the shortest one.
  An XOR leading only to end events has no such witness; no end is assigned arbitrarily.
- An unobserved non-interrupting branch going straight to an end cannot establish whether or
  when it fired. Several boundaries sharing a branch, overlapping host occurrences, or a
  normal continuation explaining the same observation can also make attribution ambiguous.
  No firing is reconstructed by resampling the configured timer.
- OR activation marks are absent from the log. This implementation stops at converging OR
  gateways rather than guessing their release, and follows only evidenced outgoing OR branches.
  Later logged activities still contribute their own lifecycle and identifiable continuation.
- Silent cycles and paths requiring an unknown ordering of simultaneous observations are not
  reconstructed by decoding activity IDs. IDs are opaque; they are not token lineage or event
  sequence numbers. The inference is conservative, not a replacement execution engine.
- A case with no activity rows supplies no replay evidence. Logs capped in the middle of an
  allocation group also cannot recover omitted resource allocations.

The short travel duration is only a display effect. Counter timestamps remain the observed
transition times; drawing a dot never delays or creates a completion.

## Regression fixtures and validation

`../../test/fixtures/replay/concurrent-boundary.bpmn` and its scenario are original synthetic
regression inputs for #363, with BPMN DI for browser inspection. One request takes 200 seconds;
a non-interrupting deadline at 100 seconds starts a five-second reminder. Both tokens complete,
but only the host's end closes the case. There are no resources or private/reference inputs.
The inline models in `replayConcurrent.test.ts` isolate forks, joins, loops, allocations,
interruptions, ambiguous choices and truncation using synthetic constant durations.

Run the directed tests after `npm run build`:

```sh
npx vitest run apps/web/src/replay
npm run build:pages
LILA_E2E_CONCURRENT=1 LILA_E2E_PORT=18763 LILA_E2E_CDP_PORT=19363 \
  LILA_E2E_SCREENSHOT=/tmp/lila-363-animate.png node tools/e2e-replay.mjs
```

Choose unused ports for each run. The browser uses a fresh temporary profile. The E2E compares
DOM overlays with the saved run, verifies both end counters and the boundary, and checks reset
and play/pause. Inspect the saved screenshot as well. The default E2E still exercises the
service-request fixture. Neither these checks nor implementation self-review constitute the
independent adversarial QA required before merge.
