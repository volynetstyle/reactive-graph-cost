// Test-only setup file: writes each corpus file's accounting to .cache.
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect } from "vitest";
import { accounting } from "./src/accounting";
import { externalSizes } from "./src/backend";

const out = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../.cache/polyfill-accounting");

afterAll(() => {
  const file = basename(expect.getState().testPath ?? `pid-${process.pid}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, `${file}.json`), JSON.stringify({ file, ...accounting, ...externalSizes() }));
});
