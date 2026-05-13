import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { encryptAndWrite, deleteEncrypted } from '@/lib/files';
import { DomainError } from '@/lib/services/errors';

const MAX_IMAGE_DIMENSION = 1600;
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_PER_DEVICE = 5;
export const MAX_UPLOAD_BYTES_PER_USER = 100 * 1024 * 1024; // 100 MB

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

async function userUploadBytes(userId: string): Promise<number> {
  const rows = await prisma.attachment.findMany({
    where: { device: { userId } },
    select: { fileSize: true },
  });
  return rows.reduce((sum, r) => sum + (r.fileSize ?? 0), 0);
}

export type UploadAttachmentInput = {
  deviceId: string;
  fileName: string;
  fileType: string;
  buffer: Buffer;
  description?: string | null;
};

export async function uploadAttachment(userId: string, input: UploadAttachmentInput) {
  const safe = safeId(input.deviceId);
  if (!safe) throw new DomainError('BAD_INPUT', 'Device không hợp lệ');
  if (input.buffer.length === 0) throw new DomainError('BAD_INPUT', 'File trống');
  if (input.buffer.length > MAX_BYTES) throw new DomainError('BAD_INPUT', 'File vượt quá 5MB');

  const rule = ALLOWED[input.fileType];
  if (!rule) {
    throw new DomainError('BAD_INPUT', 'Chỉ chấp nhận JPG/PNG/WEBP/GIF hoặc PDF');
  }
  if (!rule.sig(input.buffer)) {
    throw new DomainError('BAD_INPUT', 'Nội dung file không khớp định dạng khai báo');
  }

  let buffer = input.buffer;
  if (
    input.fileType === 'image/jpeg' ||
    input.fileType === 'image/png' ||
    input.fileType === 'image/webp'
  ) {
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
          input.fileType === 'image/png'
            ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
            : input.fileType === 'image/webp'
              ? await pipeline.webp({ quality: 85 }).toBuffer()
              : await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
        buffer = Buffer.from(encoded);
      }
    } catch {
      throw new DomainError('BAD_INPUT', 'Không xử lý được ảnh, file có thể đã hỏng');
    }
  }

  const device = await prisma.device.findFirst({
    where: { id: safe, userId },
    include: { _count: { select: { attachments: true } } },
  });
  if (!device) throw new DomainError('NOT_FOUND', 'Thiết bị không tồn tại');
  if (device._count.attachments >= MAX_PER_DEVICE) {
    throw new DomainError('LIMIT_REACHED', 'Tối đa 5 file/thiết bị');
  }

  const used = await userUploadBytes(userId);
  if (used + buffer.length > MAX_UPLOAD_BYTES_PER_USER) {
    const mb = Math.round(MAX_UPLOAD_BYTES_PER_USER / 1024 / 1024);
    throw new DomainError('LIMIT_REACHED', `Dung lượng tổng vượt quá ${mb}MB. Xoá bớt file cũ.`);
  }

  let encResult;
  try {
    encResult = await encryptAndWrite(buffer, safe, randomUUID());
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Lỗi mã hoá file';
    throw new DomainError('BAD_INPUT', msg);
  }

  return prisma.attachment.create({
    data: {
      deviceId: safe,
      fileName: input.fileName,
      storagePath: encResult.storagePath,
      fileType: input.fileType,
      fileSize: encResult.plaintextBytes,
      iv: new Uint8Array(encResult.iv),
      wrappedKey: new Uint8Array(encResult.wrappedKey),
      description: input.description?.trim() || null,
    },
  });
}

export async function deleteAttachment(userId: string, id: string) {
  const att = await prisma.attachment.findUnique({
    where: { id },
    include: { device: { select: { userId: true } } },
  });
  if (!att || att.device.userId !== userId) {
    throw new DomainError('NOT_FOUND', 'Không tìm thấy file');
  }
  await deleteEncrypted(att.storagePath);
  await prisma.attachment.delete({ where: { id } });
  return { deviceId: att.deviceId };
}
