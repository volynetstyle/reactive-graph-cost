# M6: Alien Signals on dense slots, results

Protocol: [M6-ALIEN-DENSE-PROTOCOL.md](M6-ALIEN-DENSE-PROTOCOL.md). Numbers:
`paper/data/results.json`, key `m6`, and `paper/tables/endtoend*.tex`.

**Result.** Behaviour preserved. No general end-to-end gain in time. Less memory and collector
work under churn. Relations invisible to the collector.

| Gate | Result |
| --- | --- |
| Alien's corpus | 198 of 198 |
| differential search against frozen | 0 of 4,000 differ |

| Workload | Dense / frozen, median | Outcome by the protocol's rule |
| --- | ---: | --- |
| `system` | 0.78 | dense faster |
| `propagate` | 1.23 | about equal: ranges overlap |
| `dynamic` | 1.00 | about equal; allocation 1,152 to 461 MB, GC 149 to 21 ms per replay |
| `create` | 2.53 | dense slower |
| `app` | 1.08 | about equal |

By the protocol: integration costs consumed the layout gain on these workloads, and
representation alone does not predict runtime performance.

| Retention probe | Frozen | Dense |
| --- | ---: | ---: |
| unwatched linked graph dropped, collected of 20 | 20 | 0 |
| graph released through its effect, collected of 20 | 20 | 20 |

The prediction held. This is the outcome M4.5 listed in advance as "only GC integration
differentiates": if anything, the primitive is narrower than a graph. It is not shown to pay.

## Deviations from the protocol

| Deviation | Reason |
| --- | --- |
| correctness: a link removed twice is reclaimed once | Alien unlinks twice during a walk; one test failed |
| correctness: the `depsTail` fix of M2.5 `wide-fix` applied | a node could name a removed link after reuse; 13 of 4,000 differed |
| correctness: the frozen `TypeError` on a missing subscriber list reproduced | 2 of 4,000 differed; frozen itself crashes there |
| replay counts raised after a first trial printed both variants | the trial replays took milliseconds. Counts were scaled to baseline time only, and the backend was not changed |
| `propagate` is reported about equal despite a median of 1.23 | the rule was fixed in advance |

The backend's layout was not tuned after any timing. SoA was not tried.
