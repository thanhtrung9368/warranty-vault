import path from 'node:path';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Encrypted private storage for user attachments.
//
// Layout: <PRIVATE_UPLOADS>/<deviceId>/<uuid>.enc
//   The .enc blob is AES-256-GCM ciphertext of the original file bytes.
//
// Per-file random `dataKey` is wrapped (AES-256-GCM) with FILE_MASTER_KEY
// (env var, ≥32 bytes after base64-decode). The wrapped key + iv are stored
// in the Attachment row in the DB. Disk on its own, or DB on its own, can't
// decrypt — both are needed.
//
// FILE_MASTER_KEY rotation: re-wrap every Attachment.wrappedKey with the new
// master key (no need to re-encrypt the blobs). Simple loop over all rows.
// ─────────────────────────────────────────────────────────────────────────────

export const PRIVATE_UPLOAD_ROOT = process.env.PRIVATE_UPLOAD_ROOT
  ? path.resolve(process.env.PRIVATE_UPLOAD_ROOT)
  : path.join(process.cwd(), 'private-uploads');

const KEY_LEN = 32; // 256-bit
const IV_LEN = 12;  // GCM standard

let cachedMasterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  const raw = process.env.FILE_MASTER_KEY;
  if (!raw) {
    throw new Error(
      'FILE_MASTER_KEY chưa được cấu hình. Sinh bằng `node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"` rồi đặt vào .env',
    );
  }
  // Accept base64 (preferred) or hex. Must decode to ≥32 bytes.
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
    if (buf.length < KEY_LEN) {
      const hex = Buffer.from(raw, 'hex');
      if (hex.length >= KEY_LEN) buf = hex;
    }
  } catch {
    throw new Error('FILE_MASTER_KEY không decode được (cần base64 hoặc hex 32 byte)');
  }
  if (buf.length < KEY_LEN) {
    throw new Error('FILE_MASTER_KEY phải ≥ 32 byte sau khi decode');
  }
  cachedMasterKey = buf.subarray(0, KEY_LEN);
  return cachedMasterKey;
}

function encryptGcm(plaintext: Buffer, key: Buffer): { iv: Buffer; ciphertext: Buffer } {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Standard layout: ciphertext || authTag(16). Decrypt splits on the tail.
  return { iv, ciphertext: Buffer.concat([enc, tag]) };
}

function decryptGcm(ciphertextWithTag: Buffer, key: Buffer, iv: Buffer): Buffer {
  if (ciphertextWithTag.length < 16) throw new Error('Ciphertext too short');
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const ct = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export type EncryptResult = {
  storagePath: string; // relative to PRIVATE_UPLOAD_ROOT, e.g. "<deviceId>/<uuid>.enc"
  iv: Buffer;
  wrappedKey: Buffer;
  encryptedBytes: number;
  plaintextBytes: number;
};

function safeSegment(s: string): boolean {
  return /^[a-z0-9_-]+$/i.test(s);
}

function resolveSafe(rel: string): string {
  // Resolve against root and ensure no traversal escape.
  const abs = path.resolve(PRIVATE_UPLOAD_ROOT, rel);
  const root = path.resolve(PRIVATE_UPLOAD_ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('Path escape detected');
  }
  return abs;
}

export async function encryptAndWrite(
  plaintext: Buffer,
  deviceId: string,
  fileNameNoExt: string,
): Promise<EncryptResult> {
  if (!safeSegment(deviceId)) throw new Error('Invalid deviceId segment');
  if (!safeSegment(fileNameNoExt)) throw new Error('Invalid filename segment');

  const master = getMasterKey();
  // Per-file random data key.
  const dataKey = randomBytes(KEY_LEN);
  const { iv: dataIv, ciphertext } = encryptGcm(plaintext, dataKey);

  // Wrap dataKey with master key (separate iv).
  const { iv: wrapIv, ciphertext: wrappedCt } = encryptGcm(dataKey, master);
  // wrappedKey layout: wrapIv(12) || wrappedCt(KEY_LEN+16). Single Bytes column.
  const wrappedKey = Buffer.concat([wrapIv, wrappedCt]);

  const rel = path.join(deviceId, `${fileNameNoExt}.enc`);
  const abs = resolveSafe(rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, ciphertext);

  return {
    storagePath: rel,
    iv: dataIv,
    wrappedKey,
    encryptedBytes: ciphertext.length,
    plaintextBytes: plaintext.length,
  };
}

export async function readAndDecrypt(
  storagePath: string,
  iv: Buffer,
  wrappedKey: Buffer,
): Promise<Buffer> {
  const abs = resolveSafe(storagePath);
  const ciphertext = await readFile(abs);
  const master = getMasterKey();
  // Unwrap dataKey first.
  if (wrappedKey.length < IV_LEN + 16) throw new Error('wrappedKey malformed');
  const wrapIv = wrappedKey.subarray(0, IV_LEN);
  const wrappedCt = wrappedKey.subarray(IV_LEN);
  const dataKey = decryptGcm(wrappedCt, master, wrapIv);
  return decryptGcm(ciphertext, dataKey, iv);
}

export async function deleteEncrypted(storagePath: string): Promise<void> {
  try {
    const abs = resolveSafe(storagePath);
    await unlink(abs);
  } catch {
    // file already missing — ignore
  }
}
