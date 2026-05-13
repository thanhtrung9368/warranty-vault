import { requireApiUser } from '@/lib/auth';
import { listUpcomingReminders } from '@/lib/services/reminders';
import { apiBadInput, apiOk, apiUnauthorized } from '@/lib/api-response';

const DEFAULT_WITHIN_DAYS = 30;
const MAX_WITHIN_DAYS = 365;

export async function GET(req: Request) {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();

  const url = new URL(req.url);
  const raw = url.searchParams.get('withinDays');
  let withinDays = DEFAULT_WITHIN_DAYS;
  if (raw !== null && raw !== '') {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > MAX_WITHIN_DAYS) {
      return apiBadInput(
        { withinDays: [`Phải là số nguyên từ 1 tới ${MAX_WITHIN_DAYS}`] },
        'Tham số withinDays không hợp lệ',
      );
    }
    withinDays = n;
  }

  const reminders = await listUpcomingReminders(user.id, withinDays);
  return apiOk({ reminders });
}
