"""Conversión del modelo del oráculo al par (BPMN, JSON) que come Prosimos — LILA-052.

Prosimos (https://github.com/AutomatedProcessImprovement/Prosimos) no lee el escenario de Lila:
necesita un BPMN y un JSON de parámetros con su propio vocabulario (`resource_profiles`,
`resource_calendars`, `arrival_time_distribution`, `task_resource_distribution`, …). Este módulo
hace esa conversión **a mano** para el modelo que ya comparan `simulate()` y el oráculo SimPy
(`tools/oracles/des_simpy.py`): 5 tareas secuenciales, un pool de recursos por tarea con
capacidad 1-3, llegadas exponenciales y calendario 24×7.

Sólo stdlib: se ejecuta con cualquier Python 3.11+, no necesita el venv de Prosimos.

Desviación deliberada respecto de `des_simpy.py`/`theory-simpy.test.ts` (documentada en
`docs/ORACLES.md`): **las duraciones son uniformes, no triangulares**. Prosimos no implementa la
triangular — `DistributionType.TRIANGULAR` existe en el enum de `pix_framework` pero
`DurationDistribution.from_dict` no tiene rama para ella y devuelve `None`, que revienta al
muestrear. La equivalente más cercana que ambos motores muestrean **idénticamente** es la
uniforme sobre el mismo `[min, max]` (Lila: `{"type":"uniform","min":a,"max":b}`; Prosimos:
`st.uniform.rvs(loc=a, scale=b-a)`), así que el modelo compartido con Prosimos usa uniforme en
vez de aproximar la triangular con otra familia: comparar dos motores exige que muestreen la
misma ley, no una parecida.

Uso: `python tools/oracles/to_prosimos.py --out-dir /tmp/lila-prosimos-model`
"""

import argparse
import json
import os

# Mismas 5 tareas, capacidades y `[min, max]` que `tools/oracles/des_simpy.py` y
# `packages/engine/test/theory-prosimos.test.ts`; duración uniforme (ver docstring).
TASKS = [
    {"id": "T1", "cap": 2, "min": 5, "max": 15},
    {"id": "T2", "cap": 3, "min": 10, "max": 30},
    {"id": "T3", "cap": 1, "min": 3, "max": 8},
    {"id": "T4", "cap": 2, "min": 8, "max": 20},
    {"id": "T5", "cap": 1, "min": 2, "max": 7},
]

ARRIVAL_MEAN = 10.0  # segundos, media de la exponencial entre llegadas

PROCESS_ID = "Process_TheoryProsimos"
START_ID = "Start"
END_ID = "End"

# 24×7: un tramo por día de 00:00:00 a 23:59:59.999. Prosimos no acepta "24:00:00" (lo parsea
# `pandas.Timestamp`, que exige una hora válida), así que el hueco de 1 ms por medianoche es
# inevitable; sobre una corrida de ~14 h afecta a lo sumo a un cruce y a una fracción de
# milisegundo de disponibilidad — muy por debajo de la tolerancia estadística del fixture.
WEEK_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
CALENDAR_ID = "24x7"
CALENDAR_247 = [
    {"from": day, "to": day, "beginTime": "00:00:00.000", "endTime": "23:59:59.999"}
    for day in WEEK_DAYS
]


def build_bpmn() -> str:
    """BPMN 2.0 mínimo: start → T1 → … → T5 → end, sin gateways ni diagrama."""
    chain = [START_ID] + [t["id"] for t in TASKS] + [END_ID]
    flows = [(f"Flow_{chain[i]}_{chain[i + 1]}", chain[i], chain[i + 1]) for i in range(len(chain) - 1)]

    def arcs(node_id: str) -> str:
        out = "".join(f'\n      <incoming>{f}</incoming>' for f, _, to in flows if to == node_id)
        out += "".join(f'\n      <outgoing>{f}</outgoing>' for f, src, _ in flows if src == node_id)
        return out

    body = [f'    <startEvent id="{START_ID}" name="{START_ID}">{arcs(START_ID)}\n    </startEvent>']
    for task in TASKS:
        body.append(f'    <task id="{task["id"]}" name="{task["id"]}">{arcs(task["id"])}\n    </task>')
    body.append(f'    <endEvent id="{END_ID}" name="{END_ID}">{arcs(END_ID)}\n    </endEvent>')
    for flow_id, src, dst in flows:
        body.append(f'    <sequenceFlow id="{flow_id}" sourceRef="{src}" targetRef="{dst}" />')

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"\n'
        '             id="Definitions_TheoryProsimos" targetNamespace="http://lila.modeler/oracles">\n'
        f'  <process id="{PROCESS_ID}" isExecutable="true">\n'
        + "\n".join(body)
        + "\n  </process>\n</definitions>\n"
    )


def build_params() -> dict:
    """JSON de parámetros de Prosimos equivalente al escenario de Lila del oráculo."""
    return {
        "resource_profiles": [
            {
                "id": f"pool_{t['id']}",
                "name": f"pool_{t['id']}",
                # `amount` es la capacidad: Prosimos expande el pool a N recursos de 1 unidad,
                # que es exactamente `resources[id].capacity` en Lila (docs/SCENARIO_FORMAT.md §2).
                "resource_list": [
                    {
                        "id": t["id"],
                        "name": t["id"],
                        "cost_per_hour": 0,
                        "amount": t["cap"],
                        "calendar": CALENDAR_ID,
                        "assignedTasks": [t["id"]],
                    }
                ],
            }
            for t in TASKS
        ],
        "resource_calendars": [{"id": CALENDAR_ID, "name": CALENDAR_ID, "time_periods": CALENDAR_247}],
        "arrival_time_calendar": CALENDAR_247,
        # expon en Prosimos = st.expon.rvs(loc=min, scale=mean-min): con min=0 es la exponencial
        # de media `ARRIVAL_MEAN`, igual que `{"type":"exponential","mean":10}` en Lila. El `max`
        # es el truncamiento por rechazo de `DurationDistribution.generate_sample`: se pone en
        # 1e6 s (≈ 1e5 medias) para que su efecto sea nulo.
        "arrival_time_distribution": {
            "distribution_name": "expon",
            "distribution_params": [{"value": ARRIVAL_MEAN}, {"value": 0.0}, {"value": 1e6}],
        },
        "gateway_branching_probabilities": [],
        "task_resource_distribution": [
            {
                "task_id": t["id"],
                "resources": [
                    {
                        "resource_id": t["id"],
                        "distribution_name": "uniform",
                        "distribution_params": [{"value": float(t["min"])}, {"value": float(t["max"])}],
                    }
                ],
            }
            for t in TASKS
        ],
        "event_distribution": [],
    }


def write_model(out_dir: str) -> tuple[str, str]:
    os.makedirs(out_dir, exist_ok=True)
    bpmn_path = os.path.join(out_dir, "model.bpmn")
    json_path = os.path.join(out_dir, "params.json")
    with open(bpmn_path, "w", encoding="utf-8") as handle:
        handle.write(build_bpmn())
    with open(json_path, "w", encoding="utf-8") as handle:
        json.dump(build_params(), handle, indent=2)
    return bpmn_path, json_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()
    print("\n".join(write_model(args.out_dir)))
