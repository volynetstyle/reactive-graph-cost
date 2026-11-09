# M4A.7: what WPF says about L0

Subject: the weak-event core of `dotnet/wpf@49ae5cd`. Source of every number here:
[M4A-WPF-INVENTORY.md](M4A-WPF-INVENTORY.md). Earlier clients:
[M1](M1-QUANT-SYNTHESIS.md), [M2](M2-ALIEN-SYNTHESIS.md), [M3](M3-POLYFILL-SYNTHESIS.md).

This records evidence. It does not change [CONTRACT.md](../CONTRACT.md).

**Result.** The first client outside signals forces less of L0 than any before it. It
shows a push channel that retains nothing, separate lifetimes for a membership record and
its callable, and observable continuity of a traversal across structural death. Every
representation of these that was run is correct with membership wholly in the client, and
with continuity repaired by the client. WPF requires ordered membership, not a place for
it. WPF needs continuity of traversal information across relation death, in the tested
explicit-collection model, and does not need that information to stay in the store.

## 1. Subject and evidence

| Term | Meaning |
| --- | --- |
| oracle | `WindowsBase` built from the pin, on the runtime it pins, driven through the public API |
| directed | 28 programs, of which 18 general and 10 on handler lifetime |
| generated | 3,000 programs; the corpus that found handler lifetime |
| held out | 3,000 programs generated after the fix, with three handlers |
| read | concluded from the source only |

WPF's own 219 tests pin `ListenerList` internals and contain no collection and no
mutation from a callback, so they are not the reference here.

## 2. Executable oracle

Programs carry no expected results. Oracle logs were identical across repeated runs on
every corpus where a repeat was made. Deviations from the repository's bootstrap are
listed in the inventory; none touches weak-event code.

## 3. Client model

| WPF | Decomposed as |
| --- | --- |
| entry (source, target, handler) | a client record, optionally a `WEAK` relation |
| delegate object | a node per `add` |
| `ConditionalWeakTable` entry | `(target, handler, STRONG)`, owned by one list version |
| dead entry until a purge | a client record or count |

The ternary entry needed no ternary relation. The handler lives while its target and its
owning version do; the conjunction is a `STRONG` relation plus `unlink` by the owner.

## 4. Comparison

Totals are per-program peaks of logical records, summed: generated / held out.

| Mechanism | Behaviour | Copies at delivery | Total state | Verdict |
| --- | --- | ---: | ---: | --- |
| S0, always snapshot | correct | 4,490 / 4,452 | 17,968 / 17,717 | sufficient, copies 8.8 and 12.3 times WPF |
| S1, COW arrays and unread subscription relations | correct | 0 | 24,757 / 24,700 | correct; the relations are dead weight |
| S1 without subscriptions | correct | 0 | 17,988 / 17,790 | store adjacency unnecessary |
| S2, store adjacency and epochs | correct | 0 | 17,990 / 17,762 | relocates records; epochs replaceable |
| S2, journal before a collect | correct | 0 | 17,942 / 17,736 | replaces the epoch |
| S2, saved `next` only | **fails one directed program** | 0 | 17,917 / 17,723 | insufficient |

Differences among the last four totals are under 0.5%, on small programs, in records and
not bytes. They do not rank these designs. In particular S1 without subscriptions is
smaller than S2 on one corpus and larger on the other.

COW variants copy exactly WPF's 511 and 363 entries, or 503 and 357 where already-pruned
entries are numbers.

## 5. What is observable

| Property | Evidence |
| --- | --- |
| push without retention of the listener | oracle |
| the manager does not retain a source | oracle |
| delivery in insertion order, stable under removal | oracle |
| membership fixed at delivery start; nested delivery sees the newer version | oracle |
| a target dying mid-delivery is skipped, and later listeners still run | oracle |
| one pair subscribed twice is delivered twice; removal takes the last | oracle |
| a live target with a dead handler is silently not delivered | oracle |
| a dead entry keeps the source subscribed until discovered | oracle |

### Frozen defect candidates

Reproduced because the oracle is this executable. Not requirements, and not inputs to a
primitive.

| Behaviour | Site |
| --- | --- |
| a static add during delivery is lost | `WeakEventManager.cs:279` |
| removing a never-added handler releases the only registered one | `:682-686` |
| with duplicates, the table and the list release different delegates | `:670-690` |

The second and third produce the observable handler deaths in the public-API programs.
Separate lifetimes of record and handler are observable as a result; that a correct
weak-event system should expose them is not established.

## 6. What was replaceable

| Mechanism | Replaced by | Status |
| --- | --- | --- |
| store right incidence and order | client arrays | ablated |
| `WEAK` relations | absence of a relation | ablated |
| epochs, retired readability | a client journal before a collect | ablated, explicit collection only |
| ternary entry | binary relations and client ownership | run |
| version snapshot in the store | client COW | run |

Retired cursor reads occurred in 11 and 4 of 3,000 programs, only when a target died
during its own callback. A later entry's death needs no retirement. Saved `next` is
insufficient, shown by one directed program; all 6,000 random programs missed it.

## 7. Pressure on M0 clauses

| # | Clause | After WPF |
| --- | --- | --- |
| 1 | `identity` | not forced: no client use of relation identity, handles appear only in the store-backed variants |
| 2 | `dual-incidence` | neither refuted nor supported; the left axis is never read |
| 3 | `order` | membership order required, store order not |
| 4 | `permutation` | no moves used |
| 5 | `reachability` | supported, narrowly: `STRONG` plus node status suffices. Non-retention is expressed by having no relation |
| 6 | `gc-transparency` | not forced; dead entries live in the client in every variant |
| 7, 8 | `deferred-reuse`, `continuation` | no client-minimal support; replaceable under explicit collection |
| 9 | `metadata` | used as a client index in store-backed variants, unused otherwise |
| 10 | `multiplicity` | **duplicates are observable**, but they may live in a client array. Store multiplicity is required only of store-backed membership |
| 11 | `failure-atomicity` | not exercised |
| 12 | `lifecycle` | consistent |
| 13, 14 | opacity, no callbacks | held |
| 15 | local complexity | not measured |

## 8. Cross-client update

| Property | Quant | Alien | polyfill | WPF |
| --- | --- | --- | --- | --- |
| right incidence in the store | used, not ablated | used, not ablated | used in A and B, not ablated | **not required** |
| left incidence in the store | used, not ablated | used, not ablated | not read | not read |
| ordered per-node relational state, anywhere | yes | yes | yes | yes |
| live relation identity | used | used | representation-specific | unused |
| mutable retention | not exercised | not exercised | design B only | not needed |
| push without retention | not exercised | not exercised | not when live | **yes** |
| post-death traversal information | extension lane only | observable | not reached | **observable** |
| store retirement | no evidence | replaceable | unused | replaceable |

Combinations of push activity and right-to-left retention with a client: active and
retaining (polyfill live), active and not (WPF), inactive and not (polyfill unwatched).
Inactive and retaining has none.

**The asymmetry matters.** Only WPF has been run with membership wholly outside the
store. Quant and Alien were never ablated that way, so "only ordered relational state
recurs" is an upper bound from one such ablation, not a finding about all four. Their
walks over both axes are much heavier than WPF's single list, and that is untested.

## 9. Limits

- **Collection is explicit.** A journal taken before `collect` needs a moment before
  collection. A collector that may run at any allocation or concurrently removes that
  moment. Epochs are replaceable under the tested explicit-collection model only.
- State is logical records, not bytes, and a small random corpus, not workloads.
- Records and handlers cost the same in all variants and are outside the totals.
- One generator, small programs, one thread, one CLR build, explicit dispatcher pumps.
- Random search does not discriminate traversal continuity. Directed programs carry it.
- WPF is a single flat list per source. It does not stress traversal of a graph.

## 10. Decisions

`CONTRACT.md` stays frozen. WPF is closed as a design input, on the same terms as the
earlier clients. The ephemeron is treated only as far as the port needed it.

Next is M4B, a non-reactive incremental client, whose useful test now includes the one
this client introduced: running it with its relational state outside the store.
