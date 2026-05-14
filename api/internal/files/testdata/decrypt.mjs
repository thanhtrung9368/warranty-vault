#!/usr/bin/env node
// Reverse-direction interop helper for the encrypted-attachment scheme.
//
// Mirrors website/src/lib/files.ts decryptGcm() + unwrap step. Reads a JSON
// bundle on STDIN with base64 fields (master, iv, wrappedKey, ciphertext) and
// writes the decrypted plaintext to STDOUT (base64-encoded).
//
// Used by:
//   1. Test case 3 in api/internal/files/interop_test.go — Go encrypts a
//      plaintext, dumps a bundle JSON via t.Logf, and a human runs:
//
//        cat /tmp/bundle.json | node api/internal/files/testdata/decrypt.mjs
//
//      …to verify TS can decrypt Go's output. Manual because we don't want
//      `go test` to depend on node every run; that's covered by the inline
//      TS-encrypt → Go-decrypt path inside encrypt_test.go.
//
// Scheme (must match website/src/lib/files.ts):
//   - AES-256-GCM, 12-byte IV, 16-byte tag suffixed to ciphertext.
//   - wrappedKey = wrapIV(12) || gcm(dataKey, masterKey, wrapIV).
import { createDecipheriv } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

function gcmOpen(ctWithTag, key, iv) {
  if (ctWithTag.length < TAG_LEN) {
    throw new Error("ciphertext shorter than tag");
  }
  const tag = ctWithTag.subarray(ctWithTag.length - TAG_LEN);
  const ct = ctWithTag.subarray(0, ctWithTag.length - TAG_LEN);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

const raw = await readStdin();
const bundle = JSON.parse(raw);
const master = Buffer.from(bundle.master_b64, "base64");
const iv = Buffer.from(bundle.iv_b64, "base64");
const wrappedKey = Buffer.from(bundle.wrappedKey_b64, "base64");
const ciphertext = Buffer.from(bundle.ciphertext_b64, "base64");

if (master.length < 32) throw new Error(`master too short: ${master.length}`);
if (iv.length !== IV_LEN) throw new Error(`iv must be ${IV_LEN} bytes`);
if (wrappedKey.length < IV_LEN + TAG_LEN) throw new Error("wrappedKey malformed");

const wrapIv = wrappedKey.subarray(0, IV_LEN);
const wrappedCt = wrappedKey.subarray(IV_LEN);
const dataKey = gcmOpen(wrappedCt, master.subarray(0, 32), wrapIv);
const plain = gcmOpen(ciphertext, dataKey, iv);

// Emit { plain_b64, plain_utf8 } so the human can eyeball either side.
process.stdout.write(
  JSON.stringify({
    plain_b64: plain.toString("base64"),
    plain_utf8: plain.toString("utf8"),
    bytes: plain.length,
  }) + "\n",
);
