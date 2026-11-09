# M2.6 and M2.7: what Alien says about L0, and Quant × Alien

Subject: `alien-signals@8734d38`. Sources: [M2-ALIEN-INVENTORY.md](M2-ALIEN-INVENTORY.md),
[M2-ACCOUNTING.md](M2-ACCOUNTING.md), [M2.5-ABLATIONS.md](M2.5-ABLATIONS.md), and for
Quant [M1-QUANT-SYNTHESIS.md](M1-QUANT-SYNTHESIS.md).

This records evidence from two clients. It does not change [CONTRACT.md](../CONTRACT.md).

**Result.** Two independent tracking machines agree on the structure and disagree
on the history of a relation. Quant treats a dependency as a persistent fact whose
identity survives reordering. Alien treats a reappearing dependency as a new
subscription with a new position among subscribers, and that difference reaches
the order in which effects run.

Identity and subscription history are largely independent. A single relation moved
on both axes reproduces nearly all of Alien's re-subscription behaviour: the search
differences fall from 63 to 7 of 4,000.

The walk-safe retirement protocol has now lost client-minimality twice, within the
tested domain. Quant gave no contract witness. Alien gave a real one, and a
client-side log satisfied it with no epoch in the store. Needing old information
does not imply keeping the old relation alive.

## Evidence used

| Term | Meaning |
| --- | --- |
| corpus | Alien's 198 tests, 179 of them the external conformance suite |
| search | 4,000 random public-API programs, without nested effects or scopes |
| frozen behaviour | what `8734d38` does through its public API; not necessarily an upstream promise |
| ablated | the removal was run |
| read | concluded from the source only |

## L0_A

A surviving upper bound after M2.5, not a proven minimum:

```text
relation identity while live
left and right incidence
left order
right order
endpoint access
relation creation
unlink of a known relation
insertion at a left cursor
one opaque mutable word per relation
new-birth semantics for an existing pair, by parallel relations or an equivalent
```

Alien needs positioned insertion of a new relation and does not need repositioning
of an existing one. L0's `moveAfter` happens to provide both. They are two
capabilities.

## A_A

Alien-specific machinery above the substrate:

```text
depsTail cursor and subsTail
meaning of the stamp (pass identity)
flags and propagation state
telling ownership from dependency by endpoint kind
unwatched policy
effect queue
cleanup and ownership lifecycle
```

`prevDep` and `prevSub` are efficient representation, not semantic minimum:
forward walks replace them at 1,111 and 168 extra visits over the corpus.

## Capability matrix

| Capability | Status for Alien | Basis |
| --- | --- | --- |
| left and right incidence | used; not ablated | read, corpus |
| left order | **observable in the search**; corpus does not distinguish | ablated: reverse validation, search 1,589 of 4,000 differ. Moving a repeated read away from its first position also differs (478) |
| right order | **observable** | ablated: #216, #200, #121 |
| reverse order of dependencies | **observable** | ablated: LIFO tests |
| left predecessor state | space and time tradeoff | ablated |
| right predecessor state | space and time tradeoff | ablated |
| insertion at a left cursor | used, 0.8% of corpus links | measured; the ratio is not a frequency |
| moving an existing relation | unused by Alien; can stand in for most re-subscription | read; `multi-reuse-unread`, search 7 of 4,000 differ |
| parallel relations | mostly replaceable; a residue remains | ablated: forbidding them differs on 231, unique pair moved on both axes on 7, of 4,000. Corpus distinguishes none |
| re-subscription going to the right tail | needed to reproduce frozen behaviour; not shown to be an abstract requirement | ablated: without it 63 differ, with it 7 |
| one opaque mutable word | sufficient in count | port |
| payload domain and aliasing discipline | **unresolved**: 1 and 2 bits collide, wider not tested | ablated by search |
| relation roles | L0 carries both without a role bit | port |
| state of a removed link, as of removal | **observable** | ablated: #141, #201 to #203 |
| epochs in the store | replaceable by a client log | ablated: R5 |
| store-level retired readability | replaceable by a client log | ablated: R5 |
| idempotent second unlink | artefact of this construction | ablated: R1, `wide-fix` |
| clause 8 chase to first live | no evidence for this rule | 0 of 98 reads distinguish it from the raw successor |
| retirement chain | no evidence | not reached |
| outermost-only quiescence | no evidence | not ablated |
| generation, no aliasing | R5 relies on it, not ablated | read of R5 |
| directional reachability, GC pruning | deferred | not exercised |
| local complexity | not measured | |

Two notes on R5. It keeps its log until the outermost public call ends, so a
quiescent point still exists; it has moved into the client. And R5, as implemented
over reusable store handles, relies on non-aliasing generations. A client that
kept a fresh record of its own per relation would not need them, but that brings
back a client object per relation.

The 7 remaining differences are not explained. The shrunk witness writes a signal
from inside an effect; whether all 7 do was not checked. They may come from the
window in which Alien's old and new relations coexist.

## Retirement across both clients

| Mechanism | Quant | Alien |
| --- | --- | --- |
| state needed after a mutation or callback | extension lane only | **observable** |
| store-level retired readability | no evidence | not needed in the tested domain |
| epochs | no evidence | replaceable by a client log |
| raw frozen successor | W1, W3 only | what R5 keeps |
| chase to first live | contradicted by W1, W3 | not distinguished |
| retirement chain | no evidence | no evidence |
| outermost-only quiescence | no evidence | no evidence |

M0 described one protocol. The clients so far ask for continuity of information,
not for that protocol.

## Quant × Alien

| Capability | Quant | Alien |
| --- | --- | --- |
| left and right incidence | used | used |
| left order | used; not ablated | **observable in the search** |
| right order | unresolved | **observable** |
| endpoints | used | used |
| `relate`, `unlink` | used | used |
| live relation identity | used | used |
| one opaque mutable word | sufficient | sufficient in count; domain open |
| reordering an existing relation | used; forced by S2 on reading | unused; changes behaviour here |
| insertion at a cursor | 2.4% of links | 0.8% of links |
| pair uniqueness | enforced above L0 | not held; parallel relations occur |
| backward step, left | proof ladder only, removable | reverse cleanup order, removable as state |
| state of a removed relation | extension only | observable |

Payload meaning differs: observation evidence in Quant, pass identity in Alien.
The common part is opaque mutable relation-local state, not a version.

### The sets

**Common used substrate, C_used.** Capabilities both surviving ports use. This is
not a minimal intersection of requirements:

```text
left and right incidence
left order
endpoint access
relation creation and unlink
live relation identity
one opaque mutable word per relation
```

**Quant-specific substrate pressure**

```text
identity-preserving reorder
```

**Alien-specific substrate pressure**

```text
observable right order
new-birth position for an existing pair
```

**Client policies L0 carried without knowing them**

```text
Quant: pair uniqueness and when to reuse
Alien: dependency and ownership relations on one axis
Alien: when a reappearing dependency counts as a new subscription
```

**Unresolved or unsupported, U**

```text
epochs
store-level retired readability
clause 8 chase
retirement chain
outermost-only quiescence
payload domain and aliasing discipline
generation
directional GC reachability
```

Evidence for order is uneven. Both clients use both axes. Alien gives observable
witnesses for left and right order, the left one in the search only. Quant's left
order was not ablated and its right order is unresolved. Left and right incidence
and live identity were ablated by neither.

## The open question for later clients

Is a dependency relation a persistent fact or a subscription occurrence?

Quant's answer is `same pair ⇒ same relation`. Alien's is `same pair, new birth ⇒
new position`. The biaxial variant suggests these are independent dimensions:
relation identity, and the relation's history of presence in incidence order. One
relation can keep its identity and still take a new place. A small residue, 7 of
4,000 programs, is unexplained.

Creating at a position and moving an existing relation may therefore both be
needed, because they express different histories, not because each client needs
each. `prev` looks like a physical concern. Neither changes the contract yet.

## Limits

- Two signal runtimes can share a blind spot. No non-reactive client has been run.
- The search is one generator, 4,000 programs, without nested effects or scopes.
  Zero differences is not equivalence.
- Corpus ratios describe a behaviour suite, not workloads.
- Frozen behaviour is not necessarily a promise of the Alien project.
- Nothing here concerns real GC, memory, or native performance.

Alien is now closed as a design input, on the same terms as Quant.

**State after two clients:** both use ordered bi-incidence; they disagree on
relation history; in the tested domain, neither forces store-level retirement
semantics.

Next, M3. The executable client is `proposal-signals/signal-polyfill@0.2.2`
(`fba09f8`), which is one implementation and not the proposal. A frozen revision of
`tc39/proposal-signals` is the semantic reference. Differences between them are a
result in their own right.
