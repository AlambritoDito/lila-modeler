# Reconstructions of Bizagi's public simulation examples

LILA-010, corrected by LILA-187. Each of the four level folders contains `model.bpmn`,
`scenario.json` and `expected.json`. The expected values cite Bizagi's public tutorial pages
and screenshots. Prose values retain their `quote`/`quotes`; screenshot transcriptions retain
an image `source` and provenance note. Values were not invented or calibrated against Lila.

All levels use the [Emergency attendance process](https://help.bizagi.com/platform/en/simulationexample2.png):

```text
Receive Emergency Report (4 min) → Classify Triage (5 min) → XOR "Triage type"
  Red    50% → AND (Manage patient entry 11 min || Pick up patient 20 min) → Authorize Entry (4 min) → Red Triage end
  Yellow 30% → Arrive at patient place QAV (7 min) → Yellow Triage end
  Green  20% → Arrive at patient place BA (10 min) → Green Triage end
```

The timed examples use constant arrivals every 5 minutes, 2017 tokens and no `duration`:
all arrivals drain to completion. LILA-187 corrected the original reconstruction's sequential
topology, exponential arrivals and swapped level-1 labels.

## Level 1 — route validation

[Source tutorial](https://help.bizagi.com/platform/en/level_1_example.htm).
No processing times, resources or costs. `triggerCount: 1000` without `interTriggerTimer`
produces 1000 arrivals at t = 0 (R-ARR-1). The BPMN uses the corrected tutorial topology,
including the converging parallel gateway. Counts from the broken topology remain in
`expected.json` only as historical data.

The [published result table](https://help.bizagi.com/platform/en/processvalidation42.png)
assigns 483 completions to Red, 315 to Yellow and 202 to Green; the original reconstruction
had the labels reversed.

## Level 2 — time analysis

[Source tutorial](https://help.bizagi.com/platform/en/level_2_example.htm).
Resources have infinite capacity. Published cycle times are minimum 16 minutes, maximum
33 minutes and mean 25 minutes 3 seconds. The complete per-element table is transcribed from
[the screenshot](https://help.bizagi.com/platform/en/processvalidation47.png).
Its exact 2017 arrivals (10080/5 + 1) support constant interarrival times, not a Poisson process.
The separate abstract 100-token example on the same page is not modeled in these folders.

## Level 3 — resource analysis

[Source tutorial](https://help.bizagi.com/platform/en/level_3_example.htm).
The published comparison uses two nurses (99.85% utilization, mean cycle 3 h 39 min) and
three nurses (69.75%, 25 min 15 s). Both are recorded in `expected.json`; the scenario uses
the recommended three-nurse configuration, also used as the level-4 starting point.

The prose requirement table swaps the QAV and BA vehicles relative to their task names.
The [cost table](https://help.bizagi.com/platform/en/resourcesanalysis3.png) instead supports
QAV with Quick Attention Vehicle (11124 = 618 × 18) and BA with Basic Ambulance
(9825 = 393 × 25). The scenario uses this cost-consistent assignment; both pools have capacity 2.
See D8 in [the reference comparison](../../docs/BIZAGI_PARITY.md).

## Level 4 — calendar analysis

[Source tutorial](https://help.bizagi.com/platform/en/level_4_example.htm).
Adds morning 06–14, day 14–22 and night 22–06 shifts. Each role has one pool whose capacity
can vary by calendar interval, as introduced by LILA-164 and specified in R-CAL-11. Nurse
and Ambulance remain at capacities 3 and 4 throughout all shifts. Night is represented by
two intervals spanning midnight. The earlier three-pools-per-role workaround is no longer used.

The documented 30-replication comparison found zero off-hours wait for the four shift-dependent
tasks, mean cycle 1521.5 s versus 1526 s published (−0.30%), and utilization/cost of all six
resources within ±5% (worst −2.60%, Quick Attention Vehicle). The BA task queues again,
with maximum wait 970 s, because its afternoon capacity drops to 1.

D7 tracks the utilization denominator (Bizagi's declared 43200 min versus Lila's measured
10862 min, converted exactly by the test) and BA wait discrepancies (+7.8% maximum,
−24.5% mean) against one published run with only 5.6% pool utilization.

## Verification and known differences

- `bizagi-levels.test.ts`: fixture shape, well-formed BPMN with DI, resolvable flow references,
  scenario rules R3/R6/R9/R13 and source URLs.
- `bizagi-parity.test.ts`: runs the committed scenarios and records which published values
  fall inside or outside ±5%; a change of classification fails the test.
- `bizagi-levels.qa.test.ts`: supported BPMN, NCName IDs, published JSON Schema validation,
  no lint except `W-ELEMENTO-SIN-PARAMETROS`, XOR probabilities summing to 1 and complete provenance.

Documented differences are D2 (level-1 Yellow count, −5.4%), D5/D6 (level-3 maximum with three
nurses and saturated mean with two), and D7 (level-4 denominator and BA waits). The
[reference comparison](../../docs/BIZAGI_PARITY.md) is the source of truth for this list.
Bizagi is a reference and inspiration; this project is independent of Bizagi.
