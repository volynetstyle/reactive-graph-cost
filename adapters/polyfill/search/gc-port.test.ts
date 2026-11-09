// M3.5b: collect() on the running port, with activation driven by the polyfill's own
// cascade through the public API. Only states are rooted, as README:391 frames it.
// Results are recorded rather than asserted, because the fixed-retention variant is a
// control that is expected to lose the watched chains.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "vitest";

type Row = { name: string; observed: Record<string, unknown> };

it("collects on the running port", async () => {
  const base = process.env["POLYFILL_PORT_ROOT"] as string;
  const { Signal } = await import(/* @vite-ignore */ resolve(base, "src/wrapper.ts"));
  const { gcProbe } = await import(/* @vite-ignore */ resolve(base, "src/backend.ts"));
  const nodeOf = (x: object): any => (x as any)[Object.getOwnPropertySymbols(x).find((s) => s.description === "node") as symbol];
  const root = (x: object): void => gcProbe.rootOf(nodeOf(x));
  const status = (x: object): string => gcProbe.statusOf(nodeOf(x));
  const watcher = (): any => new Signal.subtle.Watcher(() => {});
  const state = (): any => new Signal.State(0);
  const reading = (source: any): any => new Signal.Computed(() => source.get());
  const rows: Row[] = [];
  const scenario = (name: string, run: () => Record<string, unknown>): void => {
    rows.push({ name, observed: run() });
  };

  scenario("read only, never watched", () => {
    const s = state();
    const c = reading(s);
    root(s);
    c.get();
    gcProbe.collect();
    return { state: status(s), computed: status(c) };
  });

  scenario("read, then watch", () => {
    const s = state();
    const c = reading(s);
    const w = watcher();
    root(s);
    c.get();
    w.watch(c);
    gcProbe.collect();
    return { computed: status(c), watcher: status(w) };
  });

  scenario("watch, then read", () => {
    const s = state();
    const c = reading(s);
    const w = watcher();
    root(s);
    w.watch(c);
    c.get();
    gcProbe.collect();
    return { computed: status(c), watcher: status(w) };
  });

  scenario("chain of two computeds", () => {
    const s = state();
    const inner = reading(s);
    const outer = reading(inner);
    const w = watcher();
    root(s);
    outer.get();
    w.watch(outer);
    gcProbe.collect();
    return { inner: status(inner), outer: status(outer), watcher: status(w) };
  });

  scenario("unwatch makes it collectable", () => {
    const s = state();
    const c = reading(s);
    const w = watcher();
    root(s);
    c.get();
    w.watch(c);
    w.unwatch(c);
    gcProbe.collect();
    return { state: status(s), computed: status(c), watcher: status(w) };
  });

  scenario("watch, unwatch, watch keeps one relation", () => {
    const s = state();
    const c = reading(s);
    const w = watcher();
    root(s);
    c.get();
    const relation = nodeOf(c).producerIndexOfThis[0];
    w.watch(c);
    w.unwatch(c);
    w.watch(c);
    const same = nodeOf(c).producerIndexOfThis[0];
    gcProbe.collect();
    return {
      computed: status(c),
      watcher: status(w),
      sameHandle: relation.slot === same.slot && relation.generation === same.generation,
      relationAfterCollect: gcProbe.statusOf({ relation }) ,
    };
  });

  writeFileSync(process.env["SEARCH_OUTPUT"] as string, JSON.stringify(rows));
});
