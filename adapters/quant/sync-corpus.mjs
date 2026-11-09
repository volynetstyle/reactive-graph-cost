// Copies Quant's sources and test corpus at the frozen revision into .cache, so
// the corpus runs unchanged and quant-main stays untouched.
//
//   node adapters/quant/sync-corpus.mjs
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const REVISION = "241a3b7";
const here = import.meta.dirname;
const quant = path.resolve(here, "../../../quant-main");
const target = path.resolve(here, `../../.cache/quant-${REVISION}`);
const git = (...args) => execFileSync("git", ["-C", quant, ...args], { encoding: "utf8" }).trim();

const head = git("rev-parse", "--short=7", "HEAD");
if (head !== REVISION) throw new Error(`quant-main is at ${head}, expected ${REVISION}`);
const dirty = git("status", "--porcelain", "--", "src", "test", "bin");
if (dirty !== "") throw new Error(`quant-main has local changes:\n${dirty}`);

if (existsSync(target)) rmSync(target, { recursive: true });
for (const dir of ["src", "test", "bin"]) {
  cpSync(path.join(quant, dir), path.join(target, dir), { recursive: true });
}

const verbatim = ["flags.ts", "globals.d.ts", "host.ts", "index.ts", "instrumentation.ts", "types.ts"];
for (const file of verbatim) {
  const original = readFileSync(path.join(quant, "src", file), "utf8");
  if (original !== readFileSync(path.join(here, "src", file), "utf8")) {
    throw new Error(`adapters/quant/src/${file} is meant to be a verbatim copy`);
  }
}
cpSync(path.join(here, "probes"), path.join(target, "test"), { recursive: true });
console.log(`corpus at ${REVISION} in ${path.relative(process.cwd(), target)}`);
