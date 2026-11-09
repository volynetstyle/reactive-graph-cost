// M2.5: change one mechanism of the Alien port at a time, run the unchanged corpus,
// and for selected variants search public-API programs for a difference from
// frozen Alien.
//
//   npm run alien:ablate      results -> research/M2.5-ABLATIONS.md
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const B = "src/backend.ts";
const S = "src/system.ts";
const I = "src/index.ts";
const IMPORT_I = "import { depOf, enterEpoch, exitEpoch, firstDep, firstSub, nextDepOf, ownerOf, prevDepOf } from './backend';";

const NO_EPOCH = [
  [B, "export function enterEpoch(): void {\n  store.enter();\n", "export function enterEpoch(): void {\n"],
  [B, "export function exitEpoch(): void {\n  store.exit();\n\n", "export function exitEpoch(): void {\n"],
];
const CURSOR_FIX = [
  [S, "\t\tif (nextDep === undefined) {\n\t\t\tsub.depsTail = prevDep;\n\t\t}\n", "\t\tif (nextDep === undefined || (sub.depsTail !== undefined && same(sub.depsTail, link))) {\n\t\t\tsub.depsTail = prevDep;\n\t\t}\n"],
];
const NO_TOLERANCE = [
  [B, "  if (store.status(link) === \"retired\") {\n    accounting.secondUnlinks++;\n\n    return;\n  }\n", ""],
];
const SNAPSHOT = [
  [B, "function isRetired(link: Link): boolean {", `const snaps = new Map<string, { dep: any; sub: any; nextDep: Link | undefined; nextSub: Link | undefined }>();
const snapKey = (link: Link): string => link.slot + ":" + link.generation;

function viewOf(link: Link) {
  return store.status(link) === "stale" ? snaps.get(snapKey(link)) : undefined;
}

function record(e: Link): void {
  accounting.ablationWork++;
  snaps.set(snapKey(e), {
    dep: bound[store.right(e).slot],
    sub: bound[store.left(e).slot],
    nextDep: optional(store.next("left", e)),
    nextSub: optional(store.next("right", e)),
  });
}

function recordChains(start: Link): void {
  if (store.status(start) !== "live") return;

  for (let e: Link | null = start; e !== null; e = store.next("left", e)) record(e);
  for (let e: Link | null = start; e !== null; e = store.next("right", e)) record(e);
}

function isRetired(link: Link): boolean {`],
  [B, "export function depOf(link: Link): any {\n", "export function depOf(link: Link): any {\n  const snap = viewOf(link);\n\n  if (snap !== undefined) return snap.dep;\n\n"],
  [B, "export function subOf(link: Link): any {\n", "export function subOf(link: Link): any {\n  const snap = viewOf(link);\n\n  if (snap !== undefined) return snap.sub;\n\n"],
  [B, "export function nextDepOf(link: Link): Link | undefined {\n", "export function nextDepOf(link: Link): Link | undefined {\n  const snap = viewOf(link);\n\n  if (snap !== undefined) return snap.nextDep;\n\n"],
  [B, "export function nextSubOf(link: Link): Link | undefined {\n", "export function nextSubOf(link: Link): Link | undefined {\n  const snap = viewOf(link);\n\n  if (snap !== undefined) return snap.nextSub;\n\n"],
  [B, "  accounting.updateCrossings++;\n", "  for (const h of held) recordChains(h);\n\n  accounting.updateCrossings++;\n"],
  [B, "  if (--epochDepth === 0) frozen.clear();", "  if (--epochDepth === 0) {\n    frozen.clear();\n    snaps.clear();\n  }"],
];
const RESEEK = [
  [B, "function isRetired(link: Link): boolean {", "export function isLive(link: Link): boolean {\n  return store.status(link) === \"live\";\n}\n\nfunction isRetired(link: Link): boolean {"],
  [S, "\tcreateLink,\n\tcrossing,\n", "\tcreateLink,\n\tcrossing,\n\tisLive,\n"],
  [S, "if (crossing(() => update(dep), link, stack, subs)) {\n\t\t\t\t\tif (nextSubOf(subs) !== undefined) {\n\t\t\t\t\t\tshallowPropagate(subs);\n\t\t\t\t\t}\n", "if (crossing(() => update(dep), link, stack, subs)) {\n\t\t\t\t\tconst fresh = firstSub(dep);\n\t\t\t\t\tif (fresh !== undefined && nextSubOf(fresh) !== undefined) {\n\t\t\t\t\t\tshallowPropagate(fresh);\n\t\t\t\t\t}\n"],
  [S, "if (crossing(() => update(sub), link, stack, subs)) {\n\t\t\t\t\t\tif (nextSubOf(subs) !== undefined) {\n\t\t\t\t\t\t\tshallowPropagate(subs);\n\t\t\t\t\t\t}\n\t\t\t\t\t\tsub = subOf(link);\n", "if (crossing(() => update(sub), link, stack, subs)) {\n\t\t\t\t\t\tconst fresh = firstSub(sub);\n\t\t\t\t\t\tif (fresh !== undefined && nextSubOf(fresh) !== undefined) {\n\t\t\t\t\t\t\tshallowPropagate(fresh);\n\t\t\t\t\t\t}\n\t\t\t\t\t\tif (!isLive(link)) return false;\n\t\t\t\t\t\tsub = subOf(link);\n"],
  [S, "\t\t\tif (!dirty) {\n\t\t\t\tconst nextDep = nextDepOf(link);\n", "\t\t\tif (!dirty) {\n\t\t\t\tconst nextDep = isLive(link) ? nextDepOf(link) : undefined;\n"],
  [S, "\t\t\t\tsub = subOf(link);\n\t\t\t\tconst nextDep = nextDepOf(link);\n", "\t\t\t\tif (!isLive(link)) return false;\n\t\t\t\tsub = subOf(link);\n\t\t\t\tconst nextDep = nextDepOf(link);\n"],
];
const FORWARD_PREV = [
  [B, "  if (isRetired(link)) accounting.retiredPredecessorReads++;\n\n  return previousDeps[link.slot];", `  if (isRetired(link)) {
    accounting.retiredPredecessorReads++;

    return previousDeps[link.slot];
  }
  let before: Link | undefined;

  for (let e: Link | null = store.first("left", store.left(link)); e !== null && !same(e, link); e = store.next("left", e)) {
    accounting.ablationWork++;
    before = e;
  }
  return before;`],
];
const WIDE_EPOCH = [
  [I, "function computedOper<T>(this: ComputedNode<T>): T {\n", "function computedOper<T>(this: ComputedNode<T>): T {\n\tenterEpoch();\n\ttry {\n\t\treturn computedBody.call(this) as T;\n\t} finally {\n\t\texitEpoch();\n\t}\n}\n\nfunction computedBody<T>(this: ComputedNode<T>): T {\n"],
  [I, "function effectScopeOper(this: EffectScopeNode): void {\n", "function effectScopeOper(this: EffectScopeNode): void {\n\tenterEpoch();\n\ttry {\n\t\teffectScopeBody.call(this);\n\t} finally {\n\t\texitEpoch();\n\t}\n}\n\nfunction effectScopeBody(this: EffectScopeNode): void {\n"],
];
const RAW_FROZEN = [
  [B, "  const next = optional(store.next(\"left\", link));\n\n  accounting.forwardLeftSteps++;", "  const next = isRetired(link) ? frozen.get(link.slot)?.left : optional(store.next(\"left\", link));\n\n  accounting.forwardLeftSteps++;"],
  [B, "  const next = optional(store.next(\"right\", link));\n\n  accounting.forwardRightSteps++;", "  const next = isRetired(link) ? frozen.get(link.slot)?.right : optional(store.next(\"right\", link));\n\n  accounting.forwardRightSteps++;"],
];
const INSERT_BEFORE_CREATE = "\t\tsub.depsTail\n\t\t\t= dep.subsTail\n\t\t\t= createLink(";
const stamp = (bits) => [[S, "function link(dep: ReactiveNode, sub: ReactiveNode, version: number): void {\n", `function link(dep: ReactiveNode, sub: ReactiveNode, version: number): void {\n\t\tversion &= ${(1 << bits) - 1};\n`]];

const MUTANTS = [
  ["port", "control: the unmodified port through this harness", []],
  ["R0", "no epochs", [...NO_EPOCH]],
  ["R1", "no epochs; removing the link depsTail names moves depsTail back", [...NO_EPOCH, ...CURSOR_FIX]],
  ["R1-epoch", "epoch kept, the same depsTail fix, second-unlink tolerance removed", [...CURSOR_FIX, ...NO_TOLERANCE]],
  ["R2", "no epochs; full snapshot of held chains before update", [...NO_EPOCH, ...SNAPSHOT]],
  ["R3", "no epochs; re-read the live graph after update", [...NO_EPOCH, ...RESEEK]],
  ["R4a", "R1 and R2 together", [...NO_EPOCH, ...CURSOR_FIX, ...SNAPSHOT]],
  ["R4b", "R1 and R3 together", [...NO_EPOCH, ...CURSOR_FIX, ...RESEEK]],
  ["prev-none", "reverse walks see no predecessor", [[B, "  accounting.reverseWalkSteps++;\n\n  return snapshotPrevDep(link);", "  accounting.reverseWalkSteps++;\n\n  return undefined;"]]],
  ["prev-forward", "no predecessor state: reverse walks collect forward; unlink finds the predecessor by walking", [
    ...FORWARD_PREV,
    [B, "export function versionOf(link: Link): number {", `export function collectReverse(sub: any): Link[] {
  const tail: Link | undefined = sub.depsTail;

  if (tail === undefined) return [];

  if (store.status(tail) !== "live") return [tail];

  const out: Link[] = [];

  for (let e: Link | null = store.first("left", idOf(sub)); e !== null; e = store.next("left", e)) {
    accounting.ablationWork++;
    out.push(e);

    if (same(e, tail)) break;
  }
  return out.reverse();
}

export function versionOf(link: Link): number {`],
    [I, IMPORT_I, "import { collectReverse, depOf, enterEpoch, exitEpoch, firstDep, firstSub, nextDepOf, ownerOf } from './backend';"],
    [I, /let link = (\w+)\.depsTail;\n\s*while \(link !== undefined\) \{\n\s*const prev = prevDepOf\(link\);/g, "for (const link of collectReverse($1)) {", 3],
    [I, /\n\s*link = prev;/g, "", 3],
  ]],
  ["prevsub-forward", "no right predecessor state: unlink finds it by walking the right axis", [
    [B, "  if (isRetired(link)) accounting.retiredPredecessorReads++;\n\n  return previousSubs[link.slot];", `  if (isRetired(link)) {
    accounting.retiredPredecessorReads++;

    return previousSubs[link.slot];
  }
  let before: Link | undefined;

  for (let e: Link | null = store.first("right", store.right(link)); e !== null && !same(e, link); e = store.next("right", e)) {
    accounting.ablationWork++;
    before = e;
  }
  return before;`],
  ]],
  ["multi-forbid", "a duplicate pair is simply not created", [
    [B, "export function versionOf(link: Link): number {", `export function pairExists(dep: any, sub: any): boolean {
  for (let e = store.first("left", idOf(sub)); e !== null; e = store.next("left", e)) {
    accounting.ablationWork++;

    if (store.right(e).slot === idOf(dep).slot) return true;
  }
  return false;
}

export function versionOf(link: Link): number {`],
    [S, "\tcreateLink,\n\tcrossing,\n", "\tcreateLink,\n\tcrossing,\n\tpairExists,\n"],
    [S, INSERT_BEFORE_CREATE, "\t\tif (pairExists(dep, sub)) {\n\t\t\treturn;\n\t\t}\n" + INSERT_BEFORE_CREATE],
  ]],
  ["multi-reuse", "unique pair: an existing relation is reused and, if unread, moved to the cursor", [
    [B, "export function versionOf(link: Link): number {", `export function reusePair(dep: any, sub: any, prevDep: Link | undefined, nextDep: Link | undefined, version: number): boolean {
  let unread = sub.depsTail === undefined;

  for (let e = store.first("left", idOf(sub)); e !== null; e = store.next("left", e)) {
    accounting.ablationWork++;

    if (store.right(e).slot === idOf(dep).slot) {
      if (unread) {
        const before = previousDeps[e.slot];
        const after = optional(store.next("left", e));

        if (after !== undefined) previousDeps[after.slot] = before;

        store.moveAfter("left", e, prevDep ?? null);
        previousDeps[e.slot] = prevDep;

        if (nextDep !== undefined) previousDeps[nextDep.slot] = e;

        versions[e.slot] = version;
        sub.depsTail = e;
      }
      return true;
    }
    if (!unread && same(e, sub.depsTail)) unread = true;
  }
  return false;
}

export function versionOf(link: Link): number {`],
    [S, "\tcreateLink,\n\tcrossing,\n", "\tcreateLink,\n\tcrossing,\n\treusePair,\n"],
    [S, INSERT_BEFORE_CREATE, "\t\tif (reusePair(dep, sub, prevDep, nextDep, version)) {\n\t\t\treturn;\n\t\t}\n" + INSERT_BEFORE_CREATE],
  ]],
  ["right-reverse-propagate", "propagate walks the right axis tail to head; topology untouched", [
    [S, "\t\tlet next = nextSubOf(link);\n\t\tlet stack: Stack<Link | undefined> | undefined;\n", "\t\tlink = depOf(link).subsTail!;\n\t\tlet next = prevSubOf(link);\n\t\tlet stack: Stack<Link | undefined> | undefined;\n"],
    [S, "const nextSub = nextSubOf(link = subSubs);", "const nextSub = prevSubOf(link = sub.subsTail!);"],
    [S, "\t\t\t\tnext = nextSubOf(link);\n\t\t\t\tcontinue;\n", "\t\t\t\tnext = prevSubOf(link);\n\t\t\t\tcontinue;\n"],
    [S, "\t\t\t\t\tnext = nextSubOf(link);\n\t\t\t\t\tcontinue top;\n", "\t\t\t\t\tnext = prevSubOf(link);\n\t\t\t\t\tcontinue top;\n"],
  ]],
  ["right-reverse-all", "propagate and shallowPropagate both walk tail to head", [
    [S, "\t\tlet next = nextSubOf(link);\n\t\tlet stack: Stack<Link | undefined> | undefined;\n", "\t\tlink = depOf(link).subsTail!;\n\t\tlet next = prevSubOf(link);\n\t\tlet stack: Stack<Link | undefined> | undefined;\n"],
    [S, "const nextSub = nextSubOf(link = subSubs);", "const nextSub = prevSubOf(link = sub.subsTail!);"],
    [S, "\t\t\t\tnext = nextSubOf(link);\n\t\t\t\tcontinue;\n", "\t\t\t\tnext = prevSubOf(link);\n\t\t\t\tcontinue;\n"],
    [S, "\t\t\t\t\tnext = nextSubOf(link);\n\t\t\t\t\tcontinue top;\n", "\t\t\t\t\tnext = prevSubOf(link);\n\t\t\t\t\tcontinue top;\n"],
    [S, "function shallowPropagate(link: Link): void {\n\t\tdo {\n", "function shallowPropagate(link: Link): void {\n\t\tlink = depOf(link).subsTail!;\n\t\tdo {\n"],
    [S, "} while ((link = nextSubOf(link)!) !== undefined);", "} while ((link = prevSubOf(link)!) !== undefined);"],
  ]],
  ["version-1bit", "stamp keeps 1 bit", [...stamp(1)]],
  ["version-2bit", "stamp keeps 2 bits", [...stamp(2)]],
  ["wide-epoch-chase", "search only: epochs on every public entry, L0 clause 8", [...WIDE_EPOCH]],
  ["wide-epoch-raw", "search only: epochs on every public entry, raw frozen successor", [...WIDE_EPOCH, ...RAW_FROZEN]],
];

const edits = (id) => MUTANTS.find((m) => m[0] === id)[2];
const WIDE_FIX = [...WIDE_EPOCH, ...CURSOR_FIX];
const BIAXIAL = [
  [B, "export function versionOf(link: Link): number {", `export function reuseBiaxial(dep: any, sub: any, prevDep: Link | undefined, nextDep: Link | undefined, version: number): boolean {
  for (let e = store.first("left", idOf(sub)); e !== null; e = store.next("left", e)) {
    accounting.ablationWork++;

    if (store.right(e).slot !== idOf(dep).slot) continue;

    const beforeLeft = previousDeps[e.slot];
    const afterLeft = optional(store.next("left", e));

    if (afterLeft !== undefined) previousDeps[afterLeft.slot] = beforeLeft;

    store.moveAfter("left", e, prevDep ?? null);
    previousDeps[e.slot] = prevDep;

    if (nextDep !== undefined) previousDeps[nextDep.slot] = e;

    const tail: Link = dep.subsTail;

    if (!same(e, tail)) {
      const beforeRight = previousSubs[e.slot];
      const afterRight = optional(store.next("right", e));

      if (afterRight !== undefined) previousSubs[afterRight.slot] = beforeRight;

      store.moveAfter("right", e, tail);
      previousSubs[e.slot] = tail;
      dep.subsTail = e;
    }
    versions[e.slot] = version;
    sub.depsTail = e;

    return true;
  }
  return false;
}

export function versionOf(link: Link): number {`],
  [S, "\tcreateLink,\n\tcrossing,\n", "\tcreateLink,\n\tcrossing,\n\treuseBiaxial,\n"],
  [S, INSERT_BEFORE_CREATE, "\t\tif (reuseBiaxial(dep, sub, prevDep, nextDep, version)) {\n\t\t\treturn;\n\t\t}\n" + INSERT_BEFORE_CREATE],
];
const BIAXIAL_UNREAD = [
  [B, "export function versionOf(link: Link): number {", `export function reuseBiaxialUnread(dep: any, sub: any, prevDep: Link | undefined, nextDep: Link | undefined, version: number): boolean {
  let unread = sub.depsTail === undefined;

  for (let e = store.first("left", idOf(sub)); e !== null; e = store.next("left", e)) {
    accounting.ablationWork++;

    if (store.right(e).slot !== idOf(dep).slot) {
      if (!unread && same(e, sub.depsTail)) unread = true;

      continue;
    }
    if (!unread) return true;

    const beforeLeft = previousDeps[e.slot];
    const afterLeft = optional(store.next("left", e));

    if (afterLeft !== undefined) previousDeps[afterLeft.slot] = beforeLeft;

    store.moveAfter("left", e, prevDep ?? null);
    previousDeps[e.slot] = prevDep;

    if (nextDep !== undefined) previousDeps[nextDep.slot] = e;

    const tail: Link = dep.subsTail;

    if (!same(e, tail)) {
      const beforeRight = previousSubs[e.slot];
      const afterRight = optional(store.next("right", e));

      if (afterRight !== undefined) previousSubs[afterRight.slot] = beforeRight;

      store.moveAfter("right", e, tail);
      previousSubs[e.slot] = tail;
      dep.subsTail = e;
    }
    versions[e.slot] = version;
    sub.depsTail = e;

    return true;
  }
  return false;
}

export function versionOf(link: Link): number {`],
  [S, "\tcreateLink,\n\tcrossing,\n", "\tcreateLink,\n\tcrossing,\n\treuseBiaxialUnread,\n"],
  [S, INSERT_BEFORE_CREATE, "\t\tif (reuseBiaxialUnread(dep, sub, prevDep, nextDep, version)) {\n\t\t\treturn;\n\t\t}\n" + INSERT_BEFORE_CREATE],
];
const LEFT_REVERSE = [
  [S, "\t\tlet stack: Stack<Link> | undefined;\n\t\tlet checkDepth = 0;\n", "\t\tlink = sub.depsTail ?? link;\n\t\tlet stack: Stack<Link> | undefined;\n\t\tlet checkDepth = 0;\n"],
  [S, "link = firstDep(dep)!;", "link = dep.depsTail!;"],
  [S, "\t\t\tif (!dirty) {\n\t\t\t\tconst nextDep = nextDepOf(link);\n", "\t\t\tif (!dirty) {\n\t\t\t\tconst nextDep = snapshotPrevDep(link);\n"],
  [S, "\t\t\t\tsub = subOf(link);\n\t\t\t\tconst nextDep = nextDepOf(link);\n", "\t\t\t\tsub = subOf(link);\n\t\t\t\tconst nextDep = snapshotPrevDep(link);\n"],
];
const RETIREMENT_LOG = [
  ...SNAPSHOT.filter((edit) => edit[1] !== "  accounting.updateCrossings++;\n"),
  [B, "  store.unlink(link);\n\n  if (nextDep !== undefined) previousDeps", "  accounting.ablationWork++;\n  snaps.set(snapKey(link), { dep: bound[store.right(link).slot], sub: bound[store.left(link).slot], nextDep, nextSub });\n  store.unlink(link);\n\n  if (nextDep !== undefined) previousDeps"],
];
for (const [id, changes, list] of [
  ["multi-reuse-biaxial", "unique pair: an existing relation moves to the left cursor and the right tail", BIAXIAL],
  ["left-reverse-validate", "checkDirty validates dependencies last to first; representation untouched", LEFT_REVERSE],
  ["multi-reuse-unread", "unique pair: an unread relation moves to the cursor and the right tail; a repeat in the read prefix stays", BIAXIAL_UNREAD],
  ["multi-reuse-unread-w", "search only: wide-fix, unread relation moved on both axes, repeats stay", [...WIDE_FIX, ...BIAXIAL_UNREAD]],
  ["multi-reuse-biaxial-w", "search only: wide-fix, unique pair moved on both axes", [...WIDE_FIX, ...BIAXIAL]],
  ["left-reverse-validate-w", "search only: wide-fix, reverse validation order", [...WIDE_FIX, ...LEFT_REVERSE]],
  ["R5", "no store epochs; the client logs each removed link until its outermost public call ends", [...WIDE_EPOCH, ...NO_EPOCH, ...CURSOR_FIX, ...RETIREMENT_LOG]],
  ["wide-fix", "search only: reference, epochs on every public entry plus the depsTail fix", WIDE_FIX],
  ["wide-fix-raw", "search only: wide-fix with the raw frozen successor", [...WIDE_FIX, ...RAW_FROZEN]],
  ["version-1bit-w", "search only: wide-fix with a 1-bit stamp", [...WIDE_FIX, ...stamp(1)]],
  ["version-2bit-w", "search only: wide-fix with a 2-bit stamp", [...WIDE_FIX, ...stamp(2)]],
  ["multi-forbid-w", "search only: wide-fix, duplicate pair not created", [...WIDE_FIX, ...edits("multi-forbid")]],
  ["multi-reuse-w", "search only: wide-fix, unique pair with reuse", [...WIDE_FIX, ...edits("multi-reuse")]],
  ["prev-forward-w", "search only: wide-fix, no left predecessor state", [...WIDE_FIX, ...edits("prev-forward")]],
  ["prevsub-forward-w", "search only: wide-fix, no right predecessor state", [...WIDE_FIX, ...edits("prevsub-forward")]],
]) MUTANTS.push([id, changes, list]);

/** Variant to the reference it is searched against; null is frozen Alien. */
const SEARCH = new Map([
  ["port", null],
  ["wide-epoch-chase", null],
  ["wide-fix", null],
  ["wide-fix-raw", "wide-fix"],
  ["R4a", "wide-fix"],
  ["R4b", "wide-fix"],
  ["R5", "wide-fix"],
  ["version-1bit-w", "wide-fix"],
  ["version-2bit-w", "wide-fix"],
  ["multi-forbid-w", "wide-fix"],
  ["multi-reuse-w", "wide-fix"],
  ["multi-reuse-biaxial-w", "wide-fix"],
  ["multi-reuse-unread-w", "wide-fix"],
  ["left-reverse-validate-w", "wide-fix"],
  ["prev-forward-w", "wide-fix"],
  ["prevsub-forward-w", "wide-fix"],
]);
const CORPUS_SKIP = new Set(MUTANTS.filter((m) => m[1].startsWith("search only")).map((m) => m[0]));

function prepare(id, edits) {
  const dir = path.join(root, ".cache/m2.5", id);
  mkdirSync(dir, { recursive: true });
  for (const part of ["adapters", "reference"]) {
    cpSync(path.join(root, part), path.join(dir, part), { recursive: true, force: true });
  }
  const portRoot = path.join(dir, "adapters/alien");
  for (const [file, find, replace, count] of edits) {
    const target = path.join(portRoot, file);
    const text = readFileSync(target, "utf8");
    const found = typeof find === "string" ? text.split(find).length - 1 : (text.match(find) ?? []).length;
    if (found !== (count ?? 1)) throw new Error(`${id}: ${found} matches in ${file}: ${find}`);
    writeFileSync(target, typeof find === "string" ? text.replace(find, () => replace) : text.replace(find, replace));
  }
  return { dir, portRoot };
}

function corpus(id, { dir, portRoot }) {
  const output = path.join(dir, "result.json");
  writeFileSync(output, "");
  spawnSync(`npx vitest run --config adapters/alien/vitest.config.ts --reporter=json --outputFile="${output}"`, {
    cwd: root,
    env: { ...process.env, ALIEN_PORT: "1", ALIEN_PORT_ROOT: portRoot },
    shell: true,
    stdio: "ignore",
    timeout: 240_000,
  });
  const raw = readFileSync(output, "utf8");
  if (raw === "") return { hang: true, failures: [], total: 0, work: 0 };
  const failures = [];
  let total = 0;
  for (const file of JSON.parse(raw).testResults) {
    for (const test of file.assertionResults) {
      total++;
      if (test.status === "failed") {
        failures.push({ title: test.fullName, message: (test.failureMessages[0] ?? "").split("\n")[0].replace(/\u001b\[[0-9;]*m/g, "").slice(0, 130) });
      }
    }
  }
  let work = 0;
  const accountingDir = path.join(dir, ".cache/alien-accounting");
  if (existsSync(accountingDir)) {
    for (const f of ["conformance", "effect", "effectScope", "trigger"]) {
      const p = path.join(accountingDir, `${f}.spec.ts.json`);
      if (existsSync(p)) work += JSON.parse(readFileSync(p, "utf8")).ablationWork ?? 0;
    }
  }
  return { failures, total, work };
}

function search(id, { dir, portRoot }, referenceId) {
  const output = path.join(dir, "search.json");
  writeFileSync(output, "");
  const reference = referenceId === null ? {} : { SEARCH_REFERENCE_ROOT: path.join(root, ".cache/m2.5", referenceId, "adapters/alien") };
  spawnSync("npx vitest run --config adapters/alien/search/vitest.config.ts --reporter=dot", {
    cwd: root,
    env: { ...process.env, ALIEN_PORT_ROOT: portRoot, SEARCH_OUTPUT: output, ...reference },
    shell: true,
    stdio: "ignore",
    timeout: 280_000,
  });
  const raw = readFileSync(output, "utf8");
  return raw === "" ? { error: "no result" } : JSON.parse(raw);
}

const only = process.argv.slice(2);
const results = [];
const prepared = new Map();
for (const [id, , list] of MUTANTS) prepared.set(id, prepare(id, list));
for (const [id, changes] of MUTANTS) {
  if (only.length > 0 && !only.includes(id)) continue;
  const r = { id, changes };
  if (!CORPUS_SKIP.has(id)) Object.assign(r, corpus(id, prepared.get(id)));
  if (SEARCH.has(id)) {
    r.reference = SEARCH.get(id) ?? "frozen";
    r.search = search(id, prepared.get(id), SEARCH.get(id));
  }
  results.push(r);
  console.log(`${id}: ${r.hang ? "HANG" : CORPUS_SKIP.has(id) ? "search only" : `${r.total - r.failures.length} of ${r.total}, work ${r.work}`}${r.search ? `; search ${r.search.divergent ?? r.search.error} of ${r.search.programs ?? "?"} (retired next ${r.search.retiredNext}, differing from frozen ${r.search.retiredNextDivergentFromFrozen})` : ""}`);
}
writeFileSync(path.join(root, ".cache/m2.5/results.json"), JSON.stringify(results, null, 2));

if (only.length === 0) {
  const lines = [
    "# M2.5 ablations",
    "",
    "Generated by `npm run alien:ablate`. Do not edit.",
    "",
    "Subject: the port of `alien-signals@8734d38`. `work` is extra structure visits a variant adds over the corpus. Alien declares no structural bounds, so cost is measured and never counted as a failure.",
    "",
    "| Variant | Change | Corpus | Failing tests | Work |",
    "| --- | --- | ---: | --- | ---: |",
  ];
  for (const r of results) {
    if (CORPUS_SKIP.has(r.id)) continue;
    const names = r.failures.map((f) => f.title.split(" > ").at(-1).split(" ")[0]).join(", ");
    lines.push(`| ${r.id} | ${r.changes} | ${r.hang ? "hang" : `${r.total - r.failures.length} of ${r.total}`} | ${names || "none"} | ${r.work ?? 0} |`);
  }
  lines.push("", "## Public-API search", "", "Random programs with impure computeds, compared on the full log of runs, values and errors against the named reference. `wide-fix` has epochs on every public entry and the depsTail fix. A shrunk witness is listed when any program differs. Retired-next counts show whether the search reached that behaviour at all.", "", "| Variant | Reference | Programs | Divergent | Retired next reads | Differing from frozen | Shrunk witness |", "| --- | --- | ---: | ---: | ---: | ---: | --- |");
  for (const r of results) {
    if (!r.search) continue;
    lines.push(`| ${r.id} | ${r.reference} | ${r.search.programs ?? "?"} | ${r.search.divergent ?? r.search.error} | ${r.search.retiredNext ?? "-"} | ${r.search.retiredNextDivergentFromFrozen ?? "-"} | ${r.search.witness ? `\`${JSON.stringify(r.search.witness)}\`` : "none"} |`);
  }
  lines.push("", "## Failures", "");
  for (const r of results) {
    if (!r.failures?.length) continue;
    lines.push(`### ${r.id}`, "", "| Test | First line |", "| --- | --- |");
    for (const f of r.failures) lines.push(`| ${f.title.replaceAll("|", "\\|")} | ${f.message.replaceAll("|", "\\|")} |`);
    lines.push("");
  }
  writeFileSync(path.join(root, "research/M2.5-ABLATIONS.md"), lines.join("\n"));
}
