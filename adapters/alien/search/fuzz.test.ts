// Differential search over Alien's public API: frozen source against a port
// variant, on random programs whose computeds and effects may read, write and
// dispose. The first divergent program is shrunk and written to SEARCH_OUTPUT.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

type Step =
  | { when?: [number, number]; op: "readS"; i: number }
  | { when?: [number, number]; op: "readC"; i: number }
  | { when?: [number, number]; op: "write"; i: number; v: number }
  | { when?: [number, number]; op: "dispose"; i: number };
type Op = { op: "set"; i: number; v: number } | { op: "read"; i: number } | { op: "stop"; i: number };
interface Program {
  signals: number;
  computeds: Step[][];
  effects: Step[][];
  ops: Op[];
}

const PROGRAMS = 4000;
const BUDGET = 400;
const here = fileURLToPath(new URL(".", import.meta.url));

function rng(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

function generate(seed: number): Program {
  const r = rng(seed);
  const signals = 2 + r(2);
  const nc = 2 + r(3);
  const ne = 2 + r(2);
  const step = (computeds: number): Step => {
    const when: [number, number] | undefined = r(2) === 0 ? [r(signals), r(3)] : undefined;
    const base = when === undefined ? {} : { when };
    const k = r(10);
    if (k < 4 || computeds === 0) return { ...base, op: "readS", i: r(signals) };
    if (k < 8) return { ...base, op: "readC", i: r(computeds) };
    if (k < 9) return { ...base, op: "dispose", i: r(ne) };
    return { ...base, op: "write", i: r(signals), v: r(3) };
  };
  const body = (computeds: number): Step[] => Array.from({ length: 1 + r(4) }, () => step(computeds));
  return {
    signals,
    computeds: Array.from({ length: nc }, (_, i) => body(i)),
    effects: Array.from({ length: ne }, () => body(nc)),
    ops: Array.from({ length: 2 + r(8) }, (): Op => {
      const k = r(10);
      if (k < 7) return { op: "set", i: r(signals), v: r(3) };
      if (k < 9) return { op: "read", i: r(nc) };
      return { op: "stop", i: r(ne) };
    }),
  };
}

function execute(rt: any, program: Program): string[] {
  const log: string[] = [];
  let runs = 0;
  const signals = Array.from({ length: program.signals }, () => rt.signal(0));
  const computeds: (() => number)[] = [];
  const stops: ((() => void) | undefined)[] = [];
  const runBody = (steps: Step[]): number => {
    if (++runs > BUDGET) throw new RangeError("budget");
    let sum = 0;
    for (const s of steps) {
      if (s.when !== undefined && signals[s.when[0]]() !== s.when[1]) continue;
      if (s.op === "readS") sum += signals[s.i]();
      else if (s.op === "readC") sum += computeds[s.i]!();
      else if (s.op === "write") signals[s.i](s.v);
      else stops[s.i]?.();
    }
    return sum;
  };
  const attempt = (label: string, action: () => unknown): void => {
    try {
      const v = action();
      log.push(v === undefined ? label : `${label}=${String(v)}`);
    } catch (e) {
      log.push(`${label}!${(e as Error).name}`);
    }
  };
  program.computeds.forEach((steps, i) => {
    computeds.push(rt.computed(() => {
      log.push(`C${i}`);
      return runBody(steps);
    }));
  });
  program.effects.forEach((steps, i) => {
    attempt(`create${i}`, () => {
      stops[i] = rt.effect(() => {
        log.push(`E${i}`);
        runBody(steps);
      });
    });
  });
  for (const op of program.ops) {
    if (op.op === "set") attempt(`set${op.i}:${op.v}`, () => void signals[op.i](op.v));
    else if (op.op === "read") attempt(`read${op.i}`, () => computeds[op.i]!());
    else attempt(`stop${op.i}`, () => stops[op.i]?.());
  }
  return log;
}

function diverges(a: any, b: any, program: Program): boolean {
  return execute(a, program).join() !== execute(b, program).join();
}

function shrink(a: any, b: any, start: Program): Program {
  let p = start;
  for (let changed = true; changed; ) {
    changed = false;
    const attempts: Program[] = [];
    p.ops.forEach((_, i) => attempts.push({ ...p, ops: p.ops.filter((__, j) => j !== i) }));
    (["computeds", "effects"] as const).forEach((key) => {
      p[key].forEach((steps, n) => {
        steps.forEach((_, i) => {
          const next = p[key].map((s, m) => (m === n ? s.filter((__, j) => j !== i) : s));
          attempts.push({ ...p, [key]: next });
        });
      });
    });
    for (const q of attempts) {
      if (diverges(a, b, q)) {
        p = q;
        changed = true;
        break;
      }
    }
  }
  return p;
}

it("searches for a public-API difference", async () => {
  const original = await import(/* @vite-ignore */ resolve(here, "../../../.cache/alien-8734d38/src/index.ts"));
  const portRoot = process.env["ALIEN_PORT_ROOT"] as string;
  const port = await import(/* @vite-ignore */ resolve(portRoot, "src/index.ts"));
  const { accounting } = await import(/* @vite-ignore */ resolve(portRoot, "src/accounting.ts"));
  const referenceRoot = process.env["SEARCH_REFERENCE_ROOT"];
  const reference = referenceRoot === undefined ? original : await import(/* @vite-ignore */ resolve(referenceRoot, "src/index.ts"));
  let divergent = 0;
  let witness: Program | undefined;
  for (let seed = 1; seed <= PROGRAMS; seed++) {
    const program = generate(seed);
    if (diverges(reference, port, program)) {
      divergent++;
      witness ??= program;
    }
  }
  const retired = {
    retiredNext: accounting.retiredNextDep + accounting.retiredNextSub,
    retiredNextDivergentFromFrozen: accounting.retiredNextDivergentFromFrozen,
  };
  const shrunk = witness === undefined ? undefined : shrink(reference, port, witness);
  const logs = shrunk === undefined ? undefined : { frozen: execute(reference, shrunk), port: execute(port, shrunk) };
  writeFileSync(process.env["SEARCH_OUTPUT"] as string, JSON.stringify({ programs: PROGRAMS, divergent, witness: shrunk, logs, ...retired }));
});
