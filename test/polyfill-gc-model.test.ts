// B-GC probe, at model level: the shape variant B gives the polyfill's graph, in the
// reference machine with its explicit collector. This is a model of the topology,
// not the running port. `consumer` is left and `producer` is right.
import { describe, expect, it } from "vitest";
import { RelationMachine, STRONG, type Retention } from "../reference/machine.ts";

const LIVE_HOLDS_CONSUMER: Retention = { leftToRight: true, rightToLeft: true };

describe("variant B retention", () => {
  it("an unwatched computed is collected despite its reverse incidence", () => {
    const m = new RelationMachine();
    const [state, computed] = [m.node(), m.node()];
    m.root(state);
    m.relate(computed, state, STRONG);

    m.collect();

    expect(m.status(computed)).toBe("stale");
    expect(m.first("right", state)).toBeNull();
  });

  it("a rooted watcher keeps what it watches, and its sources", () => {
    const m = new RelationMachine();
    const [state, computed, watcher] = [m.node(), m.node(), m.node()];
    m.root(watcher);
    m.relate(computed, state, STRONG);
    m.relate(watcher, computed, STRONG);

    m.collect();

    expect([m.status(state), m.status(computed), m.status(watcher)]).toEqual(["live", "live", "live"]);
  });

  it("after unwatch, the computed is collected though the state stays", () => {
    const m = new RelationMachine();
    const [state, computed, watcher] = [m.node(), m.node(), m.node()];
    m.root(watcher);
    m.root(state);
    m.relate(computed, state, STRONG);
    m.unlink(m.relate(watcher, computed, STRONG));

    m.collect();

    expect(m.status(computed)).toBe("stale");
    expect(m.status(state)).toBe("live");
  });

  it("with fixed STRONG retention, a watched chain dies if only the state is reachable", () => {
    // README:391 says watched signals are held alive while their states are reachable.
    const m = new RelationMachine();
    const [state, computed, watcher] = [m.node(), m.node(), m.node()];
    m.root(state);
    m.relate(computed, state, STRONG);
    m.relate(watcher, computed, STRONG);

    m.collect();

    expect(m.status(computed)).toBe("stale");
    expect(m.status(watcher)).toBe("stale");
  });

  it("the proposal's rule needs right-to-left retention while active", () => {
    const m = new RelationMachine();
    const [state, computed, watcher] = [m.node(), m.node(), m.node()];
    m.root(state);
    m.relate(computed, state, LIVE_HOLDS_CONSUMER);
    m.relate(watcher, computed, LIVE_HOLDS_CONSUMER);

    m.collect();

    expect([m.status(computed), m.status(watcher)]).toEqual(["live", "live"]);
  });

  it("L0 retention is fixed at relate, so activation cannot change it in place", () => {
    const m = new RelationMachine();
    const [state, computed] = [m.node(), m.node()];
    const e = m.relate(computed, state, STRONG);

    expect(m.retention(e)).toEqual(STRONG);
    expect("setRetention" in m).toBe(false);
  });
});
