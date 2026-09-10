# Real Bizagi Modeler exports

These seven unmodified BPMN files were exported by Bizagi Modeler and published by the OMG
BPMN Model Interchange Working Group (BPMN MIWG). They exercise nested Bizagi extensions,
collaborations, lanes, subprocesses, gateways, boundary events and call activities.

## Provenance and attribution

Source: [BPMN Model Interchange Test Suite](https://github.com/bpmn-miwg/bpmn-miwg-test-suite),
under [Creative Commons Attribution 3.0 Unported](https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/master/LICENSE.txt).
Attribution belongs to the BPMN MIWG contributors; the fixtures retain their source license.

All files come from `Bizagi Modeler 2.8.0.8/` at commit
`9dec051a098387b856ae97992eba681d1bb70b35`. The version is taken from that upstream folder;
this version of Bizagi does not emit an explicit `exporterVersion` attribute. Files were
copied without modification from GitHub. The original checks found all seven well-formed
with `xmllint --noout`, 68–1142 case-insensitive Bizagi matches per file, and sizes below 2 MB.

## Included files

| File | Exact source URL | Size | Notable elements |
|---|---|---|---|
| `bizagi-miwg-A.1.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/A.1.0-roundtrip.bpmn | 16 KB | Baseline: two participants, one lane and three sequential tasks. |
| `bizagi-miwg-A.2.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/A.2.0-roundtrip.bpmn | 29 KB | Two exclusive gateways (split/join). |
| `bizagi-miwg-A.3.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/A.3.0-roundtrip.bpmn | 30 KB | One embedded subprocess and two boundary events. |
| `bizagi-miwg-A.4.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/A.4.0-roundtrip.bpmn | 55 KB | Three participants, message flows, two subprocesses and two lanes. |
| `bizagi-miwg-A.4.1-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/A.4.1-roundtrip.bpmn | 59 KB | A.4.0 variant with three lanes and a sid-prefixed process ID. |
| `bizagi-miwg-B.1.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/B.1.0-roundtrip.bpmn | 105 KB | Three call activities, parallel/exclusive gateways, user/service tasks, data objects and five participants. |
| `bizagi-miwg-B.2.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/B.2.0-roundtrip.bpmn | 301 KB | Five subprocesses, eleven boundary events, four gateway types, intermediate events and 85 sequence flows. |

Each file declares `xmlns:bizagi="http://www.bizagi.com/bpmn20"` locally on
`bizagi:BizagiExtensions`, with nested `BizagiProperties` and `BizagiProperty` elements on
most nodes. IDs typically use `_<uuid>` or `WFP-6-` forms; A.4.1 also exercises `sid-` IDs.
No IDs with spaces or colons were found in this corpus, so non-NCName coverage needs an
additional fixture.

## Coverage limitations

Other candidates without a verifiable source license were excluded. All seven retained files
come from the same Bizagi version. A licensed export from a newer version, ideally with a
non-NCName ID if that tool produces one, would extend coverage. Do not translate or rewrite
these third-party fixtures: their purpose is to preserve real exported XML.
