import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { readAndDecrypt } from '@/lib/files';

// GET /api/files/<attachmentId>
//
// Auth-gated, ownership-checked, decrypts the on-disk blob and streams it.
// Returns 404 (not 403) on any miss to avoid leaking which attachment ids exist.
//
// ?download=1 forces Content-Disposition: attachment with the original filename.
// Otherwise the file is rendered inline (so <img src> / PDF preview works).
//
// Cache headers prevent shared caches from storing user content.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 404 });

  const { id } = await params;
  if (!/^[a-z0-9_-]+$/i.test(id)) {
    return new NextResponse(null, { status: 404 });
  }

  const att = await prisma.attachment.findUnique({
    where: { id },
    include: { device: { select: { userId: true } } },
  });
  if (!att || att.device.userId !== user.id) {
    return new NextResponse(null, { status: 404 });
  }

  let plaintext: Buffer;
  try {
    plaintext = await readAndDecrypt(
      att.storagePath,
      Buffer.from(att.iv),
      Buffer.from(att.wrappedKey),
    );
  } catch {
    // Either file missing on disk, key mismatch, or auth-tag fail.
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(req.url);
  const forceDownload = url.searchParams.get('download') === '1';

  const headers = new Headers({
    'Content-Type': att.fileType,
    'Content-Length': String(plaintext.length),
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    // Belt-and-braces: even though this isn't under /uploads anymore, sandbox
    // any embedded content so a malicious PDF/SVG can't run scripts.
    'Content-Security-Policy': "default-src 'none'; sandbox; img-src 'self' data:",
  });
  if (forceDownload) {
    const safeName = att.fileName.replace(/[^\w.\- ]/g, '_');
    headers.set('Content-Disposition', `attachment; filename="${safeName}"`);
  } else {
    headers.set('Content-Disposition', 'inline');
  }

  // Wrap the decrypted bytes in a copy-free ArrayBuffer slice so Response accepts it.
  const ab = plaintext.buffer.slice(
    plaintext.byteOffset,
    plaintext.byteOffset + plaintext.byteLength,
  ) as ArrayBuffer;
  return new NextResponse(ab, { status: 200, headers });
}
