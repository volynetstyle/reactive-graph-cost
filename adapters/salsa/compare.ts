// SALSA_VARIANT=b1 node adapters/salsa/compare.ts programs.json oracle.json [second.json]
import { readFileSync } from "node:fs";
import { counters, execute, resetCounters, type ProgramSpec, type Variant } from "./src/engine.ts";

const variant = (process.env["SALSA_VARIANT"] ?? "b1") as Variant;
const [programsPath, oraclePath, secondPath] = process.argv.slice(2) as [string, string, string | undefined];
const load = (f: string): { log: string[] }[] => JSON.parse(readFileSync(f, "utf8")).results;
const programs = JSON.parse(readFileSync(programsPath, "utf8")) as ProgramSpec[];
const oracle = load(oraclePath);
const second = secondPath === undefined ? undefined : load(secondPath);

resetCounters();
let same = 0;
let unstable = 0;
let valueDiffers = 0;
const differing: { program: ProgramSpec; oracle: string[]; port: string[] }[] = [];
programs.forEach((program, i) => {
  const expected = oracle[i]!.log;
  if (second !== undefined && second[i]!.log.join("\n") !== expected.join("\n")) {
    unstable++;
    return;
  }
  if (process.env["SALSA_EACH"] !== undefined) resetCounters();
  const actual = execute(program, variant);
  if (process.env["SALSA_EACH"] !== undefined) console.log(`${program.name}\t${variant}\t${actual.join("\n") === expected.join("\n") ? "same" : "DIFF"}\t${JSON.stringify(counters)}`);
  if (actual.join("\n") === expected.join("\n")) {
    same++;
    return;
  }
  const values = (l: string[]): string => l.filter((x) => x.startsWith("get:")).join("\n");
  if (values(actual) !== values(expected)) valueDiffers++;
  differing.push({ program, oracle: expected, port: actual });
});
console.log(`${variant}: programs ${programs.length}, same ${same}, differ ${differing.length}, of which values differ ${valueDiffers}, unstable ${unstable}`);
console.log(JSON.stringify(counters));
differing.sort((a, b) => a.oracle.length - b.oracle.length);
for (const d of differing.slice(0, 2)) {
  console.log(`\n${d.program.name} ${JSON.stringify({ queries: d.program.queries, ops: d.program.ops })}`);
  console.log(` oracle: ${d.oracle.join(" ; ")}\n port:   ${d.port.join(" ; ")}`);
}
