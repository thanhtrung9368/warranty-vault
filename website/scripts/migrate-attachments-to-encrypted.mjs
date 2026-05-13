// Migration: move existing attachments from public/uploads/<deviceId>/<file>
// (plaintext, publicly served) into private-uploads/<deviceId>/<uuid>.enc
// (AES-256-GCM encrypted, served only via /api/files/[id]).
//
// Run order:
//   1. node scripts/migrate-attachments-to-encrypted.mjs --backup
//      → reads current Attachment rows, encrypts files into private-uploads/,
//        writes prisma/_migrate-attachments.json with the new column values,
//        then deletes the Attachment rows so prisma db push won't fail.
//   2. npm run db:push
//   3. node scripts/migrate-attachments-to-encrypted.mjs --restore
//      → re-inserts rows with the new schema (storagePath, iv, wrappedKey, fileSize).
//        On success it removes prisma/_migrate-attachments.json + public/uploads/.
import 'dotenv/config';
import path from 'node:path';
import {
  readFile,
  writeFile,
  unlink,
  mkdir,
  rm,
  access,
} from 'node:fs/promises';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/warranty_vault_dev';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const PUBLIC_UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');
const PRIVATE_UPLOAD_ROOT = path.join(process.cwd(), 'private-uploads');
const TMP_FILE = path.join(process.cwd(), 'prisma', '_migrate-attachments.json');

const KEY_LEN = 32;
const IV_LEN = 12;

function getMasterKey() {
  const raw = process.env.FILE_MASTER_KEY;
  if (!raw) throw new Error('FILE_MASTER_KEY chưa set');
  let buf = Buffer.from(raw, 'base64');
  if (buf.length < KEY_LEN) buf = Buffer.from(raw, 'hex');
  if (buf.length < KEY_LEN) throw new Error('FILE_MASTER_KEY phải ≥ 32 byte');
  return buf.subarray(0, KEY_LEN);
}

function encryptGcm(plaintext, key) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, ciphertext: Buffer.concat([enc, tag]) };
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function backup() {
  const rows = await prisma.attachment.findMany({
    orderBy: { uploadedAt: 'asc' },
  });
  if (rows.length === 0) {
    console.log('Không có attachment nào để migrate.');
    await writeFile(TMP_FILE, JSON.stringify({ rows: [] }), 'utf8');
    return;
  }
  const master = getMasterKey();
  const out = [];
  for (const r of rows) {
    // Old path was stored as "/uploads/<deviceId>/<file>".
    const rel = r.filePath.replace(/^\/+/, '');
    const oldAbs = path.join(process.cwd(), 'public', rel);
    if (!(await fileExists(oldAbs))) {
      console.warn(`  bỏ qua ${r.id}: file không tồn tại trên đĩa (${oldAbs})`);
      continue;
    }
    const plaintext = await readFile(oldAbs);

    // Per-file random data key.
    const dataKey = randomBytes(KEY_LEN);
    const { iv: dataIv, ciphertext } = encryptGcm(plaintext, dataKey);
    const { iv: wrapIv, ciphertext: wrappedCt } = encryptGcm(dataKey, master);
    const wrappedKey = Buffer.concat([wrapIv, wrappedCt]);

    const newName = `${randomUUID()}.enc`;
    const newRel = path.join(r.deviceId, newName);
    const newAbs = path.join(PRIVATE_UPLOAD_ROOT, newRel);
    await mkdir(path.dirname(newAbs), { recursive: true });
    await writeFile(newAbs, ciphertext);

    out.push({
      id: r.id,
      deviceId: r.deviceId,
      fileName: r.fileName,
      fileType: r.fileType,
      description: r.description,
      uploadedAt: r.uploadedAt.toISOString(),
      storagePath: newRel,
      fileSize: plaintext.length,
      iv: dataIv.toString('base64'),
      wrappedKey: wrappedKey.toString('base64'),
      _oldPlaintextPath: oldAbs,
    });
    console.log(`  ✓ encrypted ${r.id} (${plaintext.length}b → ${ciphertext.length}b)`);
  }

  await writeFile(TMP_FILE, JSON.stringify({ rows: out }, null, 2), 'utf8');
  console.log(`Đã ghi ${out.length} dòng vào ${TMP_FILE}`);

  // Now delete the rows so the schema push won't blow up on NOT NULL columns
  // for rows that still have the old shape.
  const ids = out.map((r) => r.id);
  if (ids.length > 0) {
    await prisma.attachment.deleteMany({ where: { id: { in: ids } } });
    console.log(`Xoá ${ids.length} dòng Attachment cũ (dữ liệu đã backup vào JSON).`);
  }
  // Drop any remaining rows that pointed at missing files — they would crash
  // the restore step too.
  const remaining = await prisma.attachment.count();
  if (remaining > 0) {
    await prisma.attachment.deleteMany({});
    console.log(`Xoá thêm ${remaining} dòng orphan.`);
  }
}

async function restore() {
  const json = JSON.parse(await readFile(TMP_FILE, 'utf8'));
  const rows = json.rows ?? [];
  if (rows.length === 0) {
    console.log('JSON rỗng — không có gì restore.');
  } else {
    for (const r of rows) {
      await prisma.attachment.create({
        data: {
          id: r.id,
          deviceId: r.deviceId,
          fileName: r.fileName,
          fileType: r.fileType,
          fileSize: r.fileSize,
          description: r.description,
          uploadedAt: new Date(r.uploadedAt),
          storagePath: r.storagePath,
          iv: Buffer.from(r.iv, 'base64'),
          wrappedKey: Buffer.from(r.wrappedKey, 'base64'),
        },
      });
      console.log(`  ✓ restored ${r.id}`);
    }
  }
  // Cleanup: remove tmp JSON + old plaintext public uploads.
  await unlink(TMP_FILE).catch(() => void 0);
  for (const r of rows) {
    if (r._oldPlaintextPath) await unlink(r._oldPlaintextPath).catch(() => void 0);
  }
  // Optionally remove the entire public/uploads dir if empty/unneeded.
  await rm(PUBLIC_UPLOAD_ROOT, { recursive: true, force: true }).catch(() => void 0);
  console.log('Done. Đã xoá tmp JSON + public/uploads/.');
}

const mode = process.argv[2];
if (mode === '--backup') {
  await backup();
} else if (mode === '--restore') {
  await restore();
} else {
  console.error('Chạy với --backup hoặc --restore');
  process.exit(1);
}

await prisma.$disconnect();
