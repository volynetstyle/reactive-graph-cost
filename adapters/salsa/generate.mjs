// M4B: random programs for the oracle, with no expected results.
//   node adapters/salsa/generate.mjs count output [firstSeed]
import { writeFileSync } from "node:fs";

const count = Number(process.argv[2] ?? 3000);
const output = process.argv[3];
const firstSeed = Number(process.argv[4] ?? 1);

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

function generate(seed) {
  const r = rng(seed);
  const cells = 2 + r(3);
  const nq = 2 + r(5);
  const queries = Array.from({ length: nq }, (_, q) => {
    const steps = Array.from({ length: r(5) }, () => {
      const step = {};
      if (r(2) === 0) step.when = { cell: r(cells), eq: r(3) };
      if (q === 0 || r(2) === 0) step.cell = r(cells);
      else step.query = r(q);
      return step;
    });
    return r(3) === 0 ? { steps, modulo: 2 } : { steps };
  });
  const ops = Array.from({ length: 4 + r(16) }, () => (r(2) === 0 ? { kind: "set", i: r(cells), v: r(3) } : { kind: "get", i: r(nq) }));
  return { name: `gen-${seed}`, cells, queries, ops };
}

writeFileSync(output, JSON.stringify(Array.from({ length: count }, (_, i) => generate(firstSeed + i))));
console.log(`${count} programs`);
