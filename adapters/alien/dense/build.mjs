// Bundles the frozen Alien source and the dense build through one toolchain into .cache/m6/build,
// plus a counted dense build that tallies slot -> node resolutions.
//   node adapters/alien/dense/build.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const out = path.join(root, ".cache/m6/build");
const denseSrc = path.join(out, "dense-src");
mkdirSync(denseSrc, { recursive: true });
execFileSync(process.execPath, [path.join(import.meta.dirname, "derive.mjs"), denseSrc], { stdio: "ignore" });
copyFileSync(path.join(import.meta.dirname, "system.ts"), path.join(denseSrc, "system.ts"));
const rolldown = path.join(root, "node_modules/rolldown/bin/cli.mjs");
const bundle = (name, src) => {
  const entry = path.join(out, `${name}-entry.ts`);
  const p = (f) => path.join(src, f).replaceAll("\\", "/");
  writeFileSync(entry, `export * from "${p("index.ts")}";\nexport * from "${p("system.ts")}";\n`);
  execFileSync(process.execPath, [rolldown, entry, "--format", "esm", "--file", path.join(out, `${name}.mjs`)], { stdio: "ignore" });
};
bundle("frozen", path.join(root, ".cache/alien-8734d38/src"));
bundle("dense", denseSrc);
const dense = readFileSync(path.join(out, "dense.mjs"), "utf8");
const counted = dense.replaceAll("nodes[L[", "(globalThis.__resolves++, nodes)[L[");
if (counted === dense) throw new Error("no resolutions found to count");
writeFileSync(path.join(out, "dense-counted.mjs"), counted);
console.log("built frozen, dense, dense-counted");
