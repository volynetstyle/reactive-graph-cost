// Runs Quant's unchanged corpus against the port.
//
//   npm run quant:port
import { spawnSync } from "node:child_process";

const { status } = spawnSync("npx vitest run --config adapters/quant/vitest.config.ts", {
  env: { ...process.env, QUANT_PORT: "1" },
  shell: true,
  stdio: "inherit",
});
process.exit(status ?? 1);
