import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

export default defineConfig({
  root,
  test: {
    environment: "node",
    include: ["adapters/alien/search/fuzz.test.ts"],
    pool: "forks",
    testTimeout: 270_000,
  },
});
