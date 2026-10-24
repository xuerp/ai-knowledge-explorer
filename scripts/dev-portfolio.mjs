import { spawn } from "node:child_process";

// Set both browser and SSR upstreams: never inherit a staging endpoint.
const child = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "8085", "--strictPort"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_API_BASE_URL: "http://127.0.0.1:8004",
      VITE_API_UPSTREAM_URL: "http://127.0.0.1:8004",
      VITE_PORTFOLIO_REAL_DATA: "true",
    },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
