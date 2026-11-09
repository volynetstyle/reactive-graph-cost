// M6 correctness gates: Alien's corpus and the 4,000-program search, with the dense build in place
// of the port's sources.
//   node adapters/alien/dense/check.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const dir = path.join(root, ".cache/m6/check");
mkdirSync(dir, { recursive: true });
for (const part of ["adapters", "reference"]) cpSync(path.join(root, part), path.join(dir, part), { recursive: true, force: true });
const portRoot = path.join(dir, "adapters/alien");
execFileSync(process.execPath, [path.join(root, "adapters/alien/dense/derive.mjs"), path.join(portRoot, "src")], { stdio: "inherit" });
copyFileSync(path.join(portRoot, "dense/system.ts"), path.join(portRoot, "src/system.ts"));

const corpus = path.join(dir, "corpus.json");
writeFileSync(corpus, "");
spawnSync(`npx vitest run --config adapters/alien/vitest.config.ts --reporter=json --outputFile="${corpus}"`, { cwd: root, env: { ...process.env, ALIEN_PORT: "1", ALIEN_PORT_ROOT: portRoot }, shell: true, stdio: "ignore", timeout: 300000 });
let total = 0;
const failed = [];
for (const file of JSON.parse(readFileSync(corpus, "utf8")).testResults) {
  for (const test of file.assertionResults) {
    total++;
    if (test.status === "failed") failed.push(`${test.fullName}: ${(test.failureMessages[0] ?? "").split("\n")[0].slice(0, 140)}`);
  }
}
const search = path.join(dir, "search.json");
writeFileSync(search, "");
spawnSync("npx vitest run --config adapters/alien/search/vitest.config.ts --reporter=dot", { cwd: root, env: { ...process.env, ALIEN_PORT_ROOT: portRoot, SEARCH_OUTPUT: search }, shell: true, stdio: "ignore", timeout: 300000 });
const raw = readFileSync(search, "utf8");
const result = { corpus: { passed: total - failed.length, total }, search: raw === "" ? null : JSON.parse(raw) };
writeFileSync(path.join(root, ".cache/m6/check.json"), JSON.stringify(result, null, 1));
console.log(`corpus ${total - failed.length} of ${total}`);
for (const f of failed.slice(0, 12)) console.log(" ", f);
console.log("search", JSON.stringify({ ...result.search, logs: undefined }).slice(0, 900));
