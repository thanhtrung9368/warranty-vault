'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Info,
  Link2,
  Loader2,
  Plus,
  ShieldOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createDeviceShare, revokeDeviceShare } from '@/app/actions/shares';
import type { CreatedDeviceShare, DeviceShare } from '@/lib/api/shares';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  CERTIFICATE_NEVER_SHOWN,
  CERTIFICATE_PROJECTION_TITLE,
  CERTIFICATE_SHOWS,
  MAX_ACTIVE_SHARES_PER_DEVICE,
  SHARE_ACK_LABEL,
  SHARE_CLOSE_BLOCKED_HINT,
  SHARE_EXPIRY_CHOICES,
  SHARE_LIMIT_NOTE,
  SHARE_ONE_TIME_WARNING,
  SHARE_PREVIEW_NOTE,
  SHARE_SECTION_HINT,
  SHARE_SERIAL_LABEL,
  SHARE_SERIAL_OFF_NOTE,
  SHARE_SERIAL_ON_NOTE,
  SHARE_TTL_DEFAULT_DAYS,
  shareCapacity,
  shareIsLive,
  shareRemainingLabel,
  shareSerialExposureLabel,
  shareStatusLabel,
  shareStatusTone,
  shareViewLabel,
  splitShares,
} from '@/lib/share-links';

/**
 * "Phiếu bàn giao & link chia sẻ" — the owner half of FEATURE_IDEAS #2.
 *
 * The list is server-rendered (`GET /v1/devices/{id}/shares`, dead rows
 * included) and this component only adds the two mutations plus the ONE-TIME
 * link reveal.
 *
 * The one-time rule is enforced by the UI in four places, because the server
 * genuinely cannot help after the response:
 *   1. a warning box BEFORE the create button is pressed;
 *   2. a second, louder warning while the token is on screen;
 *   3. the dialog refuses to close (X, ESC, click-outside) until the owner
 *      either copies the link or ticks the acknowledgement;
 *   4. the close button itself is disabled until that acknowledgement.
 * Closing without copying is therefore a deliberate act, never an accident.
 */
export function DeviceShares({
  deviceId,
  deviceName,
  shares,
  unavailable = false,
}: {
  deviceId: string;
  deviceName: string;
  shares: DeviceShare[];
  unavailable?: boolean;
}) {
  const router = useRouter();
  const capacity = shareCapacity(shares);
  const { live, dead } = splitShares(shares);

  const [open, setOpen] = React.useState(false);
  const [expiryDays, setExpiryDays] = React.useState<number>(SHARE_TTL_DEFAULT_DAYS);
  const [includeSerial, setIncludeSerial] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<{ url: string; share: CreatedDeviceShare } | null>(
    null,
  );
  const [copied, setCopied] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  const urlRef = React.useRef<HTMLInputElement>(null);

  const resetDialog = React.useCallback(() => {
    setCreated(null);
    setCopied(false);
    setAck(false);
    setBlocked(false);
    setPending(false);
    setExpiryDays(SHARE_TTL_DEFAULT_DAYS);
    setIncludeSerial(false);
  }, []);

  // Radix funnels the X button, ESC and click-outside through here. While the
  // one-time link is on screen we refuse to close until the owner has copied it
  // or explicitly acknowledged that it is gone — and we say why, in the dialog.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setOpen(true);
      return;
    }
    if (created && !ack) {
      setBlocked(true);
      return;
    }
    const wasCreated = created !== null;
    setOpen(false);
    resetDialog();
    if (wasCreated) router.refresh();
  };

  const submit = async () => {
    setPending(true);
    try {
      const res = await createDeviceShare(deviceId, { expiresInDays: expiryDays, includeSerial });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setCreated({ url: res.url, share: res.share });
      setCopied(false);
      setAck(false);
      setBlocked(false);
    } catch {
      toast.error('Không tạo được link chia sẻ, thử lại sau');
    } finally {
      setPending(false);
    }
  };

  const copyLink = async () => {
    if (!created) return;
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('clipboard_unavailable');
      }
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      setBlocked(false);
      toast.success('Đã sao chép link chia sẻ');
    } catch {
      // Never leave the user without a path: select the text so Ctrl/Cmd+C works.
      urlRef.current?.focus();
      urlRef.current?.select();
      toast.error(
        'Không tự sao chép được — link đã được chọn, bấm Ctrl/Cmd + C để chép rồi gửi ngay.',
      );
    }
  };

  const revoke = (shareId: string) => {
    if (
      !confirm(
        'Thu hồi link này? Người đang giữ link sẽ không mở được phiếu nữa. Không thể hoàn tác.',
      )
    ) {
      return;
    }
    setRevokingId(shareId);
    void (async () => {
      try {
        const res = await revokeDeviceShare(shareId, deviceId);
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        toast.success(res.message);
        router.refresh();
      } catch {
        toast.error('Không thu hồi được link chia sẻ, thử lại sau');
      } finally {
        setRevokingId(null);
      }
    })();
  };

  return (
    <div className="space-y-4">
      {/* Visible before any dialog is opened: what a share link is, and that the
          token is a one-shot credential. */}
      <div className="rounded-xl border-[1.5px] border-dashed border-border bg-surface-2 p-3 text-xs text-ink-2">
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>{SHARE_SECTION_HINT}</span>
        </p>
        <p className="mt-1.5 pl-[22px] text-muted-foreground">{SHARE_LIMIT_NOTE}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          <span className="font-semibold text-ink">{capacity.liveCount}</span>/
          {MAX_ACTIVE_SHARES_PER_DEVICE} link còn hiệu lực
          {capacity.full && (
            <span className="text-muted-foreground"> — đã đạt giới hạn, thu hồi bớt để tạo thêm</span>
          )}
        </p>

        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-pill" disabled={capacity.full}>
              <Plus className="mr-1.5 h-4 w-4" />
              Tạo link chia sẻ
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl border-[1.5px]">
            {created ? (
              <CreatedSharePanel
                url={created.url}
                share={created.share}
                copied={copied}
                ack={ack}
                blocked={blocked}
                urlRef={urlRef}
                onCopy={copyLink}
                onAck={(value) => {
                  setAck(value);
                  if (value) setBlocked(false);
                }}
                onClose={() => handleOpenChange(false)}
              />
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Link2 className="h-5 w-5 shrink-0 text-primary" />
                    <span className="truncate">Tạo link chia sẻ cho “{deviceName}”</span>
                  </DialogTitle>
                  <DialogDescription>
                    Link chỉ-đọc cho đúng thiết bị này, mở được không cần đăng nhập. Dùng khi bán
                    máy hoặc khi đưa máy cho người khác đi bảo hành.
                  </DialogDescription>
                </DialogHeader>

                {/* Warning #1 — before the token exists. */}
                <div
                  role="alert"
                  className="rounded-xl border-[1.5px] border-destructive/40 bg-destructive-soft p-3 text-destructive"
                >
                  <p className="flex items-center gap-2 font-display text-sm font-bold">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Link chỉ hiện MỘT LẦN
                  </p>
                  <p className="mt-1 text-sm leading-relaxed">{SHARE_ONE_TIME_WARNING}</p>
                </div>

                <div className="space-y-4 pt-1">
                  <div className="space-y-2">
                    <Label htmlFor="share-expiry">Link sống trong bao lâu</Label>
                    <Select
                      value={String(expiryDays)}
                      onValueChange={(v) => setExpiryDays(Number(v))}
                    >
                      <SelectTrigger id="share-expiry">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SHARE_EXPIRY_CHOICES.map((choice) => (
                          <SelectItem key={choice.days} value={String(choice.days)}>
                            {choice.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Hết hạn là link ngừng hoạt động. Không có lựa chọn vĩnh viễn, và bạn luôn thu
                      hồi được trước hạn.
                    </p>
                  </div>

                  <div className="space-y-2 rounded-xl border-[1.5px] border-border p-3">
                    <label htmlFor="share-serial" className="flex cursor-pointer items-start gap-2.5">
                      <input
                        id="share-serial"
                        type="checkbox"
                        checked={includeSerial}
                        onChange={(e) => setIncludeSerial(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="text-[13px] font-semibold text-ink-2">
                        {SHARE_SERIAL_LABEL}
                      </span>
                    </label>
                    <p
                      className={cn(
                        'pl-[26px] text-xs leading-relaxed',
                        includeSerial ? 'text-amber-ink' : 'text-muted-foreground',
                      )}
                    >
                      {includeSerial ? SHARE_SERIAL_ON_NOTE : SHARE_SERIAL_OFF_NOTE}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border-[1.5px] border-border bg-surface-2 p-3">
                      <p className="font-display text-sm font-bold text-ink">
                        {CERTIFICATE_PROJECTION_TITLE}
                      </p>
                      <ul className="mt-2 space-y-1.5 text-xs text-ink-2">
                        {CERTIFICATE_SHOWS.map((line) => (
                          <li key={line} className="flex items-start gap-1.5">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-ink" />
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl border-[1.5px] border-border bg-surface-2 p-3">
                      <p className="font-display text-sm font-bold text-ink">
                        Không bao giờ có trong phiếu
                      </p>
                      <ul className="mt-2 space-y-1.5 text-xs text-ink-2">
                        {CERTIFICATE_NEVER_SHOWN.map((line) => (
                          <li key={line} className="flex items-start gap-1.5">
                            <ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    className="rounded-pill border-border-strong"
                    onClick={() => handleOpenChange(false)}
                    disabled={pending}
                  >
                    Huỷ
                  </Button>
                  <Button className="rounded-pill" onClick={submit} disabled={pending}>
                    {pending ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="mr-1.5 h-4 w-4" />
                    )}
                    Tạo link
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {unavailable ? (
        <p className="text-sm text-muted-foreground">
          Không tải được danh sách link chia sẻ — thử tải lại trang nhé.
        </p>
      ) : shares.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Chưa có link chia sẻ nào. Tạo link khi bạn cần đưa phiếu bàn giao bảo hành cho người mua.
        </p>
      ) : (
        <>
          {live.length > 0 && (
            <ul>
              {live.map((share, i) => (
                <ShareRow
                  key={share.id}
                  share={share}
                  first={i === 0}
                  revoking={revokingId === share.id}
                  onRevoke={() => revoke(share.id)}
                />
              ))}
            </ul>
          )}

          {dead.length > 0 && (
            <details className="rounded-xl border-[1.5px] border-border bg-surface-2 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-ink-2">
                Link đã hết hạn hoặc đã thu hồi ({dead.length})
              </summary>
              <ul className="mt-2">
                {dead.map((share) => (
                  <ShareRow key={share.id} share={share} first={false} muted />
                ))}
              </ul>
            </details>
          )}

          {live.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Không còn link nào đang hoạt động. Người nhận cũ mở link cũ sẽ thấy thông báo link
              không còn hiệu lực.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The one-time reveal. It owns no state: the parent keeps the token, the copy
 * acknowledgement and the close gate, so the warning cannot be dismissed by a
 * re-render.
 *
 * Exported for the render test in `src/components/__tests__/` — it has no hooks
 * and no browser APIs, so `renderToStaticMarkup` can pin the warning copy and
 * the disabled-until-acknowledged close button without a DOM.
 */
export function CreatedSharePanel({
  url,
  share,
  copied,
  ack,
  blocked,
  urlRef,
  onCopy,
  onAck,
  onClose,
}: {
  url: string;
  share: CreatedDeviceShare;
  copied: boolean;
  ack: boolean;
  blocked: boolean;
  urlRef: React.RefObject<HTMLInputElement | null>;
  onCopy: () => void;
  onAck: (value: boolean) => void;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Check className="h-5 w-5 text-emerald-ink" />
          Đã tạo link chia sẻ
        </DialogTitle>
        <DialogDescription>
          Gửi link dưới đây cho người nhận. Họ mở được ngay, không cần đăng nhập.
        </DialogDescription>
      </DialogHeader>

      {/* Warning #2 — while the token is on screen. Louder than the form one. */}
      <div
        role="alert"
        className="rounded-xl border-[2px] border-destructive bg-destructive-soft p-3 text-destructive"
      >
        <p className="flex items-center gap-2 font-display text-sm font-bold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Đây là lần duy nhất link hiện ra
        </p>
        <p className="mt-1 text-sm leading-relaxed">{SHARE_ONE_TIME_WARNING}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="share-url">Link gửi cho người nhận</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="share-url"
            ref={urlRef}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
            aria-describedby="share-url-note"
          />
          <Button
            type="button"
            onClick={onCopy}
            className={cn('rounded-pill sm:shrink-0', copied && 'bg-emerald-ink border-emerald-ink')}
          >
            {copied ? (
              <Check className="mr-1.5 h-4 w-4" />
            ) : (
              <Copy className="mr-1.5 h-4 w-4" />
            )}
            {copied ? 'Đã sao chép' : 'Sao chép link'}
          </Button>
        </div>
        <p id="share-url-note" className="text-xs text-muted-foreground">
          {SHARE_PREVIEW_NOTE}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border-[1.5px] border-border bg-surface-2 p-3 text-xs text-ink-2">
        <Button asChild variant="outline" size="sm" className="rounded-pill border-border-strong">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Mở phiếu (xem trước)
          </a>
        </Button>
        <span className="text-muted-foreground">
          Hết hạn {formatDate(share.expiresAt)} • {shareSerialExposureLabel(share.includeSerial)}
        </span>
      </div>

      {/* Closing gate: acknowledgement #3/#4. */}
      <label
        htmlFor="share-ack"
        className={cn(
          'flex cursor-pointer items-start gap-2.5 rounded-xl border-[1.5px] p-3 text-sm',
          ack ? 'border-emerald-ink/50 bg-emerald-soft' : 'border-border bg-card',
        )}
      >
        <input
          id="share-ack"
          type="checkbox"
          checked={ack}
          onChange={(e) => onAck(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span className="text-ink-2">{SHARE_ACK_LABEL}</span>
      </label>

      {blocked && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {SHARE_CLOSE_BLOCKED_HINT}
        </p>
      )}

      <DialogFooter>
        <Button className="rounded-pill" onClick={onClose} disabled={!ack}>
          Đóng
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * One row of the share list. Exported alongside `CreatedSharePanel` for the
 * render test: the status/exposure wording and "revoke only a live link" rule
 * are worth pinning literally.
 */
export function ShareRow({
  share,
  first = false,
  muted = false,
  revoking = false,
  onRevoke,
}: {
  share: DeviceShare;
  first?: boolean;
  muted?: boolean;
  revoking?: boolean;
  onRevoke?: () => void;
}) {
  const live = shareIsLive(share);
  const remaining = shareRemainingLabel(share);
  return (
    <li className={cn('info-row flex flex-wrap items-center gap-3 py-3', first && '!border-t-0 pt-0')}>
      <span className={cn('icon-badge icon-badge-sm', live ? 'tint-emerald' : 'tint-zinc')}>
        <Link2 className="h-4 w-4" />
      </span>
      <div className={cn('min-w-0 flex-1', muted && 'opacity-75')}>
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          Tạo ngày {formatDate(share.createdAt)}
          <Badge variant={shareStatusTone(share)}>{shareStatusLabel(share)}</Badge>
        </p>
        <p className="text-xs text-muted-foreground">
          Hết hạn {formatDate(share.expiresAt)}
          {remaining ? ` (${remaining})` : ''} • {shareViewLabel(share.viewCount)} •{' '}
          {shareSerialExposureLabel(share.includeSerial)}
        </p>
        {share.lastViewedAt && (
          <p className="text-xs text-muted-foreground">
            Mở lần cuối {formatDate(share.lastViewedAt)}
          </p>
        )}
      </div>
      {onRevoke && live && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-pill border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive"
          disabled={revoking}
          aria-label={`Thu hồi link tạo ngày ${formatDate(share.createdAt)}`}
          onClick={onRevoke}
        >
          {revoking ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldOff className="mr-1 h-3.5 w-3.5" />
          )}
          Thu hồi
        </Button>
      )}
    </li>
  );
}
