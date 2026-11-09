// Runs Quant's unchanged corpus. QUANT_PORT=1 redirects every import of its
// src/ to the port, using the same mechanism as Quant's own config.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../.cache/quant-241a3b7");
const slashes = (p: string): string => p.split("\\").join("/");
const srcDir = slashes(resolve(root, "src"));
const portRoot = process.env["QUANT_PORT_ROOT"] ?? here;
const portDir = resolve(portRoot, "src");
const port = process.env["QUANT_PORT"] === "1";

const redirect: Plugin = {
  name: "quant-port-src",
  enforce: "pre",
  async resolveId(source, importer, options) {
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (resolved === null) return null;
    const id = slashes(resolved.id);
    return id.startsWith(srcDir + "/") ? resolve(portDir, id.slice(srcDir.length + 1)) : null;
  },
};

export default defineConfig({
  root,
  plugins: port ? [redirect] : [],
  resolve: { alias: { "@runtime": resolve(root, "bin/reflex-runtime/src") } },
  define: {
    __DEV__: false,
    __PROFILE__: false,
    __TRACKING_ONE_HOP__: true,
    __TRACKING_TWO_HOP__: true,
    __TRACKING_LAST_EDGE__: true,
    __TEST__: true,
    __PROD__: false,
    __STATS__: "true",
  },
  esbuild: { platform: "node", format: "esm", target: "es2022" } as never,
  test: {
    name: port ? "quant-on-l0" : "quant-241a3b7",
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/tools/**"],
    setupFiles: port ? [resolve(portRoot, "views.ts"), resolve(portRoot, "accounting-report.ts")] : [],
    pool: "forks",
    testTimeout: 300_000,
  },
});
