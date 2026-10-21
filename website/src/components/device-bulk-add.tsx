'use client';

// Bulk add — the row-editor entry shape.
//
// Why rows rather than a paste box: `devices/import` already handles "paste the
// table a shop / spreadsheet gave me". This screen is for the other person —
// the one standing in a new flat with five appliances and no table at all. They
// add a row per appliance, see exactly which four fields each row needs, and
// submit once.
//
// The partial-success behaviour is the point of the whole screen:
//   * a 200 keeps the created rows created (green, fields frozen, link to the
//     device) and leaves only the failed rows editable, with the server's field
//     errors on the fields that produced them;
//   * the next submit sends only the rows that still need work, so fixing row 3
//     cannot create rows 1, 2, 4 and 5 a second time;
//   * a 409 is a whole-batch refusal and is rendered as such — no row is marked
//     failed because nothing was created.

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Info,
  Loader2,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CategoryOption } from '@/app/actions/catalog';
import {
  bulkCreateDevices,
  type BulkDeviceFormState,
} from '@/app/actions/devices';
import {
  BULK_DEVICE_MAX_ROWS,
  isBlankBulkDeviceDraft,
  reconcileBulkRows,
  type BulkDeviceFailure,
  type BulkDeviceQuota,
  type BulkRowOutcome,
} from '@/lib/device-bulk';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

const INITIAL_ROWS = 3;

type RowStatus = 'draft' | 'created' | 'failed' | 'unresolved';

type RowState = {
  id: string;
  name: string;
  category: string;
  purchaseDate: string;
  /** Raw digits; the action turns this into `purchasePrice` (VND, blank = 0). */
  price: string;
  status: RowStatus;
  deviceId?: string;
  failure?: BulkDeviceFailure;
};

type EditableField = 'name' | 'category' | 'purchaseDate' | 'price';

/** UI field → the key the Go validator uses in `fieldErrors`. */
const WIRE_FIELD: Record<EditableField, string> = {
  name: 'name',
  category: 'category',
  purchaseDate: 'purchaseDate',
  price: 'purchasePrice',
};

function blankRow(id: string): RowState {
  return {
    id,
    name: '',
    category: '',
    purchaseDate: '',
    price: '',
    status: 'draft',
  };
}

function initialRows(): RowState[] {
  return Array.from({ length: INITIAL_ROWS }, (_, index) => blankRow(`bulk-row-${index + 1}`));
}

function isRowBlank(row: RowState): boolean {
  return isBlankBulkDeviceDraft({
    name: row.name,
    category: row.category,
    purchaseDate: row.purchaseDate,
    purchasePrice: row.price,
  });
}

function withOutcome(row: RowState, outcome: BulkRowOutcome): RowState {
  switch (outcome.status) {
    case 'created':
      return {
        ...row,
        status: 'created',
        deviceId: outcome.device.id,
        failure: undefined,
      };
    case 'failed':
      return {
        ...row,
        status: 'failed',
        deviceId: undefined,
        failure: outcome.failure,
      };
    case 'unresolved':
      return {
        ...row,
        status: 'unresolved',
        deviceId: undefined,
        failure: undefined,
      };
  }
}

function clearFieldError(
  failure: BulkDeviceFailure | undefined,
  field: string,
): BulkDeviceFailure | undefined {
  if (!failure?.fieldErrors?.[field]) return failure;
  const fieldErrors = { ...failure.fieldErrors };
  delete fieldErrors[field];
  return { ...failure, fieldErrors };
}

function RowFieldErrors({
  id,
  messages,
}: {
  id: string;
  messages?: string[];
}) {
  if (!messages || messages.length === 0) return null;
  return (
    <div id={id} className="space-y-0.5">
      {messages.map((message, index) => (
        <p key={`${message}-${index}`} className="text-xs font-medium text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
}

function RowStatusBadge({ row }: { row: RowState }) {
  const t = useT();
  if (row.status === 'created') {
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-emerald-soft px-2 py-0.5 text-xs font-bold text-emerald-ink">
        <CheckCircle2 className="h-3 w-3" />
        {t('Đã tạo')}
      </span>
    );
  }
  if (row.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-rose-soft px-2 py-0.5 text-xs font-bold text-rose-ink">
        <XCircle className="h-3 w-3" />
        {t('Cần sửa')}
      </span>
    );
  }
  if (row.status === 'unresolved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-amber-soft px-2 py-0.5 text-xs font-bold text-amber-ink">
        <HelpCircle className="h-3 w-3" />
        {t('Chưa rõ kết quả')}
      </span>
    );
  }
  return null;
}

function BulkRowCard({
  row,
  index,
  categories,
  onChange,
  onRemove,
}: {
  row: RowState;
  index: number;
  categories: CategoryOption[];
  onChange: (id: string, field: EditableField, value: string) => void;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const created = row.status === 'created';
  const fieldErrors = row.failure?.fieldErrors ?? {};
  const nameError = fieldErrors.name;
  const categoryError = fieldErrors.category;
  const dateError = fieldErrors.purchaseDate;
  const priceError = fieldErrors.purchasePrice;
  const shownKeys = new Set(['name', 'category', 'purchaseDate', 'purchasePrice']);
  const otherErrors = Object.entries(fieldErrors).filter(
    ([key, messages]) => !shownKeys.has(key) && messages.length > 0,
  );
  const showRowMessage =
    Boolean(row.failure?.message) &&
    (![nameError, categoryError, dateError, priceError].some(
      (messages) => messages && messages.length > 0,
    ) ||
      otherErrors.length > 0);

  const fieldId = (field: EditableField) => `${row.id}-${field}`;

  // Stable ids per field, so `<Label htmlFor>` and `aria-describedby` cannot
  // point at another row's control.
  const nameId = fieldId('name');
  const categoryId = fieldId('category');
  const dateId = fieldId('purchaseDate');
  const priceId = fieldId('price');

  return (
    <div
      className={cn(
        'rounded-lg border-[1.5px] bg-card p-4 transition-colors',
        row.status === 'created' && 'border-emerald-ink/30 bg-emerald-soft/30',
        row.status === 'failed' && 'border-rose-ink/30 bg-rose-soft/30',
        row.status === 'unresolved' && 'border-amber-ink/30 bg-amber-soft/30',
        row.status === 'draft' && 'border-border',
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {t('Dòng {line}', { line: index + 1 })}
          </span>
          <RowStatusBadge row={row} />
        </div>
        <div className="flex items-center gap-1">
          {created && row.deviceId && (
            <Link
              href={`/devices/${row.deviceId}`}
              className="text-xs font-semibold text-emerald-ink hover:underline"
            >
              {t('Xem thiết bị')} →
            </Link>
          )}
          {!created && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-pill text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(row.id)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {t('Xoá dòng')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>{t('Tên thiết bị')}</Label>
          <Input
            id={nameId}
            value={row.name}
            onChange={(event) => onChange(row.id, 'name', event.target.value)}
            placeholder={t('vd: Tủ lạnh Samsung')}
            disabled={created}
            aria-invalid={Boolean(nameError?.length)}
            aria-describedby={nameError?.length ? `${nameId}-error` : undefined}
          />
          <RowFieldErrors id={`${nameId}-error`} messages={nameError} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={categoryId}>{t('Loại')}</Label>
          <select
            id={categoryId}
            value={row.category}
            onChange={(event) => onChange(row.id, 'category', event.target.value)}
            disabled={created}
            aria-invalid={Boolean(categoryError?.length)}
            aria-describedby={categoryError?.length ? `${categoryId}-error` : undefined}
            className={cn(
              'flex h-11 w-full rounded-md border-[1.5px] border-border bg-card px-3.5 text-sm text-ink transition-[border-color,box-shadow] focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60',
              categoryError?.length && 'border-destructive',
            )}
          >
            <option value="">{t('Chọn loại')}</option>
            {categories.map((category) => (
              <option key={category.code} value={category.code}>
                {category.name}
              </option>
            ))}
          </select>
          <RowFieldErrors id={`${categoryId}-error`} messages={categoryError} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={dateId}>{t('Ngày mua')}</Label>
          <Input
            id={dateId}
            type="date"
            value={row.purchaseDate}
            onChange={(event) => onChange(row.id, 'purchaseDate', event.target.value)}
            disabled={created}
            aria-invalid={Boolean(dateError?.length)}
            aria-describedby={dateError?.length ? `${dateId}-error` : undefined}
          />
          <RowFieldErrors id={`${dateId}-error`} messages={dateError} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={priceId}>{t('Giá mua (VND)')}</Label>
          <div className="relative">
            <Input
              id={priceId}
              inputMode="numeric"
              value={row.price}
              onChange={(event) =>
                onChange(row.id, 'price', event.target.value.replace(/[^\d]/g, ''))
              }
              placeholder="0"
              disabled={created}
              aria-invalid={Boolean(priceError?.length)}
              aria-describedby={priceError?.length ? `${priceId}-error` : undefined}
              className="pr-14 tabular-nums"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
              VND
            </span>
          </div>
          <RowFieldErrors id={`${priceId}-error`} messages={priceError} />
        </div>
      </div>

      {showRowMessage && (
        <p className="mt-3 flex items-start gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{row.failure?.message}</span>
        </p>
      )}

      {otherErrors.length > 0 && (
        <ul className="mt-2 space-y-0.5 pl-5 text-xs text-destructive">
          {otherErrors.map(([key, messages]) => (
            <li key={key}>
              <span className="font-semibold">{key}:</span> {messages.join(' · ')}
            </li>
          ))}
        </ul>
      )}

      {row.status === 'unresolved' && (
        <p className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-soft px-3 py-2 text-xs font-medium text-amber-ink">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {t(
              'Dòng này chưa có kết quả từ máy chủ — kiểm tra danh sách thiết bị trước khi gửi lại.',
            )}
          </span>
        </p>
      )}
    </div>
  );
}

function SubmitButton({ count, disabled }: { count: number; disabled: boolean }) {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} size="lg" className="rounded-pill">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Plus className="mr-2 h-4 w-4" />
      )}
      {pending
        ? t('Đang tạo…')
        : count > 0
          ? t('Tạo {count} thiết bị', { count })
          : t('Tạo thiết bị')}
    </Button>
  );
}

function ResultBanner({ state }: { state: BulkDeviceFormState }) {
  const t = useT();
  const created = state.createdCount ?? 0;
  const failed = state.failedCount ?? 0;
  const tone =
    failed === 0 && created > 0
      ? 'border-emerald-ink/30 bg-emerald-soft text-emerald-ink'
      : created > 0
        ? 'border-amber-ink/30 bg-amber-soft text-amber-ink'
        : 'border-rose-ink/30 bg-rose-soft text-rose-ink';
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('space-y-2 rounded-lg border-[1.5px] px-4 py-3', tone)}
    >
      <p className="text-sm font-semibold">{t('Kết quả')}</p>
      <p className="text-sm font-medium">{state.message}</p>
      {failed > 0 && (
        <p className="text-xs">
          {t(
            'Sửa lỗi ở các dòng được đánh dấu rồi gửi lại — chỉ những dòng lỗi được gửi đi.',
          )}
        </p>
      )}
      {created > 0 && failed > 0 && (
        <p className="text-xs">
          {t(
            'Các dòng đã tạo giữ nguyên; lần gửi sau chỉ gồm các dòng còn lỗi hoặc dòng mới.',
          )}
        </p>
      )}
      {created > 0 && (
        <Button asChild variant="outline" size="sm" className="rounded-pill">
          <Link href="/devices">{t('Xem danh sách thiết bị')}</Link>
        </Button>
      )}
    </div>
  );
}

function LimitBanner({
  state,
  batchCount,
}: {
  state: BulkDeviceFormState;
  batchCount: number;
}) {
  const t = useT();
  const quota: BulkDeviceQuota | null | undefined = state.quota;
  const reduceTo =
    quota && quota.remaining > 0 && batchCount > quota.remaining ? quota.remaining : null;
  // Name the ceiling that actually binds: the active-device ceiling ignores
  // sold devices, while the storage ceiling counts them. This matters most when
  // both remainders are zero — "delete something" is the only universally
  // correct remedy, and the detail line tells the user which count is full.
  const detail = quota
    ? quota.remainingActive <= quota.remainingTotal
      ? t('Đang có {active}/{max} thiết bị chưa bán.', {
          active: quota.active,
          max: quota.maxActive,
        })
      : t('Đang có {total}/{max} hồ sơ thiết bị (tính cả thiết bị đã bán).', {
          total: quota.total,
          max: quota.maxTotal,
        })
    : null;

  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border-[1.5px] border-rose-ink/30 bg-rose-soft px-4 py-3 text-rose-ink"
    >
      <p className="flex items-start gap-2 text-sm font-semibold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {state.message ??
            t('Không tạo được thiết bị nào — cả lô vượt giới hạn thiết bị của tài khoản.')}
        </span>
      </p>
      <p className="pl-6 text-sm font-medium">
        {t('Không có thiết bị nào trong lô này được tạo.')}
      </p>
      {quota ? (
        quota.remaining > 0 ? (
          <div className="space-y-1 pl-6 text-sm">
            <p>
              {t('Tài khoản còn nhận thêm {remaining} thiết bị.', {
                remaining: quota.remaining,
                count: quota.remaining,
              })}
            </p>
            {detail && <p className="text-xs">{detail}</p>}
            {reduceTo != null && (
              <p className="text-xs font-semibold">
                {t('Bớt còn tối đa {remaining} dòng rồi gửi lại.', {
                  remaining: reduceTo,
                  count: reduceTo,
                })}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1 pl-6 text-sm">
            <p>
              {t('Tài khoản đã đầy — xoá bớt thiết bị rồi thử lại.')}
            </p>
            {detail && <p className="text-xs">{detail}</p>}
          </div>
        )
      ) : (
        <p className="pl-6 text-sm">
          {t('Không đọc được số suất còn lại — kiểm tra danh sách thiết bị rồi thử lại.')}
        </p>
      )}
      <div className="pl-6">
        <Button asChild variant="outline" size="sm" className="rounded-pill">
          <Link href="/devices">{t('Xem danh sách thiết bị')}</Link>
        </Button>
      </div>
    </div>
  );
}

export function DeviceBulkAdd({ categories }: { categories: CategoryOption[] }) {
  const t = useT();
  const [rows, setRows] = React.useState<RowState[]>(initialRows);
  const nextRowId = React.useRef(INITIAL_ROWS + 1);

  // Put a 200 back on the rows that produced it as soon as the server action
  // resolves. `submittedIds` travels through the action state, so the mapping
  // uses the same array the API indexed — adding/removing rows after a submit
  // cannot shift it. (Doing this in an effect would trip
  // `react-hooks/set-state-in-effect` and cause an extra render for no reason.)
  const runBulkCreate = React.useCallback(
    async (
      previousState: BulkDeviceFormState,
      formData: FormData,
    ): Promise<BulkDeviceFormState> => {
      const next = await bulkCreateDevices(previousState, formData);
      if (next.submittedIds && (next.created != null || next.failed != null)) {
        const submittedIds = next.submittedIds;
        const created = next.created ?? [];
        const failed = next.failed ?? [];
        setRows((previous) => {
          const byId = new Map(previous.map((row) => [row.id, row]));
          const submittedRows = submittedIds
            .map((id) => byId.get(id))
            .filter((row): row is RowState => row != null);
          // A row disappeared between submitting and the response (for example
          // the user removed it while the request was in flight). Do not apply
          // a positionally-mapped response to a different list.
          if (submittedRows.length !== submittedIds.length) return previous;

          const outcomes = new Map(
            reconcileBulkRows(submittedRows, { created, failed }).map((entry) => [
              entry.row.id,
              entry.outcome,
            ]),
          );
          return previous.map((row) => {
            const outcome = outcomes.get(row.id);
            return outcome ? withOutcome(row, outcome) : row;
          });
        });
      }
      return next;
    },
    [],
  );

  const [state, formAction] = useActionState<BulkDeviceFormState, FormData>(
    runBulkCreate,
    {},
  );

  const submittableRows = rows.filter(
    (row) => row.status !== 'created' && !isRowBlank(row),
  );
  const canAddRow = rows.length < BULK_DEVICE_MAX_ROWS;
  const canSubmit = submittableRows.length > 0 && categories.length > 0;

  // The exact rows this submission would send. Created rows are deliberately
  // absent: a retry must not write them again. Blank rows are absent too, so a
  // half-typed spare row cannot consume a request slot.
  const payload = JSON.stringify(
    submittableRows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      purchaseDate: row.purchaseDate,
      purchasePrice: row.price,
    })),
  );

  function addRow() {
    setRows((previous) => {
      if (previous.length >= BULK_DEVICE_MAX_ROWS) return previous;
      const id = `bulk-row-${nextRowId.current}`;
      nextRowId.current += 1;
      return [...previous, blankRow(id)];
    });
  }

  function removeRow(id: string) {
    setRows((previous) => {
      const target = previous.find((row) => row.id === id);
      if (!target || target.status === 'created') return previous;
      const next = previous.filter((row) => row.id !== id);
      if (next.length > 0) return next;
      // Keep one empty row on screen: an empty form is a dead end otherwise.
      const freshId = `bulk-row-${nextRowId.current}`;
      nextRowId.current += 1;
      return [blankRow(freshId)];
    });
  }

  function updateRow(id: string, field: EditableField, value: string) {
    setRows((previous) =>
      previous.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, [field]: value };
        // Clear only the error for the field being edited. The rest of the
        // server's report stays visible until the next submission replaces it.
        next.failure = clearFieldError(row.failure, WIRE_FIELD[field]);
        return next;
      }),
    );
  }

  return (
    <div className="space-y-6">
      {/* ── What a row is (and is not) ───────────────────────────────────── */}
      <Card padding="md">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Info className="h-4 w-4 text-primary" />
          {t('Mỗi dòng chỉ cần bốn thông tin: tên, loại, ngày mua và giá.')}
        </p>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>
            {t(
              'Hãng, model, serial, bảo hành, nơi mua, ghi chú... thêm sau ở trang chi tiết.',
            )}
          </li>
          <li>
            {t(
              'Giá trong bảng này tính bằng VND. Thiết bị mua bằng ngoại tệ cần thêm ở form đơn để có tỷ giá.',
            )}
          </li>
          <li>
            {t(
              'Tối đa 50 dòng mỗi lần. Dòng hợp lệ vẫn được tạo kể cả khi dòng khác lỗi — sửa dòng lỗi rồi gửi lại, các dòng đã tạo không bị tạo lại.',
            )}
          </li>
          <li>
            {t('Có sẵn danh sách từ cửa hàng?')}{' '}
            <Link href="/devices/import" className="font-semibold text-primary hover:underline">
              {t('Dán bảng để nhập nhiều thiết bị một lúc')}
            </Link>
          </li>
        </ul>
      </Card>

      {categories.length === 0 && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-amber-soft px-3 py-2 text-sm text-amber-ink"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t('Không tải được danh mục loại thiết bị — tải lại trang rồi thử lại.')}
          </span>
        </p>
      )}

      {/* The 409 is deliberately rendered away from the row list: it is a
          whole-batch refusal, not a row that needs editing. */}
      {state.limitReached ? (
        <LimitBanner state={state} batchCount={submittableRows.length} />
      ) : state.message ? (
        <ResultBanner state={state} />
      ) : null}

      <form
        action={formAction}
        className="space-y-4"
        onSubmit={(event) => {
          if (!canSubmit) event.preventDefault();
        }}
      >
        <input type="hidden" name="rows" value={payload} />

        <div className="space-y-3">
          {rows.map((row, index) => (
            <BulkRowCard
              key={row.id}
              row={row}
              index={index}
              categories={categories}
              onChange={updateRow}
              onRemove={removeRow}
            />
          ))}
        </div>

        <Card padding="sm" tone="muted" className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="rounded-pill"
              onClick={addRow}
              disabled={!canAddRow}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t('Thêm dòng')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t('{count}/{max} dòng', {
                count: rows.length,
                max: BULK_DEVICE_MAX_ROWS,
              })}
            </p>
            {!canAddRow && (
              <p className="text-xs font-medium text-amber-ink">
                {t('Đã đạt tối đa {max} dòng mỗi lần.', { max: BULK_DEVICE_MAX_ROWS })}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton count={submittableRows.length} disabled={!canSubmit} />
          </div>
        </Card>
      </form>
    </div>
  );
}
