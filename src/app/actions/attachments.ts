'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { rateLimitUserWrite, formatRetry } from '@/lib/rate-limit';
import { encryptAndWrite, deleteEncrypted } from '@/lib/files';

const MAX_IMAGE_DIMENSION = 1600;

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PER_DEVICE = 5;
const MAX_UPLOAD_BYTES_PER_USER = 100 * 1024 * 1024; // 100 MB

// Whitelist: only MIMEs we can confirm via magic-bytes. SVG/HTML/JS never allowed.
const ALLOWED: Record<string, { ext: string; sig: (b: Buffer) => boolean }> = {
  'image/jpeg': {
    ext: '.jpg',
    sig: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  'image/png': {
    ext: '.png',
    sig: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  'image/webp': {
    ext: '.webp',
    sig: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  'image/gif': {
    ext: '.gif',
    sig: (b) =>
      b.length >= 6 &&
      (b.subarray(0, 6).toString('ascii') === 'GIF87a' ||
        b.subarray(0, 6).toString('ascii') === 'GIF89a'),
  },
  'application/pdf': {
    ext: '.pdf',
    sig: (b) =>
      b.length >= 4 &&
      b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  },
};

function safeId(id: string) {
  return /^[a-z0-9_-]+$/i.test(id) ? id : null;
}

// Sum of plaintext bytes already stored for this user — fast (DB-only,
// no fs scan).
async function userUploadBytes(userId: string): Promise<number> {
  const rows = await prisma.attachment.findMany({
    where: { device: { userId } },
    select: { fileSize: true },
  });
  return rows.reduce((sum, r) => sum + (r.fileSize ?? 0), 0);
}

export async function uploadAttachment(formData: FormData) {
  const user = await requireUser();

  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const deviceId = String(formData.get('deviceId') ?? '');
  const description = formData.get('description');
  const file = formData.get('file');
  const safe = safeId(deviceId);
  if (!safe) return { ok: false, message: 'Device không hợp lệ' };
  if (!(file instanceof File)) return { ok: false, message: 'Thiếu file' };
  if (file.size === 0) return { ok: false, message: 'File trống' };
  if (file.size > MAX_BYTES) return { ok: false, message: 'File vượt quá 5MB' };

  const rule = ALLOWED[file.type];
  if (!rule) {
    return { ok: false, message: 'Chỉ chấp nhận JPG/PNG/WEBP/GIF hoặc PDF' };
  }

  let buffer = Buffer.from(await file.arrayBuffer());
  if (!rule.sig(buffer)) {
    return { ok: false, message: 'Nội dung file không khớp định dạng khai báo' };
  }

  // Downscale large images. Skip GIF (animations) and PDF.
  if (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp') {
    try {
      const img = sharp(buffer, { failOn: 'error' }).rotate();
      const meta = await img.metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      if (w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION) {
        const pipeline = img.resize({
          width: MAX_IMAGE_DIMENSION,
          height: MAX_IMAGE_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        });
        const encoded =
          file.type === 'image/png'
            ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
            : file.type === 'image/webp'
            ? await pipeline.webp({ quality: 85 }).toBuffer()
            : await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
        buffer = Buffer.from(encoded);
      }
    } catch {
      return { ok: false, message: 'Không xử lý được ảnh, file có thể đã hỏng' };
    }
  }

  const device = await prisma.device.findFirst({
    where: { id: safe, userId: user.id },
    include: { _count: { select: { attachments: true } } },
  });
  if (!device) return { ok: false, message: 'Thiết bị không tồn tại' };
  if (device._count.attachments >= MAX_PER_DEVICE) {
    return { ok: false, message: 'Tối đa 5 file/thiết bị' };
  }

  const used = await userUploadBytes(user.id);
  if (used + buffer.length > MAX_UPLOAD_BYTES_PER_USER) {
    const mb = Math.round(MAX_UPLOAD_BYTES_PER_USER / 1024 / 1024);
    return { ok: false, message: `Dung lượng tổng vượt quá ${mb}MB. Xoá bớt file cũ.` };
  }

  // Encrypt + write to private-uploads. The DB row stores iv + wrappedKey;
  // disk has only the GCM ciphertext.
  let encResult;
  try {
    encResult = await encryptAndWrite(buffer, safe, randomUUID());
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Lỗi mã hoá file';
    return { ok: false, message: msg };
  }

  await prisma.attachment.create({
    data: {
      deviceId: safe,
      fileName: file.name,
      storagePath: encResult.storagePath,
      fileType: file.type,
      fileSize: encResult.plaintextBytes,
      iv: new Uint8Array(encResult.iv),
      wrappedKey: new Uint8Array(encResult.wrappedKey),
      description: typeof description === 'string' && description.trim() ? description.trim() : null,
    },
  });

  revalidatePath(`/devices/${safe}`);
  return { ok: true };
}

export async function deleteAttachment(id: string) {
  const user = await requireUser();

  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const att = await prisma.attachment.findUnique({
    where: { id },
    include: { device: { select: { userId: true } } },
  });
  if (!att || att.device.userId !== user.id) return { ok: false };

  await deleteEncrypted(att.storagePath);
  await prisma.attachment.delete({ where: { id } });
  revalidatePath(`/devices/${att.deviceId}`);
  return { ok: true };
}
