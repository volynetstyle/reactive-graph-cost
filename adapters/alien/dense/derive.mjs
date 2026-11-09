// Derives the dense build's index.ts from the frozen Alien source by exact replacements, so that
// it differs from the original only where a link is touched. Stops on any replacement that does
// not apply. Writes to the directory given.
//   node adapters/alien/dense/derive.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
let s = readFileSync(path.join(root, ".cache/alien-8734d38/src/index.ts"), "utf8").replace(/\r\n/g, "\n");
const out = process.argv[2];

function swap(from, to, count = 1) {
  const n = s.split(from).length - 1;
  if (n !== count) throw new Error(`expected ${count}, found ${n}: ${from}`);
  s = s.replaceAll(from, () => to);
}

swap("import { createReactiveSystem, ReactiveFlags, type ReactiveNode } from './system.js';", "import { createReactiveSystem, ReactiveFlags, NIL, depOf, subOf, nextDepOf, prevDepOf, enter, leave, reclaim, type ReactiveNode } from './system.js';");

// Nodes: integer fields in place of link references, plus the node's own slot.
s = s.replace(/^(\s*)subs: undefined,\n\s*subsTail: undefined,\n/gm, "$1subs: NIL,\n$1subsTail: NIL,\n$1slot: NIL,\n$1refs: 0,\n");
s = s.replace(/^(\s*)deps: undefined,\n\s*depsTail: undefined,\n/gm, "$1deps: NIL,\n$1depsTail: NIL,\n");
swap("\t\tdeps: NIL,\n\t\tdepsTail: NIL,\n\t\tflags: ReactiveFlags.Watching,\n\t};", "\t\tdeps: NIL,\n\t\tdepsTail: NIL,\n\t\tslot: NIL,\n\t\trefs: 0,\n\t\tflags: ReactiveFlags.Watching,\n\t};");

// Reading links.
swap("effect = effect.subs?.sub as EffectNode;", "effect = (effect.subs ? subOf(effect.subs) : undefined) as EffectNode;");
swap("if (node.depsTail !== undefined) {", "if (node.depsTail !== NIL) {");
swap("let link = sub.deps;\n\t\twhile (link !== undefined) {\n\t\t\tconst dep = link.dep;", "let link = sub.deps!;\n\t\twhile (link !== NIL) {\n\t\t\tconst dep = depOf(link);");
swap("const subs = dep.subs;\n\t\t\tif (subs !== undefined) {", "const subs = dep.subs;\n\t\t\tif (subs !== NIL) {");
swap("let link = c.depsTail;\n\t\twhile (link !== undefined) {\n\t\t\tconst prev = link.prevDep;\n\t\t\tconst dep = link.dep;", "let link = c.depsTail!;\n\t\twhile (link !== NIL) {\n\t\t\tconst prev = prevDepOf(link);\n\t\t\tconst dep = depOf(link);");
swap("let link = e.depsTail;\n\t\t\twhile (link !== undefined) {\n\t\t\t\tconst prev = link.prevDep;\n\t\t\t\tconst dep = link.dep;", "let link = e.depsTail!;\n\t\t\twhile (link !== NIL) {\n\t\t\t\tconst prev = prevDepOf(link);\n\t\t\t\tconst dep = depOf(link);");
swap("c.depsTail = undefined;", "c.depsTail = NIL;");
swap("e.depsTail = undefined;", "e.depsTail = NIL;");
swap("} else if (e.deps !== undefined) {", "} else if (e.deps !== NIL) {");
swap("const subs = this.subs;\n\t\t\tif (subs !== undefined) {", "const subs = this.subs;\n\t\t\tif (subs !== NIL) {", 2);
swap("const subs = this.subs;\n\t\t\t\tif (subs !== undefined) {", "const subs = this.subs;\n\t\t\t\tif (subs !== NIL) {");
swap("const sub = this.subs;\n\tif (sub !== undefined) {\n\t\tunlink(sub);", "const sub = this.subs!;\n\tif (sub !== NIL) {\n\t\tunlink(sub);");
swap("let link = sub.depsTail;\n\twhile (link !== undefined) {\n\t\tconst prev = link.prevDep;\n\t\tunlink(link, sub);\n\t\tlink = prev;\n\t}", "let link = sub.depsTail!;\n\tenter();\n\ttry {\n\t\twhile (link !== NIL) {\n\t\t\tconst prev = prevDepOf(link);\n\t\t\tunlink(link, sub);\n\t\t\tlink = prev;\n\t\t}\n\t} finally {\n\t\tleave();\n\t}");
swap("let dep = depsTail !== undefined ? depsTail.nextDep : sub.deps;\n\twhile (dep !== undefined) {", "let dep = depsTail !== NIL ? nextDepOf(depsTail!) : sub.deps!;\n\twhile (dep !== NIL) {");

// User code runs inside these try blocks: no slot may be reclaimed meanwhile.
const tries = s.split("try {").length - 1;
s = s.replace(/^(\s*)try \{\n(?!\s*while \(link !== NIL\) \{\n\s*const prev = prevDepOf\(link\);\n\s*unlink\(link, sub\))/gm, "$1enter();\n$1try {\n");
s = s.replace(/^(\s*)\} finally \{\n(?!\s*leave\(\);)/gm, "$1} finally {\n$1\tleave();\n");
if (tries !== 9) throw new Error(`expected 9 try blocks, found ${tries}`);

// Quiescent points: the ends of the public operations.
swap("\treturn this.value!;\n}", "\treclaim();\n\treturn this.value!;\n}");
swap("\t\treturn this.currentValue;\n\t}\n}", "\t\treturn this.currentValue;\n\t}\n\treclaim();\n}");
swap("\treturn effectOper.bind(e);", "\treclaim();\n\treturn effectOper.bind(e);");
swap("\treturn effectScopeOper.bind(e);", "\treclaim();\n\treturn effectScopeOper.bind(e);");
swap("\tif (!--batchDepth) {\n\t\tflush();\n\t}\n}", "\tif (!--batchDepth) {\n\t\tflush();\n\t}\n\treclaim();\n}");
swap("\tif (this.cleanup) {\n\t\trunCleanup(this);\n\t}\n}", "\tif (this.cleanup) {\n\t\trunCleanup(this);\n\t}\n\treclaim();\n}");
swap("\t\tif (!batchDepth) {\n\t\t\tflush();\n\t\t}\n\t}\n}", "\t\tif (!batchDepth) {\n\t\t\tflush();\n\t\t}\n\t}\n\treclaim();\n}");

if (/\.(prevDep|nextDep|prevSub|nextSub|dep|sub)\b(?!s)/.test(s.replace(/\/\/.*$/gm, ""))) throw new Error("a link field is still read directly");
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "index.ts"), s);
console.log("derived index.ts");
