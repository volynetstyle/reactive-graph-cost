// Runs Alien's frozen corpus. ALIEN_PORT=1 redirects its src/ to the port.
// build.spec.ts is excluded: it only checks the built cjs and esm files.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../.cache/alien-8734d38");
const slashes = (p: string): string => p.split("\\").join("/");
const srcDir = slashes(resolve(root, "src"));
const portRoot = process.env["ALIEN_PORT_ROOT"] ?? here;
const portDir = resolve(portRoot, "src");
const port = process.env["ALIEN_PORT"] === "1";

const redirect: Plugin = {
  name: "alien-port-src",
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
  test: {
    name: port ? "alien-on-l0" : "alien-8734d38",
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    exclude: ["tests/build.spec.ts"],
    setupFiles: port ? [resolve(portRoot, "accounting-report.ts")] : [],
    pool: "forks",
    testTimeout: 120_000,
  },
});
