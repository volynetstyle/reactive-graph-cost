// Verifies the frozen polyfill and proposal checkouts in .cache, cloning them if
// absent, and that the port is still exactly its derivation.
//
//   node adapters/polyfill/sync-corpus.mjs
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const cache = path.resolve(here, "../../.cache");
const PINS = [
  ["signal-polyfill-fba09f8", "https://github.com/proposal-signals/signal-polyfill.git", "fba09f8e225f52a9d082bc755e37098c29440bf9"],
  ["proposal-signals-9124ed9", "https://github.com/tc39/proposal-signals.git", "9124ed91b24bb02ff7408b2fcf5abb6e18b095d7"],
];

for (const [dir, url, commit] of PINS) {
  const target = path.join(cache, dir);
  const git = (...args) => execFileSync("git", ["-C", target, ...args], { encoding: "utf8" }).trim();
  if (!existsSync(target)) {
    execFileSync("git", ["clone", "--quiet", url, target]);
    git("checkout", "--quiet", commit);
  }
  if (git("rev-parse", "HEAD") !== commit) throw new Error(`${dir} is not at ${commit}`);
  if (git("status", "--porcelain") !== "") throw new Error(`${dir} has local changes`);
}
execFileSync(process.execPath, [path.join(here, "derive.mjs"), "--check"], { stdio: "inherit" });
console.log("corpus at fba09f8, proposal at 9124ed9");
