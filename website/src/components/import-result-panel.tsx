'use client';

// Persistent result block for a backup import.
//
// The counters are a success message; an `ImportResult.warnings` entry is not.
// It means the import SUCCEEDED but the file could not prove its own timestamp
// basis (today: an export written before the UTC fix, whose instants may be 7
// hours off). That is a provenance caveat, not an error: Go restored every row
// exactly as the file stated and deliberately did not guess an offset. So this
// panel must never look like a failure (no red/destructive palette, no "thử
// lại") and must never look like a plain success either (no emerald, no
// CheckCircle2) when a warning is present.
//
// It follows the app's existing non-fatal-problem pattern — `bg-amber-soft` +
// `text-amber-ink` + `AlertTriangle`, the same palette as the export's
// sensitive-data note, the replace-mode warning and `DeviceWarningsBanner`.
// Unlike that banner there is no dismiss control: the warning describes the
// data now in the account, and closing it would be the only way to lose it.
// It stays until the next import replaces it or the page is left.
//
// The caveat sentences themselves are the API's, verbatim. Go already rendered
// them in the request's language (the import proxy forwards `?lang=`) and they
// carry facts the web must not paraphrase into a second, drifting copy. The
// copy below is only the frame: "the import finished, read this".

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import type { ImportSummary } from '@/lib/backup-media';

export function ImportResultPanel({ summary }: { summary: ImportSummary | null }) {
  const t = useT();
  if (!summary) return null;

  const hasWarnings = summary.warnings.length > 0;
  const isWarning = summary.tone === 'warning';

  return (
    <div
      // A live region: the result appears after an async upload, so a screen
      // reader that is not watching the file input still hears it.
      role="status"
      aria-live="polite"
      data-import-tone={summary.tone}
      className={cn(
        'flex items-start gap-3 rounded-md p-3.5 text-sm',
        isWarning
          ? 'border-[1.5px] border-amber-200 bg-amber-soft text-amber-ink dark:border-amber-900'
          : 'border-[1.5px] border-emerald-soft bg-emerald-soft/60 text-emerald-ink',
      )}
    >
      {isWarning ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
      )}
      <div className="min-w-0 space-y-1.5">
        {hasWarnings && (
          <div className="space-y-1.5">
            <p className="font-display text-[15px] font-bold">
              {t('Đã nhập xong — nhưng dữ liệu có cảnh báo')}
            </p>
            <p className="text-xs font-medium opacity-90">
              {t(
                'Dữ liệu đã được nhập đầy đủ. Cảnh báo này không chặn gì cả, nhưng hãy đọc kỹ bên dưới.',
              )}
            </p>
            {summary.warnings.map((warning, index) => (
              <p key={index} className="leading-relaxed">
                {warning}
              </p>
            ))}
          </div>
        )}

        <p className={cn('font-semibold', hasWarnings && 'pt-1')}>{summary.message}</p>
        {summary.unreadableWarning && <p>{summary.unreadableWarning}</p>}
        {summary.details.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4">
            {summary.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
