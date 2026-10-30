import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const allowed = new Set(["VITE_API_BASE_URL", "VITE_API_UPSTREAM_URL"]);

export function validatePublicEnvironment(content) {
  const found = new Set();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match || !allowed.has(match[1])) {
      throw new Error(
        "Tracked staging configuration may contain only the two public API URL keys.",
      );
    }
    if (found.has(match[1])) throw new Error("Duplicate public environment key.");
    found.add(match[1]);
    const url = new URL(match[2].trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error(
        "Public API URLs must use HTTPS without credentials, query strings or fragments.",
      );
    }
  }
  if (found.size !== allowed.size) throw new Error("Both public API URL keys are required.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validatePublicEnvironment(await readFile(new URL("../.env.staging", import.meta.url), "utf8"));
  console.log("Tracked staging configuration contains only public HTTPS API URLs.");
}
