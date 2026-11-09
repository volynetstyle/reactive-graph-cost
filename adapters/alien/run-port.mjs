// Runs Alien's frozen corpus against the port.
//
//   npm run alien:port
import { spawnSync } from "node:child_process";

const { status } = spawnSync("npx vitest run --config adapters/alien/vitest.config.ts", {
  env: { ...process.env, ALIEN_PORT: "1" },
  shell: true,
  stdio: "inherit",
});
process.exit(status ?? 1);
