// Every passage the manuscript quotes must appear verbatim in its pinned source.
//   node paper/tools/check-quotes.mjs
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const norm = (s) => s.replace(/\s+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
const SOURCES = {
  proposal: ".cache/proposal-signals-9124ed9/README.md",
  salsa: ".cache/salsa-6d59529/src/function/maybe_changed_after.rs",
  wpf: ".cache/wpf-49ae5cd/src/WindowsBase/System/Windows/WeakEventManager.cs",
  ecma: ".cache/paper/web/ecma262.txt",
  issue259: ".cache/paper/web/issue259-comments.json",
  vue16176: ".cache/paper/web/vue16176.json",
  vue10397: ".cache/paper/web/vue10397.json",
  mokhov: ".cache/paper/pdf/mokhov2020.txt",
};
const load = (name) => {
  let text = readFileSync(path.join(root, SOURCES[name]), "utf8");
  if (name === "salsa") text = text.replace(/\n\s*\/\/ ?/g, " ");
  if (name === "wpf") text = text.replace(/\n\s+/g, " ");
  if (name === "issue259") text = JSON.parse(text).map((c) => c.body).join("\n");
  if (name.startsWith("vue")) text = JSON.parse(text).body;
  return norm(text);
};
const quotes = JSON.parse(readFileSync(path.join(root, "paper/quotes.json"), "utf8"));
const tex = readFileSync(path.join(root, "paper/main.tex"), "utf8");
const cache = {};
let failed = 0;
for (const { source, text } of quotes) {
  cache[source] ??= load(source);
  if (!cache[source].includes(norm(text))) {
    failed++;
    console.log(`NOT IN ${source}: ${text}`);
  }
  const inTex = norm(tex.replace(/\n/g, " ").replace(/``|''/g, '"').replace(/\\_/g, "_").replace(/---/g, "--"));
  if (!inTex.includes(norm(text).replace(/---/g, "--"))) {
    failed++;
    console.log(`NOT QUOTED IN main.tex: ${text}`);
  }
}
console.log(`${quotes.length} quotations, ${failed} problems`);
process.exitCode = failed === 0 ? 0 : 1;
