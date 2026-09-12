# Credit card issuance at a department store

A customer walks into a department store and applies for its credit card. An account executive
fills in the application and copies the ID document; a credit analyst checks the credit bureau and,
if the record is clean, assesses the debt capacity; if the applicant is eligible, the analyst opens
the account, computes the payment capacity and assigns the credit limit; a production operator
prints the plastic and the executive hands it over. Two exclusive gateways send the rest of the
applicants home: 40 % fail the bureau check, and 30 % of those who pass it fail the debt
assessment.

One 8-hour shift, 10 applications per hour, three roles:

| Role | Key | Capacity | Cost per busy hour |
|---|---|---|---|
| Account Executive | `executive` | 3 | 100 $ |
| Credit Analyst | `analyst` | 2 (3 in the TO-BE) | 120 $ |
| Production Operator | `operator` | 1 | 80 $ |

| Task | Lane | Time |
|---|---|---|
| `Task_FillApplication` | Account Executive | 5 min |
| `Task_CopyId` | Account Executive | 2 min |
| `Task_CheckBureau` | Credit Analyst | 1 min |
| `Task_DenyBureau` | Credit Analyst | 2 min |
| `Task_InformBureauDenial` | Account Executive | 1 min |
| `Task_AssessDebt` | Credit Analyst | 20 min |
| `Task_DenyDebt` | Credit Analyst | 2 min |
| `Task_InformDebtDenial` | Account Executive | 1 min |
| `Task_OpenAccount` | Credit Analyst | 3 min |
| `Task_ComputePaymentCapacity` | Credit Analyst | 2 min |
| `Task_AssignCreditLimit` | Credit Analyst | 1 min |
| `Task_PrintCard` | Production Operator | 10 min |
| `Task_DeliverCard` | Account Executive | 5 min |

Files:

- `model.bpmn`: one pool, three lanes, 13 tasks, 2 XOR gateways, 1 start event and 3 end events,
  with English ids and full BPMNDI so it renders in bpmn-js.
- `as-is.scenario.json`: today's operation, two credit analysts.
- `to-be-3-analistas.scenario.json`: inherits the AS-IS through `extends` and only raises the
  analyst capacity to three.

Spanish glossary of the original task names: *Llenar solicitud*, *Sacar copia de la
identificación*, *Consultar el buró de crédito*, *Rechazar por buró*, *Informar el rechazo por
buró*, *Evaluar la capacidad de endeudamiento*, *Rechazar por endeudamiento*, *Informar el rechazo
por endeudamiento*, *Aperturar la cuenta*, *Calcular la capacidad de pago*, *Asignar el límite de
crédito*, *Imprimir la tarjeta*, *Entregar la tarjeta*.

## Modelling assumptions

- **Duplicated denial path, by choice now.** Each gateway keeps its own `Task_Deny…` /
  `Task_Inform…` pair and its own end event, which is what makes the two rejection causes readable
  on the diagram and countable separately. It is no longer a limitation: since ADR-028 a flow
  leaving a diverging XOR can declare `conditions` and route on the flow the case already took, so
  **one** shared pair reached from both gateways ends in the right end event all the same. The
  shared-pair version of this model is
  `packages/engine/test/fixtures/tarjeta-shared-denial.bpmn` (rules R-COND-1…5 in
  `docs/SEMANTICS.md` § 6.1).
- **No persistent resource identity.** "The same executive who took the application delivers the
  card" is not expressible: pools are interchangeable units, so `Task_DeliverCard` takes whichever
  executive is free.
- **Payroll is computed outside the engine.** `costPerHour` charges **busy** time, so the run's
  `totalCost` is the cost of the work actually done, not the payroll. The shift costs
  3 × 100 + 2 × 120 + 1 × 80 = **620 $/h**, i.e. **4 960 $** for the 8-hour day, whatever the
  utilization. Compare that figure against the engine's cost when you want the idle-time bill.
- **Exponential arrivals, constant task times.** Arrivals are `exponential` with a mean of 360 s
  (10 per hour); every task time is `constant`, exactly as stated in the case.
- **30 replications, no warmup.** The shift is 8 hours long, so there is no steady state to warm up
  into: the interesting behaviour *is* the transient of a queue building up during the day.
- **Cases open at close are counted as in process.** The run cuts at 16:00 and everything still in
  the pipeline lands in `process.inFlight`, neither completed nor rejected.
- Lanes are labels only; resources are assigned task by task in the scenario.

## Analytic check

Analyst minutes consumed per arrival:

```
1 (bureau) + 0.4 × 2 (deny) + 0.6 × 20 (debt) + 0.18 × 2 (deny) + 0.42 × 6 (open + compute + limit)
= 1 + 0.8 + 12 + 0.36 + 2.52 = 16.68 min
```

At 10 arrivals per hour that is **166.8 analyst-minutes per hour** against the **120** two analysts
supply: ρ ≈ **1.39**. With three analysts (180 min/h) ρ ≈ **0.93** — tight, but no longer divergent.
The executive consumes ≈ 9.7 min per arrival (5 + 2 + 0.4 × 1 + 0.18 × 1 + 0.42 × 5) against
180 min/h, ρ ≈ **0.54**. The analyst is the bottleneck, and no amount of extra executives moves it.

## Running it

From the repository root, after `npm ci && npm run build`:

```bash
node packages/engine/bin/lila.js validate examples/tarjeta-credito/model.bpmn
node packages/engine/bin/lila.js run examples/tarjeta-credito/model.bpmn \
  examples/tarjeta-credito/as-is.scenario.json --seed 42 --replications 30
node packages/engine/bin/lila.js run examples/tarjeta-credito/model.bpmn \
  examples/tarjeta-credito/to-be-3-analistas.scenario.json --seed 42 --replications 30
node packages/engine/bin/lila.js compare examples/tarjeta-credito/model.bpmn \
  examples/tarjeta-credito/as-is.scenario.json \
  examples/tarjeta-credito/to-be-3-analistas.scenario.json --seed 42 --replications 30
```

## Reference results

Mean over 30 replications, seed 42, one 8-hour shift:

| | AS-IS (2 analysts) | TO-BE (3 analysts) |
|---|---|---|
| Applications received | 80.5 | 80.5 |
| Rejected by the bureau | 24.1 | 30.7 |
| Rejected for debt capacity | 7.7 | 11.6 |
| Cards delivered | 13.9 | 26.2 |
| Cases closed (any end event) | 45.7 | 68.5 |
| In process at 16:00 | 34.8 | 11.9 |
| Average cycle time | 110.5 min | 57.8 min |
| Cycle time of delivered cards (`byEndEvent.End_CardDelivered`) | 171.7 min | 93.9 min |
| Delivered within 30 min (`run.serviceLevel: 1800`) | 0 % | 0 % |
| Account Executive utilization | 45.7 % | 50.7 % |
| Credit Analyst utilization | **95.4 %** | 83.1 % |
| Production Operator utilization | 29.5 % | 55.8 % |
| Bottleneck (top `resourceWait`) | `Task_CheckBureau`, 2 303 min | `Task_CheckBureau`, 628 min |
| Average wait at `Task_CheckBureau` | 33.6 min | 7.9 min |
| Engine cost (busy time only) | 3 117 $ | 3 969 $ |

Reading it: with two analysts the store loses more than a third of its applicants to the clock —
almost 35 of 80 applications are still open when the store closes, and only 14 cards leave the
building. The third analyst nearly doubles the cards delivered (26.2), cuts the cycle time in half
and moves the pressure downstream; the 30-minute delivery promise is still not met in either
scenario, because the analyst path alone carries 27 minutes of work per approved card. The single
production operator jumps from 29.5 % to 55.8 % utilization and becomes the next constraint to watch.

A note on the saturation warning: the analyst is saturated in the analytic sense (ρ ≈ 1.39), but the
run does **not** emit `W-RECURSO-SATURADO`. That check compares the queue attributed to a full pool
against what the pool served, and in this topology six of the seven analyst tasks sit *downstream*
of another analyst task: the analyst throttles its own demand, so the measured ratio stays near 1.0
however long the horizon. `Task_CheckBureau`'s queue — the only analyst demand not gated by the
analyst — is where the saturation actually shows, and it is the top bottleneck in both scenarios.
