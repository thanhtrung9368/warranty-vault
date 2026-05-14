// Helper used by TestBcryptCompat_GoHashTsVerify. Loads bcrypt-ts from the
// repo's website/node_modules and verifies a (password, hash) pair.
//
// Usage: node verify.mjs <hash>
// Reads <password> from stdin (so unicode + empty passwords survive argv parsing).
// Exit code 0 = match, 1 = no match, 2 = bad invocation / internal error.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// testdata/ -> internal/auth/ -> internal/ -> api/ -> repo root -> website/node_modules/bcrypt-ts
const btsEntry = resolve(here, "../../../../website/node_modules/bcrypt-ts/dist/node.js");

let bts;
try {
  bts = await import(btsEntry);
} catch (e) {
  console.error("failed to load bcrypt-ts from", btsEntry, ":", e.message);
  process.exit(2);
}

const hash = process.argv[2];
if (typeof hash !== "string" || hash.length === 0) {
  console.error("usage: node verify.mjs <hash> (password on stdin)");
  process.exit(2);
}

const password = readFileSync(0, "utf8"); // exact bytes, no trim

try {
  const ok = await bts.compare(password, hash);
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error("compare threw:", e.message);
  process.exit(2);
}
