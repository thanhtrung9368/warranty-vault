import { requireApiUser } from '@/lib/auth';
import { rateLimitUserWrite } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { uploadAttachment } from '@/lib/services/attachments';
import { isDomainError, statusForCode } from '@/lib/services/errors';
import {
  apiBadInput,
  apiError,
  apiOk,
  apiRateLimited,
  apiUnauthorized,
} from '@/lib/api-response';

type Ctx = { params: Promise<{ id: string }> };

// GET — list attachments for a device (metadata only; download via /api/files/:id).
export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();
  const { id } = await ctx.params;
  const owned = await prisma.device.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return apiOk({ attachments: [] }, { status: 404 });
  const rows = await prisma.attachment.findMany({
    where: { deviceId: id },
    orderBy: { uploadedAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      description: true,
      uploadedAt: true,
    },
  });
  return apiOk({ attachments: rows });
}

// POST — multipart/form-data upload. Field "file" required, "description" optional.
export async function POST(req: Request, ctx: Ctx) {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();

  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) return apiRateLimited(rl.retryAfterSec);

  const { id: deviceId } = await ctx.params;

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().startsWith('multipart/form-data')) {
    return apiBadInput(undefined, 'Content-Type phải là multipart/form-data');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiBadInput(undefined, 'Không đọc được multipart payload');
  }

  const file = form.get('file');
  const description = form.get('description');
  if (!(file instanceof File)) return apiBadInput(undefined, 'Thiếu file');

  try {
    const attachment = await uploadAttachment(user.id, {
      deviceId,
      fileName: file.name,
      fileType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
      description: typeof description === 'string' ? description : null,
    });
    return apiOk(
      {
        attachment: {
          id: attachment.id,
          fileName: attachment.fileName,
          fileType: attachment.fileType,
          fileSize: attachment.fileSize,
          description: attachment.description,
          uploadedAt: attachment.uploadedAt,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    if (isDomainError(e)) {
      return apiError(statusForCode(e.code), e.code.toLowerCase(), { message: e.message });
    }
    throw e;
  }
}
