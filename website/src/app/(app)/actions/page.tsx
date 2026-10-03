import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Clock,
  Hash,
  Heart,
  Inbox,
  Info,
  Paperclip,
  RefreshCw,
  ShieldOff,
  ShieldX,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { ActionItemSnooze } from '@/components/action-item-snooze';
import { api } from '@/lib/api';
import type { ActionItem } from '@/lib/api/actions';
import { requireUser } from '@/lib/auth';
import {
  SEVERITY_SECTIONS,
  actionHref,
  badgeCount,
  dueDateNote,
  entityLabel,
  groupBySeverity,
  severityOf,
  snoozeNote,
  splitQueue,
  type SeverityTone,
} from '@/lib/action-queue';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Per-kind icon. `kind` is the stable machine code the openapi tells clients to
// switch on; `title`/`detail` stay display-only copy from the server.
const KIND_ICONS: Record<string, LucideIcon> = {
  WARRANTY_EXPIRED: ShieldX,
  DEVICE_NO_WARRANTY: ShieldOff,
  DEVICE_STATUS_STALE: AlertTriangle,
  DEVICE_MISSING_SERIAL: Hash,
  DEVICE_MISSING_RECEIPT: Paperclip,
  RETURN_WINDOW_CLOSING: CalendarCheck,
  RETURN_WINDOW_UNKNOWN: CalendarClock,
  SUBSCRIPTION_RENEWING_NO_CANCEL_URL: RefreshCw,
  SUBSCRIPTION_PAID_NOT_ADVANCED: RefreshCw,
  WISHLIST_TARGET_PASSED: Heart,
};

const TONE_BADGE: Record<SeverityTone, string> = {
  rose: 'tint-rose',
  amber: 'tint-amber',
  zinc: 'tint-zinc',
};

const TONE_TITLE: Record<SeverityTone, string> = {
  rose: 'text-rose-ink',
  amber: 'text-amber-ink',
  zinc: 'text-ink-2',
};

// One row of the queue, shared by the actionable sections and "Đang hoãn".
// Everything that reads as a claim (`title`, `detail`) comes from the payload.
function ActionRow({ item, first }: { item: ActionItem; first: boolean }) {
  const severity = severityOf(item);
  const tone = SEVERITY_SECTIONS.find((s) => s.severity === severity)?.tone ?? 'zinc';
  const href = actionHref(item);
  const entity = entityLabel(item);
  const Icon = KIND_ICONS[item.kind] ?? Inbox;
  const isSnoozed = item.snoozedUntil != null && item.snoozedUntil !== '';

  return (
    <li
      className={cn(
        'info-row flex flex-wrap items-start gap-3 py-3.5',
        first && '!border-t-0 pt-0',
      )}
    >
      <span className={cn('icon-badge icon-badge-sm mt-0.5', TONE_BADGE[tone])}>
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {href ? (
            <Link
              href={href}
              className="font-display text-sm font-bold text-ink hover:text-primary hover:underline"
            >
              {item.title}
            </Link>
          ) : (
            // Some kinds have no entity behind them — render the title plain
            // rather than a link that goes nowhere.
            <p className="font-display text-sm font-bold text-ink">{item.title}</p>
          )}
        </div>

        <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {item.dueDate && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              {formatDate(item.dueDate)} · {dueDateNote(item.dueDate)}
            </span>
          )}
          {item.amountVnd != null && (
            <span className="font-semibold tabular-nums text-ink-2">
              {formatVND(item.amountVnd)}
            </span>
          )}
          {isSnoozed && item.snoozedUntil && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {snoozeNote(item.snoozedUntil)}
            </span>
          )}
          {href && entity && (
            <Link
              href={href}
              className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
            >
              Xem {entity.toLowerCase()}
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>

      <div className="ml-auto shrink-0">
        <ActionItemSnooze itemKey={item.itemKey} isSnoozed={isSnoozed} />
      </div>
    </li>
  );
}

export default async function ActionsPage() {
  await requireUser();

  // One call, with `snoozed=true`: the flag only ever ADDS rows (openapi:
  // "chỉ thêm dòng, không bao giờ bớt dòng"), so the same payload drives both
  // the queue and "Đang hoãn". `counts` still counts the actionable subset —
  // that is what the badge below and the sidebar show.
  const res = await api.actions.list({ snoozed: true });

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <h1 className="display text-3xl text-ink">Việc cần xử lý</h1>
        <div className="rounded-2xl border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive">
          Lỗi tải hàng đợi: {res.message ?? res.error}
        </div>
      </div>
    );
  }

  const queue = res.data;
  const items = queue.items ?? [];
  const { active, snoozed } = splitQueue(items);
  const sections = groupBySeverity(active);
  // Badge/summary number: always the actionable subset, never + snoozed.
  const total = badgeCount(queue.counts);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Hàng đợi</p>
        <h1 className="display mt-1 text-3xl text-ink md:text-4xl">Việc cần xử lý</h1>
        <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
          Những việc app tự suy ra từ dữ liệu bạn đã nhập và không tự quyết được. Hoãn một việc
          sẽ ẩn nó khỏi hàng đợi tới hạn bạn chọn — việc đang hoãn luôn xem lại và bỏ hoãn được ở
          mục “Đang hoãn” bên dưới.
        </p>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card tint-primary">
          <p className="stat-eyebrow">Đang cần xử lý</p>
          <p className="display mt-1.5 text-3xl tabular-nums text-primary-ink">{total}</p>
          <p className="mt-1 text-xs opacity-80">Không tính việc đang hoãn</p>
        </div>
        <div className="stat-card tint-rose">
          <p className="stat-eyebrow">Ưu tiên cao</p>
          <p className="display mt-1.5 text-3xl tabular-nums text-rose-ink">
            {queue.counts.high}
          </p>
          <p className="mt-1 text-xs opacity-80">Mốc thời gian hoặc tiền sắp mất</p>
        </div>
        <div className="stat-card tint-amber">
          <p className="stat-eyebrow">Ưu tiên vừa</p>
          <p className="display mt-1.5 text-3xl tabular-nums text-amber-ink">
            {queue.counts.medium}
          </p>
          <p className="mt-1 text-xs opacity-80">Nên xem lại</p>
        </div>
        <div className="stat-card tint-zinc">
          <p className="stat-eyebrow">Ưu tiên thấp</p>
          <p className="display mt-1.5 text-3xl tabular-nums text-ink-2">{queue.counts.low}</p>
          <p className="mt-1 text-xs opacity-80">Chưa gấp</p>
        </div>
      </div>

      {/* The server's own explanation of what this queue is — and is not. It is
          rendered verbatim; the client adds no claim of its own. */}
      <div className="flex items-start gap-3 rounded-2xl border-[1.5px] border-border bg-surface-2 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm text-ink-2">{queue.note}</p>
          <p className="text-xs text-muted-foreground">
            Hàng đợi tính tới {formatDate(queue.generatedAt)}.
          </p>
        </div>
      </div>

      {active.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          tone="emerald"
          title="Không có việc nào đang chờ"
          description="Từ dữ liệu bạn đã nhập, app chưa suy ra được việc nào cần bạn quyết. Việc mới sẽ xuất hiện ở đây khi dữ liệu đổi."
          cta={false}
        />
      ) : (
        <div className="space-y-2">
          {sections.map(({ section, items: rows }) => (
            <section key={section.severity} className="space-y-3">
              <div className="section-divider">
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-pill px-3 py-1 text-xs font-bold',
                    TONE_BADGE[section.tone],
                  )}
                >
                  {rows.length}
                </span>
                <span
                  className={cn(
                    'font-display text-[15px] font-bold tracking-tight',
                    TONE_TITLE[section.tone],
                  )}
                >
                  {section.title}
                </span>
                <span className="text-xs text-muted-foreground">{section.hint}</span>
              </div>
              <Card className="rounded-lg border-[1.5px] border-border bg-card shadow-soft">
                <CardContent className="p-4 sm:p-5">
                  <ul>
                    {rows.map((item, i) => (
                      <ActionRow key={item.itemKey} item={item} first={i === 0} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}

      {/* Đang hoãn — server-side snoozes, so a snooze taken on the phone shows
          up here too. The count comes from `snoozedCount`, which the server
          reports even when the rows are not in `items`. */}
      <section className="space-y-3">
        <div className="section-divider">
          <span className="inline-flex items-center gap-2 rounded-pill px-3 py-1 text-xs font-bold tint-zinc">
            <Clock className="h-3.5 w-3.5" />
            {queue.snoozedCount}
          </span>
          <span className="font-display text-[15px] font-bold tracking-tight text-ink-2">
            Đang hoãn
          </span>
        </div>
        <Card className="rounded-lg border-[1.5px] border-border bg-card shadow-soft">
          <CardContent className="p-4 sm:p-5">
            {snoozed.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                {queue.snoozedCount > 0
                  ? 'Không tải được danh sách việc đang hoãn — thử tải lại trang nhé.'
                  : 'Chưa hoãn việc nào. Việc nào bạn bấm “Hoãn” sẽ nằm ở đây để bỏ hoãn.'}
              </p>
            ) : (
              <ul>
                {snoozed.map((item, i) => (
                  <ActionRow key={item.itemKey} item={item} first={i === 0} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
