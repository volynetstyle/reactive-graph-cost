// Runs the polyfill's frozen corpus. POLYFILL_PORT=1 redirects its src/ to the port.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { defineConfig, type Plugin } from "vitest/config";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../.cache/signal-polyfill-fba09f8");
const slashes = (p: string): string => p.split("\\").join("/");
const srcDir = slashes(resolve(root, "src"));
const portRoot = process.env["POLYFILL_PORT_ROOT"] ?? here;
const portDir = resolve(portRoot, "src");
const port = process.env["POLYFILL_PORT"] === "1";

const redirect: Plugin = {
  name: "polyfill-port-src",
  enforce: "pre",
  async resolveId(source, importer, options) {
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (resolved === null) return null;
    const id = slashes(resolved.id);
    return id.startsWith(srcDir + "/") ? resolve(portDir, id.slice(srcDir.length + 1)) : null;
  },
};

// wrapper.ts assigns `export let` members of a namespace from static blocks. The
// default transpiler here does not carry that assignment through, so Signal.isState
// is undefined on the original as well. Both sides are compiled with TypeScript.
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
  plugins: port ? [namespaces, redirect] : [namespaces],
  test: {
    name: port ? "polyfill-on-l0" : "polyfill-fba09f8",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: port ? [resolve(portRoot, "accounting-report.ts")] : [],
    pool: "forks",
    testTimeout: 120_000,
  },
});
