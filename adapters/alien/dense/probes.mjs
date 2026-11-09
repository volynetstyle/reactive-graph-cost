// M6 probes: retention under the real collector, and the unit cost of a slot -> node resolution.
//   node --expose-gc adapters/alien/dense/probes.mjs <frozen|dense> [out.json]
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [variant, out] = process.argv.slice(2);
const R = await import(pathToFileURL(path.resolve(import.meta.dirname, `../../../.cache/m6/build/${variant}.mjs`)).href);
const { signal, computed, effect } = R;
const turn = () => new Promise((r) => setImmediate(r));
const ROUNDS = 20;

async function collected(make) {
  let cleared = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const ref = make();
    await turn();
    await turn();
    globalThis.gc();
    await turn();
    globalThis.gc();
    if (ref.deref() === undefined) cleared++;
  }
  return cleared;
}

const dropped = await collected(() => {
  const payload = { big: new Array(16).fill(1) };
  const s = signal(1);
  const c = computed(() => s() + payload.big.length);
  c();
  return new WeakRef(payload);
});
const disposed = await collected(() => {
  const payload = { big: new Array(16).fill(1) };
  const s = signal(1);
  const stop = effect(() => { s(); payload.big.length; });
  s(2);
  stop();
  return new WeakRef(payload);
});

function unitCost() {
  const COUNT = 200000, ROUNDS2 = 40, nodes = [undefined], objects = [];
  const L = new Int32Array(COUNT * 7 + 7);
  const order = Array.from({ length: COUNT }, (_, i) => i);
  let s = 12345;
  for (let i = COUNT - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  for (let i = 0; i < COUNT; i++) nodes.push({ flags: i & 3 });
  for (let i = 0; i < COUNT; i++) { L[(i + 1) * 7 + 2] = order[i] + 1; objects.push({ version: 0, dep: nodes[order[i] + 1], sub: nodes[order[i] + 1], prevSub: undefined, nextSub: undefined, prevDep: undefined, nextDep: undefined }); }
  const time = (fn) => { const t = []; for (let r = 0; r < 7; r++) { const t0 = process.hrtime.bigint(); fn(); t.push(Number(process.hrtime.bigint() - t0)); } t.sort((a, b) => a - b); return t[3] / (ROUNDS2 * COUNT); };
  const slots = time(() => { let x = 0; for (let r = 0; r < ROUNDS2; r++) for (let l = 7; l < COUNT * 7 + 7; l += 7) x += nodes[L[l + 2]].flags; return x; });
  const fields = time(() => { let x = 0; for (let r = 0; r < ROUNDS2; r++) for (let i = 0; i < COUNT; i++) x += objects[i].sub.flags; return x; });
  return { slotNs: slots, fieldNs: fields };
}

const result = { variant, rounds: ROUNDS, droppedCollected: dropped, disposedCollected: disposed, ...unitCost() };
if (out !== undefined) writeFileSync(out, JSON.stringify(result));
console.log(JSON.stringify(result));
process.exit(0);
