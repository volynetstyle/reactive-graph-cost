// Gathers every measured number the paper uses into paper/data/results.json. Rule: a number in
// the manuscript comes from this file or from a primary result it reads, never from memory.
//   node paper/tools/collect.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const cache = (...p) => path.join(root, ".cache", ...p);
const json = (f) => JSON.parse(readFileSync(f, "utf8"));
const sorted = (xs) => xs.slice().sort((a, b) => a - b);
const median = (xs) => {
  const s = sorted(xs);
  return s.length % 2 === 1 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const spread = (xs) => ({ median: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length });

function run(command, env = {}) {
  const r = spawnSync(command, { cwd: root, env: { ...process.env, ...env }, shell: true, encoding: "utf8", maxBuffer: 1 << 28, timeout: 900000 });
  return (r.stdout ?? "") + (r.stderr ?? "");
}

function compare(script, envName, variant, programs, a, b) {
  const out = run(`node adapters/${script}/compare.ts "${programs}" "${a}"${b === undefined ? "" : ` "${b}"`}`, { [envName]: variant });
  const lines = out.split("\n");
  const m = /programs (\d+), same (\d+), differ (\d+)/.exec(out);
  if (m === null) throw new Error(`no result for ${script} ${variant}: ${out.slice(0, 300)}`);
  const accounting = lines.find((l) => l.startsWith("{"));
  const values = /of which values differ (\d+)/.exec(out);
  return { programs: Number(m[1]), same: Number(m[2]), differ: Number(m[3]), valuesDiffer: values === null ? undefined : Number(values[1]), accounting: accounting === undefined ? undefined : JSON.parse(accounting) };
}

const out = {};

// ---- behavioural -------------------------------------------------------------------------------
const wc = cache("wpf-oracle");
const wpfCorpora = {
  directed: ["adapters/wpf/programs/directed.json", path.join(wc, "directed.json"), path.join(wc, "repeat1.json")],
  handler: ["adapters/wpf/programs/handler-lifetime.json", path.join(wc, "handler-lifetime.json")],
  generated: [path.join(wc, "generated-programs.json"), path.join(wc, "generated-a.json"), path.join(wc, "generated-b.json")],
  holdout: [path.join(wc, "holdout-programs.json"), path.join(wc, "holdout-a.json"), path.join(wc, "holdout-b.json")],
};
out.wpf = {};
for (const v of ["s0", "s1", "s1-nosub", "s2", "s2-log", "s2-next"]) {
  out.wpf[v] = {};
  for (const [c, [p, a, b]] of Object.entries(wpfCorpora)) out.wpf[v][c] = compare("wpf", "WPF_VARIANT", v, p, a, b);
}

const sc = cache("salsa-oracle");
const salsaCorpora = {
  directed: ["adapters/salsa/programs/directed.json"],
  generated: [path.join(sc, "generated-programs.json")],
  holdout: [path.join(sc, "holdout-programs.json")],
  fresh: [path.join(sc, "fresh-programs.json")],
  shapes: [path.join(sc, "shapes-programs.json")],
};
out.salsa = {};
for (const v of ["b1", "b2", "b3c", "b3l", "b3d", "b4"]) {
  out.salsa[v] = {};
  for (const [c, [p]] of Object.entries(salsaCorpora)) {
    out.salsa[v][c] = compare("salsa", "SALSA_VARIANT", v, p, path.join(sc, `${c}-a.json`), path.join(sc, `${c}-b.json`));
  }
}
out.salsaShapes = {};
for (const v of ["b1", "b2", "b3c", "b3l", "b3d"]) {
  const text = run(`node adapters/salsa/compare.ts "${salsaCorpora.shapes[0]}" "${path.join(sc, "shapes-a.json")}" "${path.join(sc, "shapes-b.json")}"`, { SALSA_VARIANT: v, SALSA_EACH: "1" });
  for (const line of text.split("\n")) {
    const [name, variant, status, counters] = line.split("\t");
    if (counters === undefined) continue;
    (out.salsaShapes[name] ??= {})[variant] = { status, ...JSON.parse(counters) };
  }
}
out.salsaJournal = readFileSync(path.join(sc, "journal.txt"), "utf8");

const alien = json(cache("m2.5/results.json"));
const alienRow = (id) => {
  const r = alien.find((x) => x.id === id);
  return { passed: r.total === undefined ? undefined : r.total - r.failures.length, total: r.total, divergent: r.search?.divergent, programs: r.search?.programs, reference: r.reference };
};
out.alien = Object.fromEntries(alien.map((x) => [x.id, alienRow(x.id)]));

const flat = cache("m4.5/alien-flat");
if (existsSync(flat)) {
  let total = 0;
  let failed = 0;
  for (const f of json(path.join(flat, "corpus.json")).testResults) {
    for (const t of f.assertionResults) {
      total++;
      if (t.status === "failed") failed++;
    }
  }
  out.alienFlat = { passed: total - failed, total, frozen: json(path.join(flat, "search-frozen.json")), wideFix: json(path.join(flat, "search-wide-fix.json")) };
}

const poly = json(cache("m3.5/results.json"));
out.polyfill = {
  corpus: Object.fromEntries(poly.results.map((r) => [r.id, { passed: r.total - r.failures.length, total: r.total, work: r.work }])),
  searches: poly.searches.map((s) => ({ variant: s.variant, reference: s.reference, programs: s.programs, P: pick(s.P), E: pick(s.E), directed: s.directed?.map((d) => ({ name: d.name, verdict: d.verdict })) })),
  gc: poly.gcResults,
};
function pick(l) {
  return l === undefined ? undefined : { order: l.order, behaviour: l.behaviour, notifyThrow: l["notify-throw"], hookThrow: l["hook-throw"], inconclusive: l.inconclusive, self: l.selfDivergent };
}

const tests = /Tests\s+(\d+) passed/;
out.rootTests = Number(tests.exec(run("npx vitest run --reporter=dot"))?.[1]);
out.quantPort = Number(tests.exec(run("node adapters/quant/run-port.mjs"))?.[1]);

// ---- physical ----------------------------------------------------------------------------------
const runs = cache("m5/runs");
const rustFiles = readdirSync(runs).filter((f) => /^rust-\d+\.json$/.test(f)).sort();
const jsFiles = readdirSync(runs).filter((f) => /^js-\d+\.json$/.test(f)).sort();
const rust = rustFiles.map((f) => json(path.join(runs, f)).filter((x) => x.section !== undefined));
const js = jsFiles.map((f) => json(path.join(runs, f)));
out.physical = { rustRuns: rust.length, jsRuns: js.length, environment: readFileSync(path.join(runs, "environment.txt"), "utf8"), tapes: {} };

for (const f of readdirSync(cache("m5/tapes"))) {
  const text = readFileSync(cache("m5/tapes", f));
  let lines = 0;
  for (const byte of text) if (byte === 10) lines++;
  out.physical.tapes[f.replace(".tape", "")] = lines;
}

const repRows = {};
for (const section of ["graph", "trace", "cow"]) {
  for (const r0 of rust[0].filter((x) => x.section === section)) {
    const per = rust.map((run) => run.find((x) => x.section === section && x.workload === r0.workload && x.rep === r0.rep));
    (repRows[r0.workload] ??= {})[r0.rep] = {
      ns: spread(per.map((x) => x.ns_per_op)),
      bytesPerRelation: spread(per.map((x) => x.peak_bytes / Math.max(1, x.peak_live))),
      allocsPerOp: median(per.map((x) => x.allocs_per_op)),
    };
  }
}
out.physical.rust = repRows;

const ratio = (a, b) => spread(a.map((x, i) => x / b[i]));
const rustNs = (w, rep) => rust.map((run) => run.find((x) => x.workload === w && x.rep === rep).ns_per_op);
out.physical.graphRatios = {};
for (const w of ["quant", "synthetic-calm", "synthetic-churn"]) {
  const jsNs = (rep) => js.map((r) => r[`${w}/${rep}`].nsPerOp);
  out.physical.graphRatios[w] = {
    rustRecordsOverSoa: ratio(rustNs(w, "ClientIntrusive"), rustNs(w, "StoreSoA")),
    rustRecordsOverAos: ratio(rustNs(w, "ClientIntrusive"), rustNs(w, "StoreAoS")),
    jsObjectsOverSoa: ratio(jsNs("JsObjectIntrusive"), jsNs("JsSoA")),
    jsObjectsOverAos: ratio(jsNs("JsObjectIntrusive"), jsNs("JsAoS")),
    jsSoaOverRustSoa: ratio(jsNs("JsSoA").slice(0, Math.min(js.length, rust.length)), rustNs(w, "StoreSoA").slice(0, Math.min(js.length, rust.length))),
    jsNs: { objects: spread(jsNs("JsObjectIntrusive")), aos: spread(jsNs("JsAoS")), soa: spread(jsNs("JsSoA")) },
    jsBytes: { objects: js[0][`${w}/JsObjectIntrusive`].bytesPerRelation ?? null, aos: js[0][`${w}/JsAoS`].bytesPerRelation, soa: js[0][`${w}/JsSoA`].bytesPerRelation },
  };
}
out.physical.boundary = { field: spread(js.map((r) => r.boundary.field)), weakMap: spread(js.map((r) => r.boundary.weakMap)) };
out.physical.jsAlien = { objects: spread(js.map((r) => r["alien/JsObjectIntrusive"].nsPerOp)), aos: spread(js.map((r) => r["alien/JsAoS"].nsPerOp)), soa: spread(js.map((r) => r["alien/JsSoA"].nsPerOp)) };

const COLS = ["packed", "packed_inplace", "persistent", "intrusive_rebuild", "intrusive_reuse", "aos_reuse", "intrusive_cursor", "aos_cursor", "intrusive_tail", "aos_tail"];
const LINKED_REUSE = ["intrusive_reuse", "aos_reuse", "intrusive_cursor", "aos_cursor", "intrusive_tail", "aos_tail"];
const cells = rust[0].filter((x) => x.section === "crossover").map((c0) => {
  const per = rust.map((run) => run.find((x) => x.section === "crossover" && x.n === c0.n && x.survive === c0.survive && x.order === c0.order));
  const cell = { n: c0.n, survive: c0.survive, order: c0.order };
  for (const col of COLS) cell[col] = median(per.map((x) => x[col]));
  return cell;
});
const winners = {};
const contiguousBest = cells.filter((c) => Math.min(c.packed, c.packed_inplace) <= Math.min(...COLS.slice(2).map((k) => c[k]))).length;
for (const c of cells) {
  const w = COLS.reduce((a, b) => (c[b] < c[a] ? b : a));
  winners[w] = (winners[w] ?? 0) + 1;
}
const bestLinked = (c) => Math.min(...LINKED_REUSE.map((k) => c[k]));
const packedLoses = cells.filter((c) => c.packed > bestLinked(c));
const inplaceLoses = cells.filter((c) => c.packed_inplace > bestLinked(c));
out.physical.crossover = {
  cells,
  winners,
  count: cells.length,
  contiguousBest,
  packedLosesToLinked: packedLoses.map((c) => ({ n: c.n, survive: c.survive, order: c.order, packed: c.packed, bestLinked: bestLinked(c) })),
  inplaceLosesToLinked: inplaceLoses.map((c) => ({ n: c.n, survive: c.survive, order: c.order, inplace: c.packed_inplace, bestLinked: bestLinked(c) })),
  bestLinkedOverPacked: spread(cells.map((c) => bestLinked(c) / c.packed)),
  bestLinkedOverInplace: spread(cells.map((c) => bestLinked(c) / c.packed_inplace)),
};

// How far apart the fresh processes landed, here and in the earlier campaign without core pinning.
const noise = (runs) => {
  const ratios = [];
  for (const section of ["graph", "trace", "cow"]) {
    for (const r0 of runs[0].filter((x) => x.section === section)) {
      const xs = runs.map((run) => run.find((x) => x.section === section && x.workload === r0.workload && x.rep === r0.rep)?.ns_per_op).filter((x) => x !== undefined);
      if (xs.length === runs.length) ratios.push(Math.max(...xs) / Math.min(...xs));
    }
  }
  return { series: ratios.length, median: median(ratios), max: Math.max(...ratios) };
};
out.physical.noise = { pinned: noise(rust) };
const unpinned = cache("m5/runs-unpinned");
if (existsSync(unpinned)) {
  const earlier = readdirSync(unpinned).filter((f) => /^rust-\d+\.json$/.test(f)).sort().map((f) => json(path.join(unpinned, f)).filter((x) => x.section !== undefined));
  out.physical.noise.unpinned = { ...noise(earlier), runs: earlier.length };
}

// ---- garbage collection ------------------------------------------------------------------------
const gcDir = cache("m5/gc");
mkdirSync(gcDir, { recursive: true });
run(`node --expose-gc adapters/m5/gc-feasibility.mjs 20 "${path.join(gcDir, "feasibility.json")}"`);
run(`node adapters/m5/gc-observer.mjs "${path.join(gcDir, "observer.json")}" 10`);
out.gc = { feasibility: json(path.join(gcDir, "feasibility.json")), observer: json(path.join(gcDir, "observer.json")) };
// The observer experiment was run twice. Rates between the extremes moved between the two.
const earlierResults = cache("m5/results-unpinned.json");
if (existsSync(earlierResults)) out.gc.observerEarlier = json(earlierResults).gc.observer;

mkdirSync(path.join(root, "paper/data"), { recursive: true });
writeFileSync(path.join(root, "paper/data/results.json"), JSON.stringify(out, null, 1));
console.log("wrote paper/data/results.json");
