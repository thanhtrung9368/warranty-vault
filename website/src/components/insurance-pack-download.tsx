'use client';

// "Bảng kê cho bảo hiểm (tiếng Việt)" — the browser half of the insurance PDF
// pack. It fetches the authenticated proxy (`/api/insurance-pack`), refuses an
// empty or non-PDF body, then saves the bytes with a usable filename.
//
// The whole flow is deliberately visible: generating a pack can take a moment
// (photos, warranty terms), and a button that silently does nothing would be
// indistinguishable from a successful download of nothing. Failures stay on
// screen (and in a toast), not just in the console.

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/i18n/client';
import {
  buildInsurancePackQuery,
  hasPdfHeader,
  insurancePackCopy,
  insurancePackFailureMessage,
  resolveInsurancePackFilename,
} from '@/lib/insurance-pack';

type DownloadState = 'idle' | 'downloading' | 'success' | 'error';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function InsurancePackDownload() {
  const locale = useLocale();
  const [includeSold, setIncludeSold] = React.useState(false);
  const [state, setState] = React.useState<DownloadState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const copy = insurancePackCopy(locale, includeSold);

  const fail = (message: string) => {
    setState('error');
    setError(message);
    toast.error(message);
  };

  const handleDownload = async () => {
    setState('downloading');
    setError(null);

    try {
      const res = await fetch(
        `/api/insurance-pack${buildInsurancePackQuery({ includeSold })}`,
        { cache: 'no-store' },
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { message?: unknown }
          | null;
        const upstreamMessage =
          typeof body?.message === 'string' ? body.message : null;
        fail(insurancePackFailureMessage(locale, res.status, upstreamMessage));
        return;
      }

      const blob = await res.blob();
      if (blob.size === 0) {
        fail(copy.emptyFile);
        return;
      }

      // The proxy already checks Content-Type, but a 200 carrying an HTML login
      // page or a JSON envelope would still become a 0-byte-looking download.
      // Check the actual magic bytes before touching the user's disk.
      const header = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      if (!hasPdfHeader(header)) {
        fail(copy.notPdf);
        return;
      }

      const filename = resolveInsurancePackFilename(
        res.headers.get('Content-Disposition'),
      );
      triggerDownload(blob, filename);
      setState('success');
      setError(null);
      toast.success(copy.success);
    } catch {
      fail(copy.failure);
    }
  };

  const busy = state === 'downloading';

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{copy.description}</p>

      {/* Why the document is not in the UI language. Read before the click so
          an English user does not report the Vietnamese PDF as a bug. */}
      <div className="flex items-start gap-3 rounded-md bg-amber-soft p-3.5 text-sm text-amber-ink">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>{copy.vietnameseNote}</p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border-[1.5px] border-border bg-surface-2 p-4">
        <input
          type="checkbox"
          checked={includeSold}
          disabled={busy}
          onChange={(e) => {
            setIncludeSold(e.target.checked);
            setState('idle');
            setError(null);
          }}
          className="mt-1 h-4 w-4 shrink-0 accent-primary"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">
            {copy.includeSold}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {copy.includeSoldHint}
          </span>
        </span>
      </label>

      <p className="text-xs font-medium text-muted-foreground">{copy.scope}</p>

      <Button
        type="button"
        onClick={() => void handleDownload()}
        disabled={busy}
        className="rounded-pill"
        size="lg"
      >
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        {busy ? copy.busy : copy.button}
      </Button>

      <div aria-live="polite">
        {state === 'error' && error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md bg-destructive-soft p-3.5 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}
        {state === 'success' && (
          <div className="flex items-start gap-3 rounded-md bg-emerald-soft p-3.5 text-sm text-emerald-ink">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{copy.success}</p>
          </div>
        )}
      </div>
    </div>
  );
}
