// M1.5: remove or replace one mechanism of the port at a time, run the unchanged
// corpus, and sort every failure by what it can claim.
//
//   npm run quant:ablate [id ...]      results -> research/M1.5-ABLATIONS.md
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const B = "src/backend.ts";
const K = "src/kernel.ts";
const T = "src/tracking.ts";

const RETIRED_BRANCH = `  if (store.status(e) === "retired") {
    const literal = retiredNext.get(e.slot) ?? null;

    if (__STATS__) tallyRetiredNext(e, literal);

    return literal;
  }
`;
const BIT = "0x40000000";
const TENTATIVE = `(m < 0 ? m === -2 : (m & ${BIT}) !== 0)`;

/** id, what changes, edits as [file, find, replace], each find unique. */
const MUTANTS = [
  ["port", "control: the unmodified port through this harness", []],
  ["no-store-epochs", "store.enter and store.exit removed; the adapter's logical walk count stays", [
    [B, "  walks++;\n  store.enter();\n", "  walks++;\n"],
    [B, "export function exitWalk(): void {\n  store.exit();\n", "export function exitWalk(): void {\n"],
  ]],
  ["l0-continuation", "retired next answered by L0 clause 8 instead of literal retired-next", [
    [B, RETIRED_BRANCH, ""],
  ]],
  ["prev-null", "backward scan sees no predecessor; the absence proof is unchanged", [
    [T, "let p = last !== null ? prevDep(last) : null;", "let p: Edge | null = null;"],
  ]],
  ["no-prev-fallback", "no backward scan and no left-side absence proof; pair and index decide", [
    [T, "let p = last !== null ? prevDep(last) : null;", "let p: Edge | null = null;"],
    [T, "found = e === null && p === null ? null : pair(s, c);", "found = pair(s, c);"],
  ]],
  ["gen-never-tentative", "gen removed: every edge counts as committed", [
    [B, "  return generations[e.slot] as Generation;", "  return -1;"],
  ]],
  ["gen-always-tentative", "gen removed: every edge counts as tentative", [
    [B, "  return generations[e.slot] as Generation;", "  return (target(e).gen + 1) & 0x3fffffff;"],
  ]],
  ["one-word-tentative", "ver and a tentative bit share the metadata word; the bit is cleared at commit", [
    [B, "  return store.meta(e);", "  const m = store.meta(e);\n\n  return m < 0 ? -1 : m & 0x3fffffff;"],
    [B, "  store.setMeta(e, version);", `  const m = store.meta(e);\n  const t = ${TENTATIVE};\n\n  store.setMeta(e, version < 0 ? (t ? -2 : -1) : t ? version | ${BIT} : version);`],
    [B, "  return generations[e.slot] as Generation;", `  const m = store.meta(e);\n  const g = target(e).gen;\n\n  return ${TENTATIVE} ? (g + 1) & 0x3fffffff : g;`],
    [B, "store.relate(c.id, s.id, STRONG, version);\n  generations[e.slot] = generation;", `store.relate(c.id, s.id, STRONG, version | ${BIT});\n  void generation;`],
    [B, "export function externalSizes()", `export function clearTentative(n: Node): void {\n  for (let e = firstDep(n); e !== null; e = store.next("left", e)) {\n    accounting.ablationWork++;\n    const m = store.meta(e);\n\n    if (m === -2) store.setMeta(e, -1);\n    else if (m >= 0 && (m & ${BIT}) !== 0) store.setMeta(e, m & 0x3fffffff);\n  }\n}\n\nexport function externalSizes()`],
    [K, "  n.gen = (n.gen + 1) & MASK;\n", "  clearTentative(n);\n  n.gen = (n.gen + 1) & MASK;\n"],
    [K, "  linkEdge,\n", "  clearTentative,\n  linkEdge,\n"],
  ]],
];

const PINNED = /^(?:structural bounds |tracking )?(O1|O2|WOKEN|LOG \d+|P5 witnesses)/;

function laneOf(file, title) {
  const name = path.basename(file);
  if (name === "l0-walks.test.ts") return "extension";
  if (name === "structure.test.ts" || name === "tracking.test.ts") return PINNED.test(title) ? "pinned" : "structural";
  return "semantic";
}

function run(id, edits) {
  const dir = path.join(root, ".cache/m1.5", id);
  mkdirSync(dir, { recursive: true });
  for (const part of ["adapters", "reference"]) {
    cpSync(path.join(root, part), path.join(dir, part), { recursive: true, force: true });
  }
  const portRoot = path.join(dir, "adapters/quant");
  for (const [file, find, replace] of edits) {
    const target = path.join(portRoot, file);
    const text = readFileSync(target, "utf8");
    if (text.split(find).length !== 2) throw new Error(`${id}: not unique in ${file}: ${find}`);
    writeFileSync(target, text.replace(find, () => replace));
  }
  const output = path.join(dir, "result.json");
  writeFileSync(output, "");
  const { error } = spawnSync(`npx vitest run --config adapters/quant/vitest.config.ts --reporter=json --outputFile="${output}"`, {
    cwd: root,
    env: { ...process.env, QUANT_PORT: "1", QUANT_PORT_ROOT: portRoot },
    shell: true,
    stdio: "ignore",
    timeout: 240_000,
  });
  const raw = readFileSync(output, "utf8");
  if (raw === "") return { id, hang: true, error: String(error ?? "no result"), failures: [], totals: {}, accounting: {} };

  const failures = [];
  const totals = { semantic: 0, structural: 0, pinned: 0, extension: 0 };
  for (const file of JSON.parse(raw).testResults) {
    for (const test of file.assertionResults) {
      const lane = laneOf(file.name, test.fullName);
      totals[lane]++;
      if (test.status === "failed") {
        const message = (test.failureMessages[0] ?? "").split("\n")[0].replace(/\u001b\[[0-9;]*m/g, "").slice(0, 150);
        failures.push({ lane, title: test.title, file: path.basename(file.name, ".test.ts"), message });
      }
    }
  }
  const accountingDir = path.join(dir, ".cache/accounting");
  const accounting = {};
  if (existsSync(accountingDir)) {
    for (const key of ["pairFoundFirst", "pairFoundDeeper", "pairAbsent", "pairBudgetExhausted", "indexes", "indexedEdges", "sweeps", "ablationWork"]) {
      accounting[key] = 0;
      for (const f of ["differential", "semantics", "structure", "surface", "tracking"]) {
        const p = path.join(accountingDir, `${f}.test.ts.json`);
        if (existsSync(p)) accounting[key] += JSON.parse(readFileSync(p, "utf8"))[key] ?? 0;
      }
    }
  }
  return { id, totals, failures, accounting };
}

const only = process.argv.slice(2);
const results = [];
for (const [id, changes, edits] of MUTANTS) {
  if (only.length > 0 && !only.includes(id)) continue;
  const result = run(id, edits);
  results.push({ ...result, changes });
  const count = (lane) => result.failures.filter((f) => f.lane === lane).length;
  console.log(`${id}: ${result.hang ? `HANG ${result.error}` : `semantic ${count("semantic")} structural ${count("structural")} pinned ${count("pinned")} extension ${count("extension")}`}`);
}
writeFileSync(path.join(root, ".cache/m1.5/results.json"), JSON.stringify(results, null, 2));

if (only.length === 0) {
  const lines = [
    "# M1.5 ablations",
    "",
    "Generated by `npm run quant:ablate`. Do not edit.",
    "",
    "Subject: the port of `quant-main@241a3b7`. Each row changes one mechanism. Failures are sorted by what they can claim:",
    "",
    "- **semantic**: `differential`, `semantics`, `surface`. Inside the frozen contract.",
    "- **structural**: the rest of `structure` and `tracking`, which encode S1 to S7 and also check values. Read the message before calling one a violation of a bound.",
    "- **pinned**: tests named O1, O2, WOKEN, LOG n, P5 witnesses. They pin one implementation's paths and counters and are not contract authority.",
    "- **extension**: W1 to W3. Reachable through the public API, outside the frozen contract.",
    "",
    "| Mutant | Change | Semantic | Structural | Pinned | Extension |",
    "| --- | --- | ---: | ---: | ---: | --- |",
  ];
  for (const r of results) {
    const count = (lane) => r.failures.filter((f) => f.lane === lane).length;
    const ext = r.failures.filter((f) => f.lane === "extension").map((f) => f.title.split(":")[0]).join(", ") || "none";
    lines.push(r.hang ? `| ${r.id} | ${r.changes} | hang | hang | hang | hang |` : `| ${r.id} | ${r.changes} | ${count("semantic")} of ${r.totals.semantic} | ${count("structural")} of ${r.totals.structural} | ${count("pinned")} of ${r.totals.pinned} | ${ext} |`);
  }
  const keys = ["pairFoundFirst", "pairFoundDeeper", "pairAbsent", "pairBudgetExhausted", "indexes", "indexedEdges", "sweeps", "ablationWork"];
  lines.push("", "## Work over Quant's corpus", "", `| Mutant | ${keys.join(" | ")} |`, `| --- | ${keys.map(() => "---:").join(" | ")} |`);
  for (const r of results) lines.push(`| ${r.id} | ${keys.map((k) => r.accounting[k] ?? "-").join(" | ")} |`);
  lines.push("", "## Failures", "");
  for (const r of results) {
    if (r.failures.length === 0) continue;
    lines.push(`### ${r.id}`, "", "| Lane | Test | First line of the failure |", "| --- | --- | --- |");
    for (const f of r.failures.sort((a, b) => a.lane.localeCompare(b.lane) || a.title.length - b.title.length)) {
      lines.push(`| ${f.lane} | ${f.file}: ${f.title.replaceAll("|", "\\|")} | ${f.message.replaceAll("|", "\\|")} |`);
    }
    lines.push("");
  }
  writeFileSync(path.join(root, "research/M1.5-ABLATIONS.md"), lines.join("\n"));
}
