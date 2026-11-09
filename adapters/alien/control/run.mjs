// M4.5 control: corpus and public-API search with the flat client backend.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const dir = path.join(root, ".cache/m4.5/alien-flat");
mkdirSync(dir, { recursive: true });
for (const part of ["adapters", "reference"]) cpSync(path.join(root, part), path.join(dir, part), { recursive: true, force: true });
const portRoot = path.join(dir, "adapters/alien");
copyFileSync(path.join(portRoot, "control/backend-flat.ts"), path.join(portRoot, "src/backend.ts"));

const corpus = path.join(dir, "corpus.json");
writeFileSync(corpus, "");
spawnSync(`npx vitest run --config adapters/alien/vitest.config.ts --reporter=json --outputFile="${corpus}"`, {
  cwd: root,
  env: { ...process.env, ALIEN_PORT: "1", ALIEN_PORT_ROOT: portRoot },
  shell: true,
  stdio: "ignore",
  timeout: 300000,
});
let total = 0;
const failed = [];
for (const file of JSON.parse(readFileSync(corpus, "utf8")).testResults) {
  for (const test of file.assertionResults) {
    total++;
    if (test.status === "failed") failed.push(`${test.fullName}: ${(test.failureMessages[0] ?? "").split("\n")[0].slice(0, 120)}`);
  }
}
console.log(`corpus ${total - failed.length} of ${total}`);
for (const f of failed.slice(0, 10)) console.log(" ", f);

for (const reference of [null, "wide-fix"]) {
  const output = path.join(dir, `search-${reference ?? "frozen"}.json`);
  writeFileSync(output, "");
  const env = { ...process.env, ALIEN_PORT_ROOT: portRoot, SEARCH_OUTPUT: output };
  if (reference !== null) env.SEARCH_REFERENCE_ROOT = path.join(root, ".cache/m2.5", reference, "adapters/alien");
  spawnSync("npx vitest run --config adapters/alien/search/vitest.config.ts --reporter=dot", { cwd: root, env, shell: true, stdio: "ignore", timeout: 300000 });
  const raw = readFileSync(output, "utf8");
  if (raw === "") {
    console.log(`search vs ${reference ?? "frozen"}: no result`);
    continue;
  }
  const r = JSON.parse(raw);
  console.log(`search vs ${reference ?? "frozen"}: ${JSON.stringify({ ...r, witness: undefined, logs: undefined }).slice(0, 300)}`);
  if (r.witness !== undefined) console.log(`  witness ${JSON.stringify(r.witness).slice(0, 500)}`);
}
