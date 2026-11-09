// M5.0: writes operation tapes from the real corpora into .cache/m5/tapes.
//   node adapters/m5/extract.mjs
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, ".cache/m5/tapes");
mkdirSync(out, { recursive: true });

function graphTape(client, envName, rootName) {
  const dir = path.join(root, ".cache/m5", client);
  mkdirSync(dir, { recursive: true });
  for (const part of ["adapters", "reference"]) cpSync(path.join(root, part), path.join(dir, part), { recursive: true, force: true });
  const portRoot = path.join(dir, "adapters", client);
  const backend = path.join(portRoot, "src/backend.ts");
  let text = readFileSync(backend, "utf8");
  text = text.replace("const store = new RelationMachine();", 'import { TapeMachine } from "../../../reference/experimental/tape-machine.ts";\nvoid RelationMachine;\nconst store = new TapeMachine();');
  writeFileSync(backend, text);
  const base = path.join(dir, "raw");
  for (const f of readdirSync(dir)) if (f.startsWith("raw.") && f.endsWith(".tape")) writeFileSync(path.join(dir, f), "");
  const { status } = spawnSync(`npx vitest run --config adapters/${client}/vitest.config.ts --reporter=dot`, {
    cwd: root,
    env: { ...process.env, [envName]: "1", [rootName]: portRoot, M5_TAPE: base, M5_FLUSH: client === "quant" ? "50000" : "1" },
    shell: true,
    stdio: "ignore",
    timeout: 400000,
  });
  const file = path.join(out, `${client}.tape`);
  writeFileSync(file, "");
  let lines = 0;
  for (const f of readdirSync(dir)) {
    if (!f.startsWith("raw.") || !f.endsWith(".tape")) continue;
    const content = readFileSync(path.join(dir, f), "utf8");
    if (content.length === 0) continue;
    appendFileSync(file, content);
    lines += content.split("\n").length - 1;
  }
  console.log(`${client}: exit ${status}, ${lines} operations`);
}

graphTape("alien", "ALIEN_PORT", "ALIEN_PORT_ROOT");
graphTape("quant", "QUANT_PORT", "QUANT_PORT_ROOT");
graphTape("polyfill", "POLYFILL_PORT", "POLYFILL_PORT_ROOT");

const url = (p) => pathToFileURL(path.join(root, p)).href;
const salsa = await import(url("adapters/salsa/src/engine.ts"));
const salsaLines = [];
salsa.hooks.emit = (line) => salsaLines.push(line);
for (const corpus of ["generated", "holdout", "fresh", "shapes"]) {
  for (const program of JSON.parse(readFileSync(path.join(root, `.cache/salsa-oracle/${corpus}-programs.json`), "utf8"))) {
    salsaLines.push(`P ${program.cells + program.queries.length}`);
    salsa.execute(program, "b1");
  }
}
writeFileSync(path.join(out, "salsa.tape"), `${salsaLines.join("\n")}\n`);
console.log(`salsa: ${salsaLines.length} operations`);

const wpf = await import(url("adapters/wpf/src/interpreter.ts"));
const s1 = await import(url("adapters/wpf/src/manager-s1.ts"));
const wpfLines = [];
s1.hooks.emit = (line) => wpfLines.push(line);
for (const corpus of ["generated-programs", "holdout-programs"]) {
  for (const program of JSON.parse(readFileSync(path.join(root, `.cache/wpf-oracle/${corpus}.json`), "utf8"))) {
    wpfLines.push("P");
    wpf.execute(program, "s1");
  }
}
writeFileSync(path.join(out, "wpf.tape"), `${wpfLines.join("\n")}\n`);
console.log(`wpf: ${wpfLines.length} operations`);
