// M3.5: change one mechanism of the polyfill port at a time, run the frozen corpus,
// and search public-API programs in two lanes.
//
//   npm run polyfill:ablate      results -> research/M3.5-ABLATIONS.md
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const B = "src/backend.ts";
const G = "src/graph.ts";

const NO_SWAP = [
  [B, `  if (tail !== null && !same(tail, relation)) {
    accounting.rightSwaps++;
    store.moveAfter("right", tail, before);
  } else {
    accounting.rightTailRemovals++;
  }
`, "  void before;\n  void tail;\n"],
];

const ALWAYS_PRESENT = [
  ...NO_SWAP,
  [B, /export function liveConsumerAt\([\s\S]*?\n}\n/, `export function liveConsumerAt(producer: Bound, index: number): any {
  let seen = 0;

  for (let e = store.first("right", idOf(producer)); e !== null; e = store.next("right", e)) {
    accounting.rightWalkSteps++;

    if (store.meta(e) !== 1) {
      accounting.ablationWork++;
      continue;
    }
    if (seen++ === index) return bound[store.left(e).slot];
  }
  return undefined;
}
`],
  [B, /export function liveConsumers\([\s\S]*?\n}\n/, `export function liveConsumers(producer: Bound): any[] {
  const out: any[] = [];

  for (let e = store.first("right", idOf(producer)); e !== null; e = store.next("right", e)) {
    accounting.rightWalkSteps++;

    if (store.meta(e) === 1) out.push(bound[store.left(e).slot]);
    else accounting.ablationWork++;
  }
  return out;
}
`],
  [B, /export function liveConsumerCount\([\s\S]*?\n}\n/, `export function liveConsumerCount(producer: Bound): number {
  let count = 0;

  for (let e = store.first("right", idOf(producer)); e !== null; e = store.next("right", e)) {
    accounting.rightWalkSteps++;

    if (store.meta(e) === 1) count++;
    else accounting.ablationWork++;
  }
  return count;
}
`],
  [B, "  return store.relate(idOf(consumer), idOf(producer), STRONG);\n}\n", `  return store.relate(idOf(consumer), idOf(producer), STRONG, 1);
}

export function createInactive(consumer: Bound, producer: Bound): Relation {
  accounting.inactiveBirths++;

  return store.relate(idOf(consumer), idOf(producer), STRONG, 0);
}

export function dropInactive(relation: Relation): void {
  store.unlink(relation);
}

export function activate(producer: Bound, relation: Relation): void {
  accounting.activationFlips++;
  store.setMeta(relation, 1);
  void producer;
}

export function deactivate(relation: Relation): void {
  accounting.deactivationFlips++;
  store.setMeta(relation, 0);
}
`],
  [B, "  return { traceEntriesAtEnd: total,", `  const relations = store.snapshot().relations.filter((r) => r.state === "live");

  return { physicalRelationsAtEnd: relations.length, inactiveRelationsAtEnd: relations.filter((r) => r.meta !== 1).length, traceEntriesAtEnd: total,`],
  [G, "  traceOnly,\n  type Relation,\n", "  activate,\n  createInactive,\n  deactivate,\n  dropInactive,\n  type Relation,\n"],
  [G, `      // \`activeConsumer.producerNode[idx]\` which will be overwritten below.
    }
`, `      // \`activeConsumer.producerNode[idx]\` which will be overwritten below.
    } else {
      dropInactive(activeConsumer.producerIndexOfThis[idx]!);
    }
`],
  [G, ": traceOnly();", ": createInactive(activeConsumer, node);"],
  [G, "      producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]!);\n    }\n  }\n\n  // Truncate the producer tracking arrays.", "      producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]!);\n    }\n  } else {\n    for (let i = node.nextProducerIndex; i < node.producerNode.length; i++) {\n      dropInactive(node.producerIndexOfThis[i]!);\n    }\n  }\n\n  // Truncate the producer tracking arrays."],
  [G, "      node.producerIndexOfThis[i] = producerAddLiveConsumer(node.producerNode[i], node);\n", "      producerActivate(node.producerNode[i], node.producerIndexOfThis[i]!);\n"],
  [G, "      producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]!);\n    }\n    endDeactivation();\n", "      producerDeactivate(node.producerNode[i], node.producerIndexOfThis[i]!);\n    }\n    endDeactivation();\n"],
  [G, "function consumerIsLive(node: ReactiveNode): boolean {", `function producerActivate(node: ReactiveNode, relation: Relation): void {
  assertProducerNode(node);
  assertConsumerNode(node);
  if (liveConsumerCount(node) === 0) {
    node.watched?.call(node.wrapper);
    beginActivation();
    for (let i = 0; i < node.producerNode.length; i++) {
      producerActivate(node.producerNode[i], node.producerIndexOfThis[i]!);
    }
    endActivation();
  }
  activate(node, relation);
}

function producerDeactivate(node: ReactiveNode, relation: Relation): void {
  assertProducerNode(node);
  assertConsumerNode(node);
  if (liveConsumerCount(node) === 1) {
    node.unwatched?.call(node.wrapper);
    beginDeactivation();
    for (let i = 0; i < node.producerNode.length; i++) {
      producerDeactivate(node.producerNode[i], node.producerIndexOfThis[i]!);
    }
    endDeactivation();
  }
  deactivate(relation);
}

function consumerIsLive(node: ReactiveNode): boolean {`],
];

const MOVE_TO_TAIL_ON_ACTIVATION = [
  [B, "  store.setMeta(relation, 1);\n  void producer;\n", `  store.setMeta(relation, 1);

  let tail: Relation | null = null;

  for (let e = store.first("right", idOf(producer)); e !== null; e = store.next("right", e)) tail = e;

  if (tail !== null && !same(tail, relation)) store.moveAfter("right", relation, tail);
`],
];

/** Lets the GC probe reach the store of a variant. Observes only. */
const GC_PROBE = [
  [B, "/** How many trace entries have no live relation at this moment. */", `export const gcProbe = {
  rootOf(node: Bound): void {
    store.root(idOf(node));
  },
  collect(): void {
    store.collect();
  },
  statusOf(subject: Bound & { relation?: Relation }): string {
    if (subject.relation !== undefined) return store.status(subject.relation);
    if (subject.storeId === undefined) throw new Error("node was never bound");
    return store.status(subject.storeId);
  },
};

/** How many trace entries have no live relation at this moment. */`],
];

const MUTABLE_RETENTION = [
  [B, 'import { accounting } from "./accounting";', 'import { LIVE_RETENTION, MutableRetentionMachine } from "../../../reference/experimental/mutable-retention.ts";\nimport { accounting } from "./accounting";'],
  [B, "const store = new RelationMachine();", "void RelationMachine;\nconst store = new MutableRetentionMachine();"],
  [B, "  return store.relate(idOf(consumer), idOf(producer), STRONG, 1);", "  return store.relate(idOf(consumer), idOf(producer), LIVE_RETENTION, 1);"],
  [B, "  store.setMeta(relation, 1);\n", "  store.setMeta(relation, 1);\n  accounting.retentionFlips++;\n  store.setRetention(relation, LIVE_RETENTION);\n"],
  [B, "  store.setMeta(relation, 0);\n", "  store.setMeta(relation, 0);\n  accounting.retentionFlips++;\n  store.setRetention(relation, STRONG);\n"],
];

const MUTANTS = [
  ["port", "control: the unmodified port through this harness", []],
  ["stable-erase", "right removal preserves order instead of swapping the last entry in", NO_SWAP],
  ["B-stable", "every dependency is a relation; push uses only active ones; right order is birth order", ALWAYS_PRESENT],
  ["B-tail", "as B-stable, and activation moves the relation to the right tail", [...ALWAYS_PRESENT, ...MOVE_TO_TAIL_ON_ACTIVATION, ...GC_PROBE]],
  ["B-retain", "as B-tail, and right-to-left retention follows activation in place", [...ALWAYS_PRESENT, ...MOVE_TO_TAIL_ON_ACTIVATION, ...GC_PROBE, ...MUTABLE_RETENTION]],
];

/** [variant, reference]; null is the frozen polyfill. */
const SEARCHES = [
  ["port", null],
  ["stable-erase", null],
  ["B-stable", null],
  ["B-tail", null],
  ["B-retain", null],
  ["B-stable", "stable-erase"],
  ["B-tail", "stable-erase"],
  ["B-retain", "stable-erase"],
  ["B-retain", "B-tail"],
];

const GC_VARIANTS = ["B-tail", "B-retain"];

const WORK_KEYS = ["ablationWork", "inactiveBirths", "activationFlips", "deactivationFlips", "retentionFlips", "birthsFromActivation", "deathsFromDeactivation", "physicalRelationsAtEnd", "inactiveRelationsAtEnd"];

function prepare(id, edits) {
  const dir = path.join(root, ".cache/m3.5", id);
  mkdirSync(dir, { recursive: true });
  for (const part of ["adapters", "reference"]) {
    cpSync(path.join(root, part), path.join(dir, part), { recursive: true, force: true });
  }
  const portRoot = path.join(dir, "adapters/polyfill");
  for (const [file, find, replace] of edits) {
    const target = path.join(portRoot, file);
    const text = readFileSync(target, "utf8");
    const found = typeof find === "string" ? text.split(find).length - 1 : (text.match(find) ?? []).length;
    if (found !== 1) throw new Error(`${id}: ${found} matches in ${file}: ${find}`);
    writeFileSync(target, text.replace(find, () => replace));
  }
  return { dir, portRoot };
}

function corpus({ dir, portRoot }) {
  const output = path.join(dir, "result.json");
  writeFileSync(output, "");
  spawnSync(`npx vitest run --config adapters/polyfill/vitest.config.ts --reporter=json --outputFile="${output}"`, {
    cwd: root,
    env: { ...process.env, POLYFILL_PORT: "1", POLYFILL_PORT_ROOT: portRoot },
    shell: true,
    stdio: "ignore",
    timeout: 200_000,
  });
  const raw = readFileSync(output, "utf8");
  if (raw === "") return { hang: true, failures: [], total: 0, work: {} };
  const failures = [];
  let total = 0;
  for (const file of JSON.parse(raw).testResults) {
    for (const test of file.assertionResults) {
      total++;
      if (test.status === "failed") failures.push({ title: test.fullName, message: (test.failureMessages[0] ?? "").split("\n")[0].replace(/\u001b\[[0-9;]*m/g, "").slice(0, 130) });
    }
  }
  const work = Object.fromEntries(WORK_KEYS.map((k) => [k, 0]));
  const accountingDir = path.join(dir, ".cache/polyfill-accounting");
  if (existsSync(accountingDir)) {
    for (const f of readdirSync(accountingDir)) {
      const r = JSON.parse(readFileSync(path.join(accountingDir, f), "utf8"));
      if (r !== null) for (const k of WORK_KEYS) work[k] += r[k] ?? 0;
    }
  }
  return { failures, total, work };
}

function search(variant, referenceId) {
  const dir = path.join(root, ".cache/m3.5", variant);
  const output = path.join(dir, `search-${referenceId ?? "frozen"}.json`);
  writeFileSync(output, "");
  const reference = referenceId === null ? {} : { SEARCH_REFERENCE_ROOT: path.join(root, ".cache/m3.5", referenceId, "adapters/polyfill") };
  spawnSync("npx vitest run --config adapters/polyfill/search/vitest.config.ts --reporter=dot", {
    cwd: root,
    env: { ...process.env, POLYFILL_PORT_ROOT: path.join(dir, "adapters/polyfill"), SEARCH_OUTPUT: output, ...reference },
    shell: true,
    stdio: "ignore",
    timeout: 300_000,
  });
  const raw = readFileSync(output, "utf8");
  return raw === "" ? { error: "no result" } : JSON.parse(raw);
}

function gc(variant) {
  const dir = path.join(root, ".cache/m3.5", variant);
  const output = path.join(dir, "gc-port.json");
  writeFileSync(output, "");
  spawnSync("npx vitest run --config adapters/polyfill/search/vitest.config.ts --reporter=dot", {
    cwd: root,
    env: { ...process.env, POLYFILL_PORT_ROOT: path.join(dir, "adapters/polyfill"), SEARCH_OUTPUT: output, SEARCH_INCLUDE: "adapters/polyfill/search/gc-port.test.ts" },
    shell: true,
    stdio: "ignore",
    timeout: 120_000,
  });
  const raw = readFileSync(output, "utf8");
  return raw === "" ? null : JSON.parse(raw);
}

const prepared = new Map(MUTANTS.map(([id, , edits]) => [id, prepare(id, edits)]));
const results = MUTANTS.map(([id, changes]) => {
  const r = { id, changes, ...corpus(prepared.get(id)) };
  console.log(`${id}: ${r.hang ? "HANG" : `${r.total - r.failures.length} of ${r.total}`} ${JSON.stringify(r.work)}`);
  return r;
});
const searches = SEARCHES.map(([variant, reference]) => {
  const s = search(variant, reference);
  const brief = (l) => (l === undefined ? s.error : `order ${l.order}, behaviour ${l.behaviour}, notify-throw ${l["notify-throw"]}, hook-throw ${l["hook-throw"]}, inconclusive ${l.inconclusive}, self ${l.selfDivergent}`);
  console.log(`${variant} vs ${reference ?? "frozen"}: P [${brief(s.P)}], E [${brief(s.E)}] of ${s.programs ?? "?"}; directed: ${(s.directed ?? []).map((d) => `${d.name}=${d.verdict}`).join(", ")}`);
  return { variant, reference: reference ?? "frozen", ...s };
});
const gcResults = GC_VARIANTS.map((variant) => {
  const rows = gc(variant);
  console.log(`gc ${variant}: ${JSON.stringify(rows)}`);
  return { variant, rows };
});
writeFileSync(path.join(root, ".cache/m3.5/results.json"), JSON.stringify({ results, searches, gcResults }, null, 2));

const lines = [
  "# M3.5 ablations",
  "",
  "Generated by `npm run polyfill:ablate`. Do not edit.",
  "",
  "Subject: the port of `signal-polyfill@fba09f8`. Lane P obeys the proposal's guardrails; lane E uses what only the executable accepts. Logs include runs, values, errors, notify, watched and unwatched order, getPending, and introspection after every operation.",
  "",
  "| Variant | Change | Corpus | Failing tests |",
  "| --- | --- | ---: | --- |",
];
for (const r of results) lines.push(`| ${r.id} | ${r.changes} | ${r.hang ? "hang" : `${r.total - r.failures.length} of ${r.total}`} | ${r.failures.map((f) => f.title).join("; ").replaceAll("|", "\\|") || "none"} |`);
lines.push("", "## Work", "", `| Variant | ${WORK_KEYS.join(" | ")} |`, `| --- | ${WORK_KEYS.map(() => "---:").join(" | ")} |`);
for (const r of results) lines.push(`| ${r.id} | ${WORK_KEYS.map((k) => r.work[k] ?? 0).join(" | ")} |`);
lines.push(
  "",
  "## Public-API search",
  "",
  "Each row counts programs by first matching cause. `order`: only the order of a sink list differs. `hook` and `notify`: anything else differs in a program where a hook or a notify threw. `plain`: anything else differs with no throw from either. `inc`: overflowed the engine stack or inherited a leaked consumer. `self`: the reference against itself, which must be 0.",
  "",
  "| Variant | Reference | Programs | P order | P plain | P notify | P hook | P inc | P self | E order | E plain | E notify | E hook | E inc | E self |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
);
for (const s of searches) {
  const cells = (l) => (l === undefined ? [s.error, "", "", "", "", ""] : [l.order, l.behaviour, l["notify-throw"], l["hook-throw"], l.inconclusive, l.selfDivergent]);
  lines.push(`| ${s.variant} | ${s.reference} | ${s.programs ?? "?"} | ${[...cells(s.P), ...cells(s.E)].join(" | ")} |`);
}
lines.push("", "## Directed programs", "", "Programs aimed at right-axis order, with no throw anywhere.", "", "| Variant | Reference | Program | Verdict |", "| --- | --- | --- | --- |");
for (const s of searches) for (const d of s.directed ?? []) lines.push(`| ${s.variant} | ${s.reference} | ${d.name} | ${d.verdict} |`);
lines.push("", "## GC on the running port", "", "Activation comes from the polyfill's own cascade through the public API, and only states are rooted. B-tail keeps fixed retention and is the control.", "", "| Variant | Scenario | Observed |", "| --- | --- | --- |");
for (const { variant, rows } of gcResults) {
  if (rows === null) lines.push(`| ${variant} | no result | |`);
  else for (const r of rows) lines.push(`| ${variant} | ${r.name} | ${Object.entries(r.observed).map(([k, v]) => `${k}: ${v}`).join(", ")} |`);
}
lines.push("", "## Shrunk witnesses", "");
const clip = (log) => {
  const text = log.join(" ; ");
  return text.length > 4000 ? `${text.slice(0, 4000)} ...` : text;
};
for (const s of searches) {
  for (const lane of ["P", "E"]) {
    for (const [kind, w] of Object.entries(s[lane]?.witnesses ?? {})) {
      lines.push(`### ${s.variant} vs ${s.reference}, lane ${lane}, ${kind}`, "", "```json", JSON.stringify(w.program), "```", "", "```text", `reference: ${clip(w.reference)}`, `variant:   ${clip(w.variant)}`, "```", "");
    }
  }
}
writeFileSync(path.join(root, "research/M3.5-ABLATIONS.md"), lines.join("\n"));
