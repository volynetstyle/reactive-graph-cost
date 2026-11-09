// M4A.4 and M4A.5: runs the port on the oracle's programs and compares logs with the CLR's.
//   WPF_VARIANT=s0|s1 node adapters/wpf/compare.ts programs.json oracle.json [second-oracle-run.json]
// Purge visits sources in hash order, which the CLR does not fix, so a run of consecutive
// unsubscribe lines is compared as a set.
import { readFileSync } from "node:fs";
import { accounting, resetAccounting } from "./src/accounting.ts";
import { execute, type ProgramSpec, type Variant } from "./src/interpreter.ts";

const variant = (process.env["WPF_VARIANT"] ?? "s0") as Variant;

interface OracleResult {
  name: string;
  log: string[];
}

const [programsPath, oraclePath, secondPath] = process.argv.slice(2) as [string, string, string | undefined];

function canonical(log: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < log.length; ) {
    if (!log[i]!.startsWith("unsubscribe:")) {
      out.push(log[i]!);
      i++;
      continue;
    }
    const run: string[] = [];
    while (i < log.length && log[i]!.startsWith("unsubscribe:")) run.push(log[i++]!);
    out.push(...run.sort());
  }
  return out.join("\n");
}

const load = (file: string): OracleResult[] => (JSON.parse(readFileSync(file, "utf8")) as { results: OracleResult[] }).results;
const programs = JSON.parse(readFileSync(programsPath, "utf8")) as ProgramSpec[];
const oracle = load(oraclePath);
const second = secondPath === undefined ? undefined : load(secondPath);

resetAccounting();
let same = 0;
let unstable = 0;
let orderOnly = 0;
const differing: { program: ProgramSpec; oracle: string[]; port: string[] }[] = [];

programs.forEach((program, i) => {
  const expected = oracle[i]!.log;
  if (second !== undefined && canonical(second[i]!.log) !== canonical(expected)) {
    unstable++;
    return;
  }
  if (second !== undefined && second[i]!.log.join("\n") !== expected.join("\n")) orderOnly++;
  let actual: string[];
  try {
    actual = execute(program, variant);
  } catch (e) {
    actual = [`threw ${(e as Error).message}`];
  }
  if (canonical(actual) === canonical(expected)) same++;
  else differing.push({ program, oracle: expected, port: actual });
});

console.log(`programs ${programs.length}, same ${same}, differ ${differing.length}, unstable oracle ${unstable}, oracle reordered only ${orderOnly}`);
console.log(JSON.stringify(accounting));

const smallest = differing.sort((a, b) => a.program.ops.length + (a.program.rules?.length ?? 0) - b.program.ops.length - (b.program.rules?.length ?? 0)).slice(0, 3);
for (const d of smallest) {
  console.log(`\n${d.program.name}\n${JSON.stringify({ rules: d.program.rules, ops: d.program.ops })}`);
  const at = d.oracle.findIndex((line, i) => line !== d.port[i]);
  console.log(`first difference at ${at}\n oracle: ${d.oracle.slice(Math.max(0, at - 2), at + 3).join(" ; ")}\n port:   ${d.port.slice(Math.max(0, at - 2), at + 3).join(" ; ")}`);
}
process.exitCode = differing.length === 0 ? 0 : 1;
