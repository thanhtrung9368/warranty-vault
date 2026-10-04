'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dismissDeviceWarnings } from '@/app/actions/devices';
import type { DeviceWarning } from '@/lib/api/devices';
import { deviceWarningFieldLabel, deviceWarningTitle } from '@/lib/device-warnings';
import { useLocale, useT } from '@/lib/i18n/client';

/**
 * "Chúng tôi đã lưu, nhưng giá trị này có vẻ sai" — the advisory warnings the Go
 * service returns alongside a successful device create/update.
 *
 * Non-blocking by design: the device is saved and nothing here offers to undo,
 * discard or re-validate it. The wording of each finding is the API's own
 * Vietnamese `message` (kept verbatim because it carries the details — e.g. how
 * many other devices already use the serial); we only add the short heading and
 * the "đã lưu" framing so it cannot be misread as a failure.
 *
 * The warnings arrive through a short-lived cookie set by the write action (see
 * `lib/device-warnings-flash`). Once displayed they are cleared, so the banner
 * reports the save you just made rather than lingering on every visit.
 */
export function DeviceWarningsBanner({ warnings }: { warnings: DeviceWarning[] }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [hidden, setHidden] = React.useState(false);

  const clear = React.useCallback(() => {
    void dismissDeviceWarnings().catch(() => undefined);
  }, []);

  // Show once: the act of rendering the banner consumes the flash. Deliberately
  // fire-and-forget — failing to clear only means it is shown again later.
  const consumed = React.useRef(false);
  React.useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    clear();
  }, [clear]);

  if (hidden || warnings.length === 0) return null;

  return (
    <div
      role="status"
      className="rounded-lg border-[1.5px] border-amber-200 bg-amber-soft p-4 text-amber-ink dark:border-amber-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">
              {t('Đã lưu thiết bị — nhưng thông tin này có vẻ chưa đúng')}
            </p>
            <p className="mt-0.5 text-xs opacity-90">
              {t(
                'Cảnh báo không chặn gì cả: thiết bị vẫn được lưu nguyên như bạn nhập. Kiểm tra lại rồi sửa nếu cần.',
              )}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="rounded-pill text-amber-ink hover:bg-card/70"
          onClick={() => {
            setHidden(true);
            clear();
            router.refresh();
          }}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          {t('Đóng')}
        </Button>
      </div>

      <ul className="mt-3 space-y-2">
        {warnings.map((w, i) => (
          <li
            key={`${w.code}-${i}`}
            className="rounded-md border-[1.5px] border-amber-200/70 bg-card/60 p-3 dark:border-amber-900/70"
          >
            <p className="text-xs font-semibold uppercase tracking-wide">
              {deviceWarningTitle(w.code, locale)} · {deviceWarningFieldLabel(w.field, locale)}
            </p>
            <p className="mt-1 text-sm">{w.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
