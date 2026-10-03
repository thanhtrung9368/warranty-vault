'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Info,
  Loader2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { CategoryOption } from '@/app/actions/catalog';
import {
  importDevicesFromPaste,
  type PasteImportState,
} from '@/app/actions/devices';
import {
  PASTE_FIELD_LABELS,
  categoryLabelFor,
  parsePasteImport,
  type PasteHeaderMode,
} from '@/lib/device-paste';
import { formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';

// Only the first N rows are rendered as a table. The summary + the error list
// below the table always cover EVERY row, so a big paste can never hide a row
// that will not be created.
const PREVIEW_RENDER_LIMIT = 100;

const EXAMPLE = [
  'Tên thiết bị\tLoại\tHãng\tModel\tSerial\tNgày mua\tGiá mua\tNơi mua\tGhi chú',
  'iPhone 13\tĐiện thoại\tApple\tA2633\tIMEI123\t15/03/2024\t15.000.000\tFPT Shop\tmua cho vợ',
  'Máy giặt\tMáy giặt / Sấy\tLG\tFC1409\t\t01/12/2023\t9tr\tĐiện Máy Xanh\t',
].join('\n');

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} className="rounded-pill">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <ClipboardPaste className="mr-2 h-4 w-4" />
      )}
      {pending ? 'Đang tạo…' : label}
    </Button>
  );
}

export function DevicePasteImport({ categories }: { categories: CategoryOption[] }) {
  const [text, setText] = React.useState('');
  const [headerMode, setHeaderMode] = React.useState<PasteHeaderMode>('auto');
  const [state, formAction] = useActionState<PasteImportState, FormData>(
    importDevicesFromPaste,
    {},
  );

  // The exact preview the server action would rebuild from the same text. Pure
  // function, so running it on every keystroke is cheap (and capped at
  // `PASTE_MAX_ROWS`).
  const preview = React.useMemo(
    () => parsePasteImport(text, { categories, headerMode }),
    [text, categories, headerMode],
  );

  const renderRows = preview.rows.slice(0, PREVIEW_RENDER_LIMIT);
  const errorRows = preview.rows.filter((r) => r.errors.length > 0);
  const results = state.results ?? [];

  // A finished run clears the textarea: the same paste is usually still on the
  // clipboard, and re-submitting it by accident would create every device a
  // second time. Only a run that came back with per-row results clears it, so a
  // transport failure leaves the text in place to retry. The report below keeps
  // the outcome visible after the text is gone.
  const handledState = React.useRef<PasteImportState | null>(null);
  React.useEffect(() => {
    if (state.results == null || handledState.current === state) return;
    handledState.current = state;
    setText('');
  }, [state]);

  return (
    <div className="space-y-6">
      {/* ── What the parser expects ─────────────────────────────────────── */}
      <div className="rounded-2xl border-[1.5px] border-border bg-card p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Info className="h-4 w-4 text-primary" />
          Cách dán
        </p>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>
            Mỗi dòng là một thiết bị. Cột ngăn cách bằng <b>tab</b> (copy từ
            Excel/Sheets), hoặc <b>;</b> / <b>,</b> — web tự nhận và ghi rõ bên dưới.
          </li>
          <li>
            Có tiêu đề thì web đọc theo tên cột ({PASTE_FIELD_LABELS.name},{' '}
            {PASTE_FIELD_LABELS.category}, …). Không có tiêu đề thì đọc theo đúng thứ
            tự: {Object.values(PASTE_FIELD_LABELS).join(', ')}.
          </li>
          <li>
            Ngày mua nhận <b>dd/MM/yyyy</b> hoặc <b>yyyy-MM-dd</b>; giá nhận{' '}
            <b>15.000.000</b>, <b>15tr</b>, <b>15,5tr</b>, <b>15k</b>.
          </li>
          <li>
            Các cột khác (Trạng thái, Hết bảo hành…) <b>không</b> được nhập — thiết bị
            tạo ra ở trạng thái “Đang dùng” và chưa có gói bảo hành; thêm sau ở trang
            chi tiết.
          </li>
        </ul>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="paste-text">Dán bảng vào đây</Label>
          <Textarea
            id="paste-text"
            name="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={EXAMPLE}
            className="min-h-[180px] font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Chưa có gì để dán? Thử copy bảng mẫu trong ô trên rồi dán lại.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="space-y-2">
            <Label htmlFor="headerMode">Dòng đầu tiên</Label>
            <Select
              value={headerMode}
              onValueChange={(v) => setHeaderMode(v as PasteHeaderMode)}
            >
              <SelectTrigger id="headerMode" className="w-[220px] rounded-pill">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Tự nhận diện</SelectItem>
                <SelectItem value="yes">Là tiêu đề cột</SelectItem>
                <SelectItem value="no">Là dữ liệu</SelectItem>
              </SelectContent>
            </Select>
            <input type="hidden" name="headerMode" value={headerMode} />
          </div>
          <div className="pt-6">
            <SubmitButton
              disabled={preview.validCount === 0}
              label={
                preview.validCount > 0
                  ? `Tạo ${preview.validCount} thiết bị`
                  : 'Tạo thiết bị'
              }
            />
          </div>
        </div>
      </form>

      {/* A result that never got as far as per-row rows (nothing parseable, or a
          transport failure) still has to be visible — otherwise the click looks
          like a no-op. */}
      {state.message && state.results == null && (
        <p className="flex items-start gap-2 rounded-md bg-amber-soft px-3 py-2 text-sm text-amber-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.message}</span>
        </p>
      )}

      {/* ── Preview: what would be created, row by row ──────────────────── */}
      {!preview.empty && (
        <div className="space-y-3 rounded-2xl border-[1.5px] border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Xem trước</p>
            <p className="text-xs text-muted-foreground">
              Tách bằng {preview.delimiterLabel} ·{' '}
              {preview.headerDetected
                ? 'dòng đầu là tiêu đề'
                : 'không có tiêu đề, đọc theo thứ tự cột chuẩn'}
            </p>
          </div>

          <p
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium',
              preview.validCount > 0
                ? 'bg-emerald-soft text-emerald-ink'
                : 'bg-amber-soft text-amber-ink',
            )}
          >
            Sẽ tạo <b>{preview.validCount}</b> thiết bị
            {preview.skippedCount > 0 && (
              <>
                {' '}
                · bỏ qua <b>{preview.skippedCount}</b> dòng lỗi
              </>
            )}
            .
          </p>

          {preview.headerDetected && preview.headerCells && (
            <p className="text-xs text-muted-foreground">
              Cột đọc được:{' '}
              {preview.columns
                .filter((c): c is typeof c & { field: NonNullable<typeof c.field> } =>
                  c.field != null,
                )
                .map((c) => c.header || PASTE_FIELD_LABELS[c.field])
                .join(', ')}
            </p>
          )}
          {preview.ignoredColumns.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Cột bỏ qua: {preview.ignoredColumns.join(', ')}
            </p>
          )}
          {preview.notes.map((n) => (
            <p key={n} className="text-xs font-medium text-amber-ink">
              {n}
            </p>
          ))}
          {preview.truncated && (
            <p className="text-xs font-medium text-amber-ink">
              Bảng dài hơn mức xử lý — chỉ phần đầu được đọc. Chia nhỏ rồi dán lại.
            </p>
          )}

          <div className="overflow-hidden rounded-lg border-[1.5px] border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Dòng</TableHead>
                  <TableHead>Tên</TableHead>
                  <TableHead className="hidden md:table-cell">Loại</TableHead>
                  <TableHead className="hidden sm:table-cell">Ngày mua</TableHead>
                  <TableHead className="hidden lg:table-cell">Giá mua</TableHead>
                  <TableHead>Kết quả</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderRows.map((row) => (
                  <TableRow key={`${row.line}-${row.name}`}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {row.line}
                    </TableCell>
                    <TableCell className="font-medium text-ink">
                      {row.name || <span className="text-muted-foreground">—</span>}
                      {row.draft && (
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {[
                            [row.draft.brand, row.draft.model].filter(Boolean).join(' '),
                            row.draft.serialNumber,
                            row.draft.purchasePlace,
                            row.draft.notes,
                          ]
                            .filter(Boolean)
                            .join(' • ') || '—'}
                        </span>
                      )}
                      {row.warnings.map((w) => (
                        <span
                          key={w}
                          className="mt-0.5 block text-xs font-normal text-amber-ink"
                        >
                          {w}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell className="hidden text-ink-2 md:table-cell">
                      {row.draft
                        ? categoryLabelFor(row.draft.category, categories)
                        : '—'}
                    </TableCell>
                    <TableCell className="hidden tabular-nums text-ink-2 sm:table-cell">
                      {row.draft?.purchaseDate ?? '—'}
                    </TableCell>
                    <TableCell className="hidden tabular-nums text-ink-2 lg:table-cell">
                      {row.draft ? formatVND(row.draft.purchasePrice) : '—'}
                    </TableCell>
                    <TableCell>
                      {row.draft ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-ink">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Sẽ tạo
                        </span>
                      ) : (
                        <span className="inline-flex items-start gap-1 text-xs font-semibold text-destructive">
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{row.errors.join(' · ')}</span>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {preview.rows.length > renderRows.length && (
            <p className="text-xs text-muted-foreground">
              Chỉ hiển thị {renderRows.length}/{preview.rows.length} dòng đầu — danh
              sách lỗi bên dưới vẫn tính tất cả.
            </p>
          )}
          {errorRows.length > 0 && (
            <div className="rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber-ink">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                {errorRows.length} dòng sẽ bị bỏ qua (không tạo thiết bị):
              </p>
              <ul className="mt-1 space-y-0.5">
                {errorRows.map((r) => (
                  <li key={`err-${r.line}`}>
                    Dòng {r.line}: {r.errors.join(' · ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── What actually happened ──────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="space-y-3 rounded-2xl border-[1.5px] border-border bg-card p-5">
          <p className="text-sm font-semibold text-ink">Kết quả</p>
          <p
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium',
              (state.createdCount ?? 0) > 0
                ? 'bg-emerald-soft text-emerald-ink'
                : 'bg-amber-soft text-amber-ink',
            )}
          >
            {state.message}
          </p>
          {state.stopReason && (
            <p className="flex items-start gap-2 rounded-md bg-amber-soft px-3 py-2 text-sm text-amber-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Đã dừng giữa chừng: {state.stopMessage}{' '}
                {state.stopReason === 'limit'
                  ? 'Những dòng còn lại chưa được tạo — xoá bớt thiết bị rồi dán lại phần còn thiếu.'
                  : 'Những dòng còn lại chưa được tạo — đợi khoảng một phút rồi dán lại phần còn thiếu.'}
              </span>
            </p>
          )}

          <ul className="divide-y divide-border text-sm">
            {results.map((r) => (
              <li key={`res-${r.line}`} className="flex flex-wrap items-start gap-2 py-2">
                <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
                  Dòng {r.line}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{r.name || '—'}</span>
                  {r.message && (
                    <span className="block text-xs text-muted-foreground">{r.message}</span>
                  )}
                  {r.warnings?.map((w) => (
                    <span key={w} className="block text-xs text-amber-ink">
                      {w}
                    </span>
                  ))}
                </span>
                {r.status === 'created' && r.deviceId ? (
                  <Link
                    href={`/devices/${r.deviceId}`}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Đã tạo · xem
                  </Link>
                ) : r.status === 'skipped' ? (
                  <span className="text-xs font-semibold text-muted-foreground">Bỏ qua</span>
                ) : r.status === 'not_attempted' ? (
                  <span className="text-xs font-semibold text-muted-foreground">Chưa tạo</span>
                ) : (
                  <span className="text-xs font-semibold text-destructive">Lỗi</span>
                )}
              </li>
            ))}
          </ul>

          {(state.createdCount ?? 0) > 0 && (
            <Button asChild variant="outline" className="rounded-pill">
              <Link href="/devices">Xem danh sách thiết bị</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
