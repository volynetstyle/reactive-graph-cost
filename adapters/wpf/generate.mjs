// M4A.5: writes random programs for the oracle. They carry no expected results.
//   node adapters/wpf/generate.mjs [count] [output] [firstSeed] [handlers]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const count = Number(process.argv[2] ?? 3000);
const output = process.argv[3] ?? path.join(root, ".cache/wpf-oracle/generated-programs.json");
const firstSeed = Number(process.argv[4] ?? 1);
const handlers = Number(process.argv[5] ?? 2);

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
  const sources = 1 + r(2);
  const listeners = 2 + r(3);
  const useStatic = r(5) === 0;
  const source = () => (useStatic && r(3) === 0 ? -1 : r(sources));
  const op = (inRule) => {
    const k = r(100);
    if (k < 30) return { kind: "add", s: source(), l: r(listeners), h: r(handlers) };
    if (k < 45) return { kind: "remove", s: source(), l: r(listeners), h: r(handlers) };
    if (k < 62) return { kind: "raise", s: source() };
    if (k < 70) return { kind: "dropListener", l: r(listeners) };
    if (k < 73 && !inRule) return { kind: "dropSource", s: r(sources) };
    if (k < 83) return { kind: "collect" };
    if (k < 90) return { kind: "probe" };
    if (k < 97) return { kind: "pump" };
    return { kind: "forcePurge" };
  };
  const rules = Array.from({ length: r(4) }, () => ({
    l: r(listeners),
    h: r(handlers),
    when: r(2),
    ops: Array.from({ length: 1 + r(3) }, () => op(true)),
  }));
  const ops = Array.from({ length: 4 + r(14) }, () => op(false));
  ops.push({ kind: "collect" }, { kind: "probe" });
  return { name: `gen-${seed}`, sources, listeners, rules, ops };
}

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(Array.from({ length: count }, (_, i) => generate(firstSeed + i))));
console.log(`${count} programs -> ${output}`);
