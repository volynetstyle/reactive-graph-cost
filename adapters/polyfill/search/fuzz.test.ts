// Differential search over the polyfill's public API: a reference against a port
// variant, in two lanes.
//   P: programs obeying the proposal's guardrails.
//   E: programs that only the executable accepts, such as unwatch inside notify.
// The log records runs, values, errors, notify order, watched and unwatched order,
// getPending, and introspection of every signal after every operation.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

type Step =
  | { when?: [number, number]; op: "readS" | "untrackS"; i: number }
  | { when?: [number, number]; op: "readC"; i: number }
  | { when?: [number, number]; op: "write"; i: number; v: number }
  | { when?: [number, number]; op: "throw" };
type Notify = "log" | "throw" | "unwatch" | "read" | "write";
type Op =
  | { op: "set"; i: number; v: number }
  | { op: "get"; i: number }
  | { op: "watch" | "unwatch"; w: number; t: number }
  | { op: "rearm"; w: number };
interface Program {
  states: number;
  computeds: Step[][];
  hooks: number[];
  hookAction: "none" | "read" | "write";
  watchers: Notify[];
  ops: Op[];
}
type Lane = "P" | "E";

const PROGRAMS = 3000;
const BUDGET = 300;
// A watched hook that reads recurses without bound in the polyfill, because the entry is
// added after the hook runs. An engine stack overflow is not a comparable observation:
// its depth depends on frame sizes and the JIT, and it leaks activeConsumer into later
// programs. So hook actions are bounded, and any program that still overflows or starts
// with a leaked consumer is counted as inconclusive.
const HOOK_ACTIONS = 4;
const OVERFLOW = "!!overflow";
const LEAK = "!!leak";
const here = fileURLToPath(new URL(".", import.meta.url));

// A difference is attributed to the most damaging event in either run. A hook that throws
// mid-activation leaves the frozen graph inconsistent, so what follows is not specified
// by anything. A notify that throws stops the push partway, which the proposal rules out.
const HOOK_THREW = "!!hook-threw";
const NOTIFY_THREW = "!!notify-threw";
const VERDICTS = ["order", "behaviour", "notify-throw", "hook-throw"] as const;
type Verdict = "same" | "inconclusive" | (typeof VERDICTS)[number];

function spoiled(log: string[]): boolean {
  return log.includes(OVERFLOW) || log.includes(LEAK);
}

/** Makes the order of each sink list irrelevant; every other observation is kept. */
function withoutSinkOrder(log: string[]): string[] {
  return log.map((line) =>
    line
      .split(" ")
      .map((token) => {
        const m = /^([^>]+)>([^|]*)\|(.*)$/.exec(token);
        return m === null ? token : `${m[1]}>${m[2]!.split(",").sort().join(",")}|${m[3]}`;
      })
      .join(" "),
  );
}

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

function generate(seed: number, lane: Lane): Program {
  const r = rng(seed * 2 + (lane === "P" ? 0 : 1));
  const states = 2 + r(2);
  const nc = 2 + r(4);
  const step = (computeds: number): Step => {
    const when: [number, number] | undefined = r(2) === 0 ? [r(states), r(3)] : undefined;
    const base = when === undefined ? {} : { when };
    const k = r(12);
    if (k < 4 || computeds === 0) return { ...base, op: "readS", i: r(states) };
    if (k < 8) return { ...base, op: "readC", i: r(computeds) };
    if (k < 9) return { ...base, op: "untrackS", i: r(states) };
    if (k < 10) return { ...base, op: "throw" };
    return { ...base, op: "write", i: r(states), v: r(3) };
  };
  const computeds = Array.from({ length: nc }, (_, i) => Array.from({ length: 1 + r(4) }, () => step(i)));
  const hooks = Array.from({ length: states + nc }, (_, i) => i).filter(() => r(3) === 0);
  const notifications: Notify[] = lane === "P" ? ["log", "log", "log", "throw"] : ["log", "throw", "unwatch", "read", "write"];
  const watchers = Array.from({ length: 1 + r(3) }, () => notifications[r(notifications.length)] as Notify);
  const hookAction: Program["hookAction"] = lane === "P" ? "none" : (["none", "read", "write"] as const)[r(3)]!;
  const targets = states + nc;
  const ops = Array.from({ length: 3 + r(12) }, (): Op => {
    const k = r(20);
    if (k < 7) return { op: "set", i: r(states), v: r(3) };
    if (k < 10) return { op: "get", i: r(nc) };
    if (k < 15) return { op: "watch", w: r(watchers.length), t: r(targets) };
    if (k < 18) return { op: "unwatch", w: r(watchers.length), t: r(targets) };
    return { op: "rearm", w: r(watchers.length) };
  });
  return { states, computeds, hooks, hookAction, watchers, ops };
}

function execute(api: any, program: Program, lane: Lane): string[] {
  const { Signal } = api;
  const log: string[] = [];
  let runs = 0;
  let hookActions = 0;
  // Watcher.watch has no try/finally, so a throwing watched hook leaves activeConsumer
  // set for the rest of the module's life. Inside one program that is observable and
  // compared. Between programs it is reset, or every later program would inherit it.
  api.resetActiveConsumer();
  if (Signal.subtle.currentComputed() != null) log.push(LEAK);
  const labels = new Map<object, string>();
  const states: any[] = [];
  const computeds: any[] = [];
  const noteOverflow = (e: unknown): void => {
    if (e instanceof RangeError && /call stack/i.test(e.message)) log.push(OVERFLOW);
  };
  const hookOptions = (index: number, label: string): object => {
    if (!program.hooks.includes(index)) return {};
    const act = (): void => {
      if (program.hookAction === "none" || hookActions >= HOOK_ACTIONS) return;
      hookActions++;
      try {
        if (program.hookAction === "read") states[0].get();
        else if (program.hookAction === "write") states[0].set(9);
      } catch (e) {
        log.push(HOOK_THREW);
        throw e;
      }
    };
    return {
      [Signal.subtle.watched]() {
        log.push(`watched:${label}`);
        act();
      },
      [Signal.subtle.unwatched]() {
        log.push(`unwatched:${label}`);
        act();
      },
    };
  };
  for (let i = 0; i < program.states; i++) {
    const s = new Signal.State(0, hookOptions(i, `s${i}`));
    states.push(s);
    labels.set(s, `s${i}`);
  }
  const runBody = (steps: Step[]): number => {
    if (++runs > BUDGET) throw new RangeError("budget");
    let sum = 0;
    for (const s of steps) {
      if (s.when !== undefined && states[s.when[0]].get() !== s.when[1]) continue;
      if (s.op === "readS") sum += states[s.i].get();
      else if (s.op === "readC") sum += computeds[s.i].get();
      else if (s.op === "untrackS") sum += Signal.subtle.untrack(() => states[s.i].get());
      else if (s.op === "write") states[s.i].set(s.v);
      else throw new EvalError("step");
    }
    return sum;
  };
  program.computeds.forEach((steps, i) => {
    const c = new Signal.Computed(() => {
      log.push(`C${i}`);
      return runBody(steps);
    }, hookOptions(program.states + i, `c${i}`));
    computeds.push(c);
    labels.set(c, `c${i}`);
  });
  const targets = [...states, ...computeds];
  const watched = program.watchers.map(() => new Set<number>());
  const watchers = program.watchers.map((action, i) => {
    const w = new Signal.subtle.Watcher(function (this: any) {
      log.push(`notify:w${i}`);
      try {
        if (action === "throw") throw new SyntaxError("notify");
        if (action === "read") states[0].get();
        if (action === "write") states[0].set(7);
        if (action === "unwatch") w.unwatch(targets[0]);
      } catch (e) {
        log.push(NOTIFY_THREW);
        throw e;
      }
    });
    labels.set(w, `w${i}`);
    return w;
  });
  const name = (x: object): string => labels.get(x) ?? "?";
  const observe = (): void => {
    const parts: string[] = [];
    for (const t of targets) parts.push(`${name(t)}>${Signal.subtle.introspectSinks(t).map(name).join(",")}|${Signal.subtle.hasSinks(t)}`);
    for (const c of computeds) parts.push(`${name(c)}<${Signal.subtle.introspectSources(c).map(name).join(",")}`);
    for (const w of watchers) parts.push(`${name(w)}<${Signal.subtle.introspectSources(w).map(name).join(",")}!${w.getPending().map(name).join(",")}`);
    log.push(parts.join(" "));
  };
  const attempt = (label: string, action: () => unknown): void => {
    try {
      const v = action();
      log.push(v === undefined ? label : `${label}=${String(v)}`);
    } catch (e) {
      noteOverflow(e);
      log.push(`${label}!${(e as Error).name}`);
    }
    try {
      observe();
    } catch (e) {
      noteOverflow(e);
      log.push(`observe!${(e as Error).name}`);
    }
  };
  for (const op of program.ops) {
    if (op.op === "set") attempt(`set${op.i}:${op.v}`, () => states[op.i].set(op.v));
    else if (op.op === "get") attempt(`get${op.i}`, () => computeds[op.i].get());
    else if (op.op === "rearm") attempt(`rearm${op.w}`, () => watchers[op.w].watch());
    else if (op.op === "watch") {
      if (lane === "P" && watched[op.w]!.has(op.t)) continue;
      watched[op.w]!.add(op.t);
      attempt(`watch${op.w}:${op.t}`, () => watchers[op.w].watch(targets[op.t]));
    } else {
      if (lane === "P" && !watched[op.w]!.has(op.t)) continue;
      watched[op.w]!.delete(op.t);
      attempt(`unwatch${op.w}:${op.t}`, () => watchers[op.w].unwatch(targets[op.t]));
    }
  }
  return log;
}

function compare(a: any, b: any, program: Program, lane: Lane): Verdict {
  const x = execute(a, program, lane);
  const y = execute(b, program, lane);
  if (spoiled(x) || spoiled(y)) return "inconclusive";
  if (x.join("\n") === y.join("\n")) return "same";
  if (withoutSinkOrder(x).join("\n") === withoutSinkOrder(y).join("\n")) return "order";
  const either = (marker: string): boolean => x.includes(marker) || y.includes(marker);
  if (either(HOOK_THREW)) return "hook-throw";
  return either(NOTIFY_THREW) ? "notify-throw" : "behaviour";
}

const plainWatchers: Notify[] = ["log", "log", "log"];
const readsS0: Step[][] = [[{ op: "readS", i: 0 }]];

/** Programs aimed at right-axis order, with no throw anywhere. Target 0 is s0, 2 is c0. */
const DIRECTED: { name: string; program: Program }[] = [
  {
    // s0 sinks are w0, w1, c0. Removing w0 gives c0, w1 by swap and w1, c0 by stable erase.
    name: "swap changes notify order",
    program: {
      states: 2,
      computeds: readsS0,
      hooks: [],
      hookAction: "none",
      watchers: plainWatchers,
      ops: [
        { op: "get", i: 0 },
        { op: "watch", w: 0, t: 0 },
        { op: "watch", w: 1, t: 0 },
        { op: "watch", w: 2, t: 2 },
        { op: "unwatch", w: 0, t: 0 },
        { op: "set", i: 0, v: 1 },
      ],
    },
  },
  {
    // c0 reads s0 before w1 watches it, and activates after. Birth order puts c0 first.
    name: "birth order changes notify order",
    program: {
      states: 2,
      computeds: readsS0,
      hooks: [],
      hookAction: "none",
      watchers: plainWatchers,
      ops: [
        { op: "get", i: 0 },
        { op: "watch", w: 1, t: 0 },
        { op: "watch", w: 2, t: 2 },
        { op: "set", i: 0, v: 1 },
      ],
    },
  },
];

function shrink(a: any, b: any, start: Program, lane: Lane, keep: (v: Verdict) => boolean): Program {
  const differ = (p: Program): boolean => keep(compare(a, b, p, lane));
  let p = start;
  for (let changed = true; changed; ) {
    changed = false;
    const attempts: Program[] = [];
    p.ops.forEach((_, i) => attempts.push({ ...p, ops: p.ops.filter((__, j) => j !== i) }));
    p.hooks.forEach((_, i) => attempts.push({ ...p, hooks: p.hooks.filter((__, j) => j !== i) }));
    p.computeds.forEach((steps, n) => {
      steps.forEach((_, i) => attempts.push({ ...p, computeds: p.computeds.map((s, m) => (m === n ? s.filter((__, j) => j !== i) : s)) }));
    });
    for (const q of attempts) {
      if (differ(q)) {
        p = q;
        changed = true;
        break;
      }
    }
  }
  return p;
}

it("searches for a public-API difference", async () => {
  const load = async (base: string): Promise<any> => {
    const wrapper = await import(/* @vite-ignore */ resolve(base, "src/wrapper.ts"));
    const graph = await import(/* @vite-ignore */ resolve(base, "src/graph.ts"));
    return { ...wrapper, resetActiveConsumer: () => graph.setActiveConsumer(null) };
  };
  const port = await load(process.env["POLYFILL_PORT_ROOT"] as string);
  const reference = await load(process.env["SEARCH_REFERENCE_ROOT"] ?? resolve(here, "../../../.cache/signal-polyfill-fba09f8"));
  const output: Record<string, unknown> = { programs: PROGRAMS };
  for (const lane of ["P", "E"] as const) {
    const counts: Record<Verdict, number> = { same: 0, inconclusive: 0, order: 0, behaviour: 0, "notify-throw": 0, "hook-throw": 0 };
    let selfDivergent = 0;
    const first = new Map<Verdict, Program>();
    for (let seed = 1; seed <= PROGRAMS; seed++) {
      const program = generate(seed, lane);
      if (compare(reference, reference, program, lane) !== "same") selfDivergent++;
      const verdict = compare(reference, port, program, lane);
      counts[verdict]++;
      if (!first.has(verdict)) first.set(verdict, program);
    }
    const witnesses: Record<string, object> = {};
    for (const verdict of VERDICTS) {
      const start = first.get(verdict);
      if (start === undefined) continue;
      const program = shrink(reference, port, start, lane, (v) => v === verdict);
      witnesses[verdict] = { program, reference: execute(reference, program, lane), variant: execute(port, program, lane) };
    }
    output[lane] = { ...counts, selfDivergent, witnesses };
  }
  output["directed"] = DIRECTED.map(({ name, program }) => ({
    name,
    verdict: compare(reference, port, program, "P"),
    reference: execute(reference, program, "P"),
    variant: execute(port, program, "P"),
  }));
  writeFileSync(process.env["SEARCH_OUTPUT"] as string, JSON.stringify(output));
});
