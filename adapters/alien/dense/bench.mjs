// M6 end-to-end measurement of one variant on one workload, in one process.
//   node --expose-gc adapters/alien/dense/bench.mjs <frozen|dense|dense-counted> <workload> [out.json]
import { writeFileSync } from "node:fs";
import path from "node:path";
import { PerformanceObserver } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";

const [variant, workload, out] = process.argv.slice(2);
globalThis.__resolves = 0;
const R = await import(pathToFileURL(path.resolve(import.meta.dirname, `../../../.cache/m6/build/${variant}.mjs`)).href);
const { signal, computed, effect, effectScope, startBatch, endBatch } = R;

function rng(seed) {
  let s = seed >>> 0;
  return (n) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

// Iteration counts were calibrated on the frozen build only.
const WORKLOADS = {
  system() {
    const SUBS = 4000, DEGREE = 8, DEPS = 2000, ROUNDS = 240;
    const sys = R.createReactiveSystem({ update: () => false, notify() {}, unwatched() {} });
    const none = R.NIL;
    const node = (flags) => (none === undefined
      ? { deps: undefined, depsTail: undefined, subs: undefined, subsTail: undefined, flags }
      : { deps: none, depsTail: none, subs: none, subsTail: none, flags, slot: 0, refs: 0 });
    const deps = Array.from({ length: DEPS }, () => node(1));
    const subs = Array.from({ length: SUBS }, () => node(1));
    const r = rng(11);
    const wiring = subs.map(() => Array.from({ length: DEGREE }, () => r(DEPS)));
    let version = 0;
    const connect = () => {
      version++;
      subs.forEach((s, i) => { s.depsTail = none; for (const d of wiring[i]) sys.link(deps[d], s, version); });
    };
    connect();
    return {
      replay() {
        for (let round = 0; round < ROUNDS; round++) {
          for (const d of deps) if (d.subs !== none) sys.propagate(d.subs, false);
          for (const s of subs) s.flags = 1;
          for (const s of subs) { let l = s.deps; while (l !== none) l = sys.unlink(l, s); }
          R.reclaim?.();
          connect();
        }
      },
    };
  },
  propagate() {
    const CHAINS = 400, DEPTH = 8, WRITES = 5400;
    const source = signal(0);
    let sink = 0;
    for (let c = 0; c < CHAINS; c++) {
      let last = source;
      for (let d = 0; d < DEPTH; d++) { const prev = last; last = computed(() => prev() + 1); }
      const end = last;
      effect(() => { sink += end(); });
    }
    let v = 0;
    return { replay() { for (let i = 0; i < WRITES; i++) source(++v); }, sink: () => sink };
  },
  dynamic() {
    const CELLS = 3000, WIDTH = 6, FLIPS = 800;
    const a = Array.from({ length: WIDTH }, (_, i) => signal(i));
    const b = Array.from({ length: WIDTH }, (_, i) => signal(i * 2));
    const select = signal(true);
    let sink = 0;
    for (let i = 0; i < CELLS; i++) {
      const c = computed(() => { const set = select() ? a : b; let s = 0; for (let k = 0; k < WIDTH; k++) s += set[k](); return s; });
      effect(() => { sink += c(); });
    }
    let on = true;
    return { replay() { for (let i = 0; i < FLIPS; i++) select(on = !on); }, sink: () => sink };
  },
  create() {
    const NODES = 1500, TIMES = 5000;
    const build = () => {
      let sink = 0;
      return effectScope(() => {
        for (let i = 0; i < NODES; i++) {
          const s = signal(i);
          const c = computed(() => s() + 1);
          effect(() => { sink += c(); });
        }
      });
    };
    const held = build();
    return { before: held, replay() { for (let i = 0; i < TIMES; i++) build()(); } };
  },
  app() {
    const SIZE = 64, BATCHES = 1100, PER = 20;
    const inputs = Array.from({ length: SIZE }, (_, i) => signal(i + 1));
    const cells = [];
    let sink = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const left = x > 0 ? cells[y * SIZE + x - 1] : inputs[y];
        const up = y > 0 ? cells[(y - 1) * SIZE + x] : inputs[x];
        const far = y > 1 ? cells[(y - 2) * SIZE + x] : inputs[(x + y) % SIZE];
        const c = computed(() => {
          const l = left(), u = up();
          let v = l * 0.5 + u * 0.25;
          if ((Math.floor(l) & 7) === 0) v += far() * 0.125;
          return Number((v % 1000).toFixed(2));
        });
        cells.push(c);
        if ((x + y) % 20 === 0) effect(() => { sink += String(c()).length; });
      }
    }
    const r = rng(7);
    return {
      replay() {
        for (let b = 0; b < BATCHES; b++) {
          startBatch();
          for (let i = 0; i < PER; i++) inputs[r(SIZE)](r(1000) + 1);
          endBatch();
        }
      },
      sink: () => sink,
    };
  },
};

const live = () => { globalThis.gc(); globalThis.gc(); const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
let gcMs = 0;
new PerformanceObserver((list) => { for (const e of list.getEntries()) gcMs += e.duration; }).observe({ entryTypes: ["gc"] });

const base = live();
const state = WORKLOADS[workload]();
const liveBytes = live() - base;
state.before?.();
state.replay();
const REPLAYS = 15;
const times = [], allocated = [], resolves = [];
await new Promise((r) => setImmediate(r));
gcMs = 0;
for (let i = 0; i < REPLAYS; i++) {
  const a0 = v8.getHeapStatistics().total_allocated_bytes, r0 = globalThis.__resolves;
  const t0 = process.hrtime.bigint();
  state.replay();
  times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  allocated.push(v8.getHeapStatistics().total_allocated_bytes - a0);
  resolves.push(globalThis.__resolves - r0);
}
await new Promise((r) => setImmediate(r));
await new Promise((r) => setTimeout(r, 20));
const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const result = { variant, workload, ms: median(times), allocatedBytes: median(allocated), liveBytes, gcMsPerReplay: gcMs / REPLAYS, maxRssKb: process.resourceUsage().maxRSS, resolves: median(resolves), sink: state.sink?.() };
if (out !== undefined) writeFileSync(out, JSON.stringify(result));
console.log(JSON.stringify(result));
process.exit(0);
