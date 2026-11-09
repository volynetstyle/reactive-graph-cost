// Verifies the frozen Alien checkout in .cache, cloning it if absent, and that
// the port is still exactly its derivation.
//
//   node adapters/alien/sync-corpus.mjs
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const COMMIT = "8734d386d925025d0e99419bd9161c17b112c5ee";
const here = import.meta.dirname;
const target = path.resolve(here, "../../.cache/alien-8734d38");
const git = (...args) => execFileSync("git", ["-C", target, ...args], { encoding: "utf8" }).trim();

if (!existsSync(target)) {
  execFileSync("git", ["clone", "--quiet", "https://github.com/stackblitz/alien-signals.git", target]);
  git("checkout", "--quiet", COMMIT);
}
if (git("rev-parse", "HEAD") !== COMMIT) throw new Error(`checkout is not at ${COMMIT}`);
if (git("status", "--porcelain") !== "") throw new Error("frozen checkout has local changes");

execFileSync(process.execPath, [path.join(here, "derive.mjs"), "--check"], { stdio: "inherit" });
console.log(`corpus at ${COMMIT.slice(0, 7)}`);
