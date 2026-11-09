import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { defineConfig, type Plugin } from "vitest/config";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

const namespaces: Plugin = {
  name: "polyfill-namespace-semantics",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith("/wrapper.ts")) return null;
    const { outputText } = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, useDefineForClassFields: true },
    });
    return { code: outputText, map: null };
  },
};

export default defineConfig({
  root,
  plugins: [namespaces],
  test: {
    environment: "node",
    include: [process.env["SEARCH_INCLUDE"] ?? "adapters/polyfill/search/fuzz.test.ts"],
    pool: "forks",
    testTimeout: 280_000,
  },
});
