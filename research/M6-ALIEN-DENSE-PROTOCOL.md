# M6 protocol: Alien Signals on dense slots, end to end

Fixed before the backend was implemented or measured. Results go to
[M6-ALIEN-DENSE-RESULTS.md](M6-ALIEN-DENSE-RESULTS.md). A deviation is recorded there, not
absorbed here.

**Question.** Does the dense-layout advantage seen in tape replay survive inside a complete,
independent signal runtime, with its behaviour preserved?

## Subjects

| Name | Form |
| --- | --- |
| baseline | frozen `alien-signals@8734d38`, unmodified |
| dense | the same source with `Link` objects replaced by slots in one `Int32Array` |

The dense form is one layout, AoS with 7 words per link, chosen in advance because `unlink` and
`link` touch most fields of one link together. SoA is not tried. The backend is not tuned after
the first measurement. A correctness bug may be fixed, and is recorded.

Node objects stay JavaScript objects and own a `slot` field, since Alien owns its nodes. No
`WeakMap` is added: that is an architecture Alien does not have, and the paper measures it
separately. Links name nodes by integer, resolved through a table `slot -> node`.

Algorithm unchanged. `system.ts` is rewritten line for line, `index.ts` is derived by a script.
A removed link stays readable, as Alien's walks require, so slots are reclaimed only at a
quiescent point.

## Correctness gates

Both must pass before any timing is reported.

- Alien's 198 tests.
- The 4,000 differential programs against the frozen source. Same search as every Alien variant.

## Retention check

A typed array holds no references, so the collector cannot see the edges, and the table is a
root while a node has links. Stated in advance as a predicted difference:

| Probe | Prediction |
| --- | --- |
| an unwatched, linked graph is dropped by the program | frozen is collected; dense is **retained** |
| a graph is disposed through its effect or scope | both release it |

Reported whichever way it lands. If the prediction holds, it limits the claim: dense layout in
JavaScript does not get relation retention from the collector.

## Workloads

One source of parameters: calibrated on the baseline only, so a replay takes around a second.

| Name | Exercises |
| --- | --- |
| `system` | `createReactiveSystem` directly: link, unlink, propagate, no public API, no user code |
| `propagate` | static graph: chains of computeds with effects, repeated writes |
| `dynamic` | structural: each computed switches between two sets of dependencies |
| `create` | build and dispose a graph inside a scope |
| `app` | end to end: a grid of cells with real arithmetic and formatting, batched random writes |

## Measurement

Same machine and pinning as the physical campaign. One fresh process per variant, workload and
run, 10 runs, the variant order alternating. Each process does one warm-up replay and 15 timed
replays, and reports the median.

| Metric | Source |
| --- | --- |
| wall time per replay | `process.hrtime` |
| allocated bytes per replay | `v8.getHeapStatistics().total_allocated_bytes` |
| live bytes after setup | heap plus array buffers, after collections, less a baseline |
| peak | `process.resourceUsage().maxRSS` |
| GC time | `perf_hooks` GC entries |

**The boundary is reported apart from internal operations.** A counted build gives the number of
`slot -> node` resolutions per replay. A separate microbenchmark gives the unit cost of a
resolution against a direct field read. Their product is an estimate of the boundary's share and
is labelled as one. `system` carries the internal cost.

## Reading the outcome

| End-to-end result | Claim |
| --- | --- |
| dense faster, behaviour preserved | the physical benefit is reachable inside a real independent runtime without VM ownership |
| about equal | integration costs consume the layout gain; representation alone does not predict runtime performance |
| dense slower | dense layouts are expressible and locally advantageous in JavaScript; no end-to-end advantage in a complete runtime is established |

"About equal" means the process ranges overlap. Mixed results across workloads are reported per
workload, without a single summary number.
