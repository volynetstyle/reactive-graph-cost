// M3.5b: the six B-GC probes of polyfill-gc-model.test.ts, with retention changed in
// place on activation and deactivation. `consumer` is left and `producer` is right.
import { describe, expect, it } from "vitest";
import { LIVE_RETENTION, MutableRetentionMachine } from "../reference/experimental/mutable-retention.ts";
import { STRONG, type RelationId } from "../reference/machine.ts";

function setup() {
  const m = new MutableRetentionMachine();
  const [state, computed, watcher] = [m.node(), m.node(), m.node()];

  return {
    m,
    state,
    computed,
    watcher,
    activate: (e: RelationId) => m.setRetention(e, LIVE_RETENTION),
    deactivate: (e: RelationId) => m.setRetention(e, STRONG),
  };
}

describe("variant B with mutable retention", () => {
  it("an unwatched computed is collected despite its reverse incidence", () => {
    const { m, state, computed } = setup();
    m.root(state);
    m.relate(computed, state, STRONG);

    m.collect();

    expect(m.status(computed)).toBe("stale");
    expect(m.first("right", state)).toBeNull();
  });

  it("a rooted watcher keeps what it watches, and its sources", () => {
    const { m, state, computed, watcher, activate } = setup();
    m.root(watcher);
    activate(m.relate(computed, state, STRONG));
    activate(m.relate(watcher, computed, STRONG));

    m.collect();

    expect([m.status(state), m.status(computed), m.status(watcher)]).toEqual(["live", "live", "live"]);
  });

  it("after unwatch, the computed is collected though the state stays", () => {
    const { m, state, computed, watcher, activate, deactivate } = setup();
    m.root(watcher);
    m.root(state);
    const dependency = m.relate(computed, state, STRONG);
    activate(dependency);
    const watch = m.relate(watcher, computed, STRONG);
    activate(watch);

    deactivate(dependency);
    m.unlink(watch);
    m.collect();

    expect(m.status(computed)).toBe("stale");
    expect(m.status(state)).toBe("live");
  });

  it("a watched chain lives while only the state is reachable", () => {
    const { m, state, computed, watcher, activate } = setup();
    m.root(state);
    activate(m.relate(computed, state, STRONG));
    activate(m.relate(watcher, computed, STRONG));

    m.collect();

    expect([m.status(computed), m.status(watcher)]).toEqual(["live", "live"]);
  });

  it("retention follows activation in both directions on one relation", () => {
    const { m, state, computed, activate, deactivate } = setup();
    m.root(state);
    const dependency = m.relate(computed, state, STRONG);

    activate(dependency);
    m.collect();
    expect(m.status(computed)).toBe("live");

    deactivate(dependency);
    m.collect();
    expect(m.status(computed)).toBe("stale");
    expect(m.status(dependency)).toBe("stale");
  });

  it("changes retention in place: same handle, same position, no birth or death", () => {
    const { m, state, computed, watcher, activate, deactivate } = setup();
    const first = m.relate(computed, state, STRONG);
    const second = m.relate(watcher, state, STRONG);
    const before = m.snapshot().stats;

    activate(first);
    deactivate(first);
    activate(first);

    expect(m.status(first)).toBe("live");
    expect(m.retention(first)).toEqual(LIVE_RETENTION);
    expect(m.first("right", state)).toEqual(first);
    expect(m.next("right", first)).toEqual(second);
    expect(m.snapshot().stats).toEqual(before);
  });
});

describe("controls", () => {
  it("omitting the deactivation retains an unwatched computed", () => {
    const { m, state, computed, activate } = setup();
    m.root(state);
    activate(m.relate(computed, state, STRONG));

    m.collect();

    expect(m.status(computed)).toBe("live");
  });

  it("refuses to change the retention of a removed relation", () => {
    const { m, state, computed } = setup();
    const dependency = m.relate(computed, state, STRONG);
    m.unlink(dependency);

    expect(() => m.setRetention(dependency, LIVE_RETENTION)).toThrow(/stale-relation/);
  });
});
