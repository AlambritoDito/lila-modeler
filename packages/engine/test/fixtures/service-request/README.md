# Service-request regression fixture

A synthetic service workflow for automated engine and UI validation. Its inputs are test
parameters, not operational benchmarks. This fixture is maintained with the test suite.

- `model.bpmn`: three resource lanes, thirteen tasks, two exclusive decisions and three outcomes.
- `as-is.scenario.json`: baseline capacity, fixed task durations and seeded arrivals.
- `increased-capacity.scenario.json`: an `extends` override that adds one reviewer.
- `../service-shared-denial.bpmn`: shared rejection tasks for conditional-routing tests (ADR-028).

The tests exercise resource saturation, capacity changes, outcome accounting, service-level
metrics, lane assignments, scenario editing and event-log replay. Assertions compare engine
results and check invariants.

BPMN IDs and their references must be changed together. The random streams are keyed by element
ID, so renaming fixture IDs can change seeded sample counts without changing engine semantics.
