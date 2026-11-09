// Test-only setup file: writes each corpus file's accounting to .cache and names
// the tests that touched a retired Link.
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, expect } from "vitest";
import { accounting } from "./src/accounting";
import { externalSizes } from "./src/backend";

const out = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../.cache/alien-accounting");
const RETIRED = [
  "retiredNextDep",
  "retiredNextSub",
  "retiredEndpointReads",
  "retiredPredecessorReads",
  "secondUnlinks",
  "heldLinksRetiredByUpdate",
  "savedNextRetiredByUnwatched",
] as const;
const touching: { name: string; counts: Record<string, number> }[] = [];
let before: Record<string, number> = {};

beforeEach(() => {
  before = Object.fromEntries(RETIRED.map((key) => [key, accounting[key]]));
});

afterEach(() => {
  const counts: Record<string, number> = {};
  for (const key of RETIRED) {
    const delta = accounting[key] - (before[key] as number);
    if (delta !== 0) counts[key] = delta;
  }
  if (Object.keys(counts).length > 0) touching.push({ name: expect.getState().currentTestName ?? "?", counts });
});

afterAll(() => {
  const file = basename(expect.getState().testPath ?? `pid-${process.pid}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, `${file}.json`), JSON.stringify({ file, ...accounting, ...externalSizes(), touching }));
});
