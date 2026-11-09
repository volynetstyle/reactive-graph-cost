# M3.6: what three clients say about L0

Subjects: `quant-main@241a3b7`, `alien-signals@8734d38`,
`signal-polyfill@0.2.2` (`fba09f8`), and `tc39/proposal-signals@9124ed9` as a semantic
reference. Sources: [M1-QUANT-SYNTHESIS.md](M1-QUANT-SYNTHESIS.md),
[M2-ALIEN-SYNTHESIS.md](M2-ALIEN-SYNTHESIS.md),
[M3-POLYFILL-INVENTORY.md](M3-POLYFILL-INVENTORY.md),
[M3.5-ABLATIONS.md](M3.5-ABLATIONS.md).

This records evidence. It does not change [CONTRACT.md](../CONTRACT.md).

**Result.** The polyfill's behaviour, with the stable sink order the proposal asks for,
can be represented over permanent relations with stable identity, if directional
retention may change in place with activation. In the six probed scenarios, that
representation also holds the proposal's retention rule. This does not show that mutable
retention is the unique or minimal solution: the port as first built keeps retention
fixed and makes reverse incidence conditional.

A logical dependency and its activation are separate. For this client, activation has
two consequences, participation in push and right-to-left retention, and nothing yet
shows that they are independent of each other.

## Four subjects, not three

| Subject | Kind | Role |
| --- | --- | --- |
| Quant | executable | persistent-fact tracking |
| Alien | executable | subscription-occurrence tracking |
| polyfill `fba09f8` | executable | positions in arrays; design A as ported, design B as a variant |
| proposal `9124ed9` | text | what Signals should do; no conforming executable exists here |

The polyfill and the proposal disagree, so they stay in separate columns.

| Topic | Proposal | Polyfill |
| --- | --- | --- |
| sinks after a removal | ordered set (README:537) | swap-remove reorders them, and that reaches `notify` |
| sources | ordered set (:536) | array; `A, B, A` keeps a repeat |
| throwing `notify` | saved, run all, then throw (:492-495) | stops the push |
| `frozen` around hooks | required (:612-614, :625-627) | absent |

`stable-erase` is the polyfill with one of these differences removed. Calling it the
proposal would be wrong: the other three remain, in every variant. B-tail and B-retain
are compared to `stable-erase`, so the result above is about sink order and retention.

## Relation, decomposed

Statuses:

| Status | Meaning |
| --- | --- |
| used | the port relies on it; removal not run |
| observable | removal changes behaviour through the public API |
| normative | the proposal text requires it |
| replaceable | a removal was run and an alternative kept behaviour |
| not exercised | the client never reaches it |
| unresolved | evidence points neither way |
| representation-specific | true of one design of this client, not of the client |

| Property | Quant | Alien | polyfill | proposal |
| --- | --- | --- | --- | --- |
| existence of a dependency | used: one relation per pair | used: a subscription occurrence | representation-specific: a trace position; a relation only while live (A) or always (B) | normative: `sources` always |
| left incidence | used | used | representation-specific: client arrays; the store's left axis is never read, in A or B | normative: `sources` |
| right incidence | used | used | observable: `introspectSinks`, push | normative for watched signals only (:480, :555) |
| left order | used | observable in the search | used, in client arrays | normative (:440) |
| right order | unresolved | observable | observable, reaches `notify` | normative (:490, :537) |
| identity while live | used; S2 forces reuse on reading | used | representation-specific: none in the original; a handle in the port; survives re-activation in B | not specified |
| history, position | used: same pair, same relation, moved on the left | observable: re-subscription takes a new place, 63 to 7 of 4,000 | observable: position follows activation | normative by reading: added to `sinks` when watched (:609-611) |
| activation | not exercised: no liveness policy found | used: client policy, 651 zero-subscriber transitions | observable: explicit live state | normative |
| retention | not exercised | not exercised | representation-specific: fixed in A, mutable in B | normative (:391) |
| payload | replaceable to one word | used, count sufficient; domain unresolved | not exercised in A; one activation bit in B; versions stay in client arrays | not specified |
| post-removal information | extension lane only | observable; store retirement replaceable by a client log | not exercised: the walk continues by position | not exercised |

### What happens to an unwatched dependency

Activation produced three different designs, and they answer a question M0 did not ask.

| Design | The dependency fact when unwatched | Cost of re-watching |
| --- | --- | --- |
| Alien | **discarded**; the computed is marked dirty and its dependencies disposed (`index.ts:73-78`) | recompute, new relations |
| polyfill A | kept outside the store | new relations; validation by polling, no forced recompute |
| polyfill B | kept as a relation | a flip and a move per dependency; the same validation |

Quant has no such transition. So existence and activation are separable, and whether
the dependency survives deactivation is itself a client policy.

## A against B

| | A: as ported | B-retain |
| --- | --- | --- |
| topology | conditional on liveness | permanent |
| retention | could be fixed | changes with activation |
| dependency trace | outside the store | in the store, but unread |
| structure changed by liveness alone | 13 births and deaths | 0 |
| extra on the corpus | none | 46 births, 13 flips, 13 retention changes, 59 skip steps |
| physical relations at the end | 20 | 59, of which 39 inactive |
| `moveAfter` | only to reproduce the swap | required at activation |
| store-level `collect` | not probed | 6 scenarios on the running port |

Both can express this client. Which is physically reasonable is unknown, and is a
question for the native milestones.

Two asymmetries:

- In A, retention of an unwatched dependency is not the store's business, because the
  trace is client arrays. By reading, a store-level `collect` alone would drop the
  source of a rooted unwatched computed. A depends on the host GC tracing those arrays,
  so two retention systems are in play. B has one.
- In B, the store holds every dependency on the left axis and the client does not read
  it. Replacing `producerNode` with the left axis was never built. **Dual incidence
  survives as an invariant. Its left half carries no load in this client.**

## M0 clauses under client pressure

| # | Clause | State after three clients |
| --- | --- | --- |
| 1 | `identity` | stable handles hold. "Retention is immutable" has its first direct counter-pressure, from design B only |
| 2 | `dual-incidence` | never violated by either design. M3.1 called A a conflict; the conflict was with mapping a dependency to a relation, not with the clause |
| 3 | `order` | strengthened: Alien and the polyfill observe right order, the proposal requires it. Left-order evidence stays uneven |
| 4 | `permutation` | moves hold. Its cost statement, births equal trace additions, fits Quant, Alien and B. Under A, 13 structural changes have no trace change behind them |
| 5 | `reachability` | first client witness. "Topology does not imply retention" is confirmed directly: an unwatched computed is collected despite reverse incidence. `lfp` still holds with `ρ` read at `collect`. The pressure is on when `ρ` may change, which lands on clause 1 |
| 6 | `gc-transparency` | exercised lightly, only by status after `collect` |
| 7 | `deferred-reuse` | no client support across three |
| 8 | `continuation` | no client support. Quant contradicts the chase in its extension lane, Alien does not distinguish it, the polyfill does not reach it |
| 9 | `metadata` | survives, meaning opaque. Not used at all by polyfill A |
| 10 | `multiplicity` | unclear. Quant keeps pairs unique above L0, Alien leaves a residue of 7, the polyfill keeps position repeats where the proposal says set |
| 11 | `failure-atomicity` | not relied on. Hook throws corrupt client state above it, and that is where port and original differ in lane E |
| 12 | `lifecycle` | consistent, not stressed |
| 13, 14 | opacity, no callbacks | held by all three ports |
| 15 | local complexity | not measured |

The revisit condition of the M0 decision on retention, "a port must change retention
without changing identity", is met only conditionally. A port must do so **if it chooses
permanent topology**.

## Reposition has three reasons

| Client | Axis | Reason | Status |
| --- | --- | --- | --- |
| Quant | left | tracking reorder, identity kept | used; forced by S2 on reading |
| Alien, variant | both | re-subscription, new place with old identity; not in literal Alien | replaceable, 7 of 4,000 residue |
| polyfill B | right | activation takes a new place | representation-specific |

The B case and the Alien variant are the same idea, which M2 stated: identity and
position in incidence order are separate dimensions. Only Quant's use is forced by the
client as written, since the polyfill needs a move only in design B, and Alien only in a
variant. A third client with an unforced use would change this.

## The sets

**Used in the store by all three as ported:**

```text
right incidence
endpoint access
relation creation and unlink
live relation identity, as a handle
```

Left incidence, left order and the mutable word have fallen out of this intersection,
because polyfill A keeps them in client arrays. All three clients still need an ordered
per-consumer trace. Whether it lives in the store is not forced by any of them.

**Client-specific pressure**

```text
Quant: identity-preserving reorder
Alien: observable right order; new-birth position for an existing pair
polyfill and proposal: right order by activation; retention following activation
```

**Client policies L0 carried without knowing them**

```text
Quant: pair uniqueness, when to reuse
Alien: dependency and ownership on one axis; discarding dependencies when unwatched
polyfill: transitive liveness, keeping the trace when unwatched
```

**Unresolved or unsupported**

```text
epochs, store-level retired readability
clause 8 chase, retirement chain, outermost-only quiescence
generation
payload domain and aliasing discipline
independence of push activity and retention
multiplicity as a requirement
```

## Limits

- All three are signal runtimes and can share a blind spot.
- The proposal column is partly reading. No conforming executable was run.
- B-GC was probed on 6 model cases and 6 scenarios on the running port, with an explicit
  collector. Nothing here concerns real GC, a write barrier, or native performance.
- B costs are from a 39-test behaviour suite.
- The search is one generator, 3000 programs per lane, with weak coverage of order. The
  order claim rests on two directed programs.
- B was not combined with the swap, so exact reproduction of the frozen polyfill by B is
  untested.

## Decisions

`CONTRACT.md` stays frozen as the original hypothesis. M3 is closed as a design input, on
the same terms as Quant and Alien.

Next, in order: M4A, a weak or liveness client, whose main question is whether activation
and retention are one bit or two. M4B, a non-reactive incremental client, for ordering,
identity, history and payload outside signals. Then M4.5, a decision on L0 v2.
