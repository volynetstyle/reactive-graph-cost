// M5D control: does dereferencing a WeakRef, at some frequency, delay the collection of its
// referent? One referent per trial, allocation pressure only, no forced collection.
//   node adapters/m5/gc-observer.mjs [output.json] [trials]
import { writeFileSync } from "node:fs";
import { PerformanceObserver, constants } from "node:perf_hooks";

const TURNS = 4000;
const trials = Number(process.argv[3] ?? 10);
const turn = () => new Promise((r) => setImmediate(r));

let majors = 0;
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (e.detail.kind === constants.NODE_PERFORMANCE_GC_MAJOR) majors++;
}).observe({ entryTypes: ["gc"] });

async function trial(pollEvery) {
  const r = (() => new WeakRef({ payload: new Array(32).fill("referent") }))();
  await turn();
  const startMajors = majors;
  const hoard = [];
  for (let i = 0; i < TURNS; i++) {
    await turn();
    hoard.push(Array.from({ length: 20000 }, (_, j) => ({ j })));
    if (hoard.length > 60) hoard.shift();
    if (pollEvery !== 0 && i % pollEvery === pollEvery - 1 && r.deref() === undefined) {
      return { cleared: true, turn: i + 1, majors: majors - startMajors };
    }
  }
  await turn();
  await turn();
  return { cleared: r.deref() === undefined, turn: TURNS, majors: majors - startMajors };
}

const results = {};
for (const pollEvery of [1, 2, 10, 100, 500, 0]) {
  const runs = [];
  for (let t = 0; t < trials; t++) runs.push(await trial(pollEvery));
  const cleared = runs.filter((x) => x.cleared);
  const label = pollEvery === 0 ? "end only" : `every ${pollEvery}`;
  const sorted = (xs) => xs.slice().sort((a, b) => a - b);
  const median = (xs) => (xs.length === 0 ? null : sorted(xs)[xs.length >> 1]);
  results[label] = {
    pollEvery,
    trials,
    cleared: cleared.length,
    medianTurnWhenCleared: median(cleared.map((x) => x.turn)),
    medianMajorsSeen: median(runs.map((x) => x.majors)),
    maxMajorsWithoutClearing: Math.max(0, ...runs.filter((x) => !x.cleared).map((x) => x.majors)),
  };
  console.log(label.padEnd(10), JSON.stringify(results[label]));
}
if (process.argv[2] !== undefined) writeFileSync(process.argv[2], JSON.stringify({ node: process.version, v8: process.versions.v8, turns: TURNS, results }, null, 1));
process.exit(0);
