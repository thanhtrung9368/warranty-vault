'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  Share2,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cancelHandoff, createHandoff } from '@/app/actions/handoff';
import type { DeviceHandoffState } from '@/lib/api/handoff';
import { formatDate } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/client';
import {
  HANDOFF_ACK_LABEL,
  HANDOFF_CLOSE_BLOCKED_HINT,
  HANDOFF_CODE_ONE_TIME,
  HANDOFF_COOLDOWN_DAYS,
  HANDOFF_COOLDOWN_NOTE,
  HANDOFF_IS_DATA_ONLY,
  HANDOFF_NEVER_TRAVELS,
  HANDOFF_NO_PAYMENT,
  HANDOFF_ONE_TIME_NOTE,
  HANDOFF_TRAVELS,
  HANDOFF_TTL_DAYS,
  HANDOFF_UNCLAIMED_NOTE,
  effectiveHandoffStatus,
  handoffCooldown,
  handoffExpiryLabel,
  handoffRemainingLabel,
  handoffStatusLabel,
  handoffStatusTone,
} from '@/lib/handoff';
import { cn } from '@/lib/utils';

type AttachmentChoice = { id: string; fileName: string };

type Created = {
  handoffId: string;
  code: string;
  url: string;
  expiresAt: string;
};

/**
 * "Chuyển chủ" — the seller's half of the 2.0 resale handoff.
 *
 * The component is the device page's action button plus ONE dialog; the page
 * hands it the server's current handoff state (`GET /devices/{id}/handoff`, no
 * code) so the dialog can say "đang chờ", "đã chuyển", or "còn N ngày" instead
 * of offering a create button that the server would refuse.
 *
 * The code is a one-shot credential: it exists only in the create response.
 * The reveal therefore blocks the dialog from closing until the seller has
 * copied/shared it or ticked the acknowledgement — the same rule (and the same
 * reason) as the handover-certificate share dialog.
 */
export function DeviceHandoff({
  deviceId,
  deviceName,
  warrantyCount,
  attachments,
  state,
  unavailable = false,
}: {
  deviceId: string;
  deviceName: string;
  warrantyCount: number;
  attachments: AttachmentChoice[];
  state: DeviceHandoffState;
  unavailable?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();

  const handoff = state.handoff;
  const status = handoff ? effectiveHandoffStatus(handoff) : null;
  const live = status === 'PENDING';
  const claimed = status === 'CLAIMED';
  const cooldown = claimed ? null : handoffCooldown(state.nextAllowedAt);
  const canCreate = !unavailable && !live && !claimed;

  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [created, setCreated] = React.useState<Created | null>(null);
  const [copiedCode, setCopiedCode] = React.useState(false);
  const [copiedLink, setCopiedLink] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  const urlRef = React.useRef<HTMLInputElement>(null);

  const resetDialog = React.useCallback(() => {
    setPending(false);
    setCancelling(false);
    setSelected([]);
    setCreated(null);
    setCopiedCode(false);
    setCopiedLink(false);
    setAck(false);
    setBlocked(false);
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setOpen(true);
      return;
    }
    // Radix funnels X, ESC and click-outside through here.
    if (created && !ack) {
      setBlocked(true);
      return;
    }
    const wasCreated = created !== null;
    setOpen(false);
    resetDialog();
    if (wasCreated) router.refresh();
  };

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const submit = async () => {
    setPending(true);
    try {
      const res = await createHandoff(deviceId, selected);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setCreated({
        handoffId: res.handoffId,
        code: res.code,
        url: res.url,
        expiresAt: res.expiresAt,
      });
      setCopiedCode(false);
      setCopiedLink(false);
      setAck(false);
      setBlocked(false);
    } catch {
      toast.error(t('Không tạo được mã chuyển chủ, thử lại sau'));
    } finally {
      setPending(false);
    }
  };

  const cancel = () => {
    if (
      !confirm(
        t(
          'Huỷ mã này? Người đang giữ link sẽ không nhận được thiết bị nữa. Không thể hoàn tác.',
        ),
      )
    ) {
      return;
    }
    setCancelling(true);
    void (async () => {
      try {
        const res = await cancelHandoff(deviceId);
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        toast.success(res.message);
        setOpen(false);
        resetDialog();
        router.refresh();
      } catch {
        toast.error(t('Không huỷ được mã chuyển chủ, thử lại sau'));
      } finally {
        setCancelling(false);
      }
    })();
  };

  const copy = async (text: string, kind: 'code' | 'link') => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('clipboard_unavailable');
      }
      await navigator.clipboard.writeText(text);
      if (kind === 'code') {
        setCopiedCode(true);
        toast.success(t('Đã sao chép mã'));
      } else {
        setCopiedLink(true);
        toast.success(t('Đã sao chép link'));
      }
      setBlocked(false);
    } catch {
      if (kind === 'link') {
        urlRef.current?.focus();
        urlRef.current?.select();
      }
      toast.error(
        kind === 'code'
          ? t('Không tự sao chép được — hãy chọn mã và chép thủ công.')
          : t(
              'Không tự sao chép được — link đã được chọn, bấm Ctrl/Cmd + C để chép rồi gửi ngay.',
            ),
      );
    }
  };

  const share = async () => {
    if (!created) return;
    const data = {
      title: t('Chuyển chủ “{name}”', { name: deviceName }),
      text: t('Mã chuyển chủ: {code}', { code: created.code }),
      url: created.url,
    };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        // Closing the native sheet is not an error worth a toast.
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
      }
    }
    await copy(created.url, 'link');
  };

  const triggerLabel = live
    ? t('Mã đang chờ người nhận')
    : claimed
      ? t('Đã chuyển')
      : t('Chuyển chủ');

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-pill">
          <ArrowRightLeft className="mr-1 h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-lg border-[1.5px]">
        {created ? (
          <CreatedPanel
            created={created}
            deviceName={deviceName}
            copiedCode={copiedCode}
            copiedLink={copiedLink}
            ack={ack}
            blocked={blocked}
            urlRef={urlRef}
            onCopyCode={() => copy(created.code, 'code')}
            onCopyLink={() => copy(created.url, 'link')}
            onShare={share}
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
                <ArrowRightLeft className="h-5 w-5 shrink-0 text-primary" />
                <span className="truncate">
                  {t('Chuyển chủ “{name}”', { name: deviceName })}
                </span>
              </DialogTitle>
              <DialogDescription>
                {t(
                  'Giao hồ sơ thiết bị cho người mua. Mã chỉ dùng một lần, người nhận phải đăng nhập Warrly để nhận.',
                )}
              </DialogDescription>
            </DialogHeader>

            {unavailable ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('Không tải được trạng thái chuyển chủ — tải lại trang nhé.')}
                </p>
                <DialogFooter>
                  <Button
                    variant="outline"
                    className="rounded-pill"
                    onClick={() => handleOpenChange(false)}
                  >
                    {t('Đóng')}
                  </Button>
                </DialogFooter>
              </div>
            ) : live && handoff ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={handoffStatusTone('PENDING')}>
                    {handoffStatusLabel('PENDING', locale)}
                  </Badge>
                  <span className="text-sm text-ink-2">
                    {t('Tạo ngày {date}', {
                      date: formatDate(handoff.createdAt, locale),
                    })}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-ink-2">
                  {t(
                    'Người nhận mở link, đăng nhập và bấm nhận. Bạn không cần làm gì thêm.',
                  )}
                </p>
                <div className="rounded-xl border-[1.5px] border-border bg-surface-2 p-3 text-sm text-ink-2">
                  <p>
                    {handoffExpiryLabel(handoff.expiresAt, locale)}
                    {handoffRemainingLabel(handoff.expiresAt, locale)
                      ? ` • ${handoffRemainingLabel(handoff.expiresAt, locale)}`
                      : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(
                      'Mã chỉ hiện một lần lúc tạo nên không xem lại được. Nếu gửi nhầm, hãy huỷ mã.',
                    )}
                  </p>
                </div>
                <div className="rounded-xl border-[1.5px] border-dashed border-border p-3 text-xs text-muted-foreground">
                  <p className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-ink" />
                    <span>{t(HANDOFF_IS_DATA_ONLY)}</span>
                  </p>
                  <p className="mt-1.5 flex items-start gap-2">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{t(HANDOFF_NO_PAYMENT)}</span>
                  </p>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    className="rounded-pill"
                    onClick={() => handleOpenChange(false)}
                  >
                    {t('Đóng')}
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-pill border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive"
                    onClick={cancel}
                    disabled={cancelling}
                  >
                    {cancelling ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <X className="mr-1.5 h-4 w-4" />
                    )}
                    {t('Huỷ mã')}
                  </Button>
                </DialogFooter>
              </div>
            ) : claimed && handoff ? (
              <div className="space-y-4">
                <Badge variant={handoffStatusTone('CLAIMED')}>
                  {handoffStatusLabel('CLAIMED', locale)}
                </Badge>
                <p className="text-sm leading-relaxed text-ink-2">
                  {t(
                    'Thiết bị này đã được chuyển cho người nhận. Bạn giữ một bản đã bán trong tài khoản.',
                  )}
                </p>
                {handoff.claimedAt && (
                  <div className="rounded-xl border-[1.5px] border-border bg-surface-2 p-3 text-sm text-ink-2">
                    {t('Đã chuyển ngày {date}', {
                      date: formatDate(handoff.claimedAt, locale),
                    })}
                  </div>
                )}
                <DialogFooter>
                  <Button
                    variant="outline"
                    className="rounded-pill"
                    onClick={() => handleOpenChange(false)}
                  >
                    {t('Đóng')}
                  </Button>
                </DialogFooter>
              </div>
            ) : !canCreate || cooldown ? (
              <div className="space-y-4">
                {status && status !== 'EXPIRED' && (
                  <Badge variant={handoffStatusTone(status)}>
                    {handoffStatusLabel(status, locale)}
                  </Badge>
                )}
                <p className="font-display text-sm font-bold text-ink">
                  {t('Chưa thể tạo mã mới')}
                </p>
                {handoff && (
                  <p className="text-sm text-ink-2">
                    {t('Mã trước tạo ngày {date}.', {
                      date: formatDate(handoff.createdAt, locale),
                    })}
                  </p>
                )}
                {cooldown && (
                  <p className="text-sm text-ink-2">
                    {t('Còn {days} ngày nữa mới tạo được mã mới.', {
                      days: cooldown.days,
                      count: cooldown.days,
                    })}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t(HANDOFF_COOLDOWN_NOTE, { days: HANDOFF_COOLDOWN_DAYS })}
                </p>
                <DialogFooter>
                  <Button
                    variant="outline"
                    className="rounded-pill"
                    onClick={() => handleOpenChange(false)}
                  >
                    {t('Đóng')}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <>
                <div className="space-y-4 pt-1">
                  <div
                    role="note"
                    className="rounded-xl border-[1.5px] border-border bg-surface-2 p-3"
                  >
                    <p className="flex items-start gap-2 text-sm font-semibold text-ink">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-ink" />
                      <span>{t(HANDOFF_IS_DATA_ONLY)}</span>
                    </p>
                    <p className="mt-1.5 flex items-start gap-2 pl-6 text-xs text-muted-foreground">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{t(HANDOFF_NO_PAYMENT)}</span>
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border-[1.5px] border-border bg-surface-2 p-3">
                      <p className="font-display text-sm font-bold text-ink">
                        {t('Hồ sơ sẽ chuyển')}
                      </p>
                      <ul className="mt-2 space-y-1.5 text-xs text-ink-2">
                        {HANDOFF_TRAVELS.map((line) => (
                          <li key={line} className="flex items-start gap-1.5">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-ink" />
                            <span>{t(line)}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {warrantyCount > 0
                          ? t('{count} gói bảo hành đi kèm', {
                              count: warrantyCount,
                            })
                          : t('Thiết bị chưa có gói bảo hành nào.')}
                      </p>
                    </div>
                    <div className="rounded-xl border-[1.5px] border-border bg-surface-2 p-3">
                      <p className="font-display text-sm font-bold text-ink">
                        {t('Không bao giờ chuyển')}
                      </p>
                      <ul className="mt-2 space-y-1.5 text-xs text-ink-2">
                        {HANDOFF_NEVER_TRAVELS.map((line) => (
                          <li key={line} className="flex items-start gap-1.5">
                            <ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span>{t(line)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {attachments.length > 0 && (
                    <div className="space-y-2 rounded-xl border-[1.5px] border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-ink">
                            {t('Tài liệu gửi kèm')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t(
                              'Không chọn tệp nào nghĩa là chỉ hồ sơ thiết bị được chuyển, không có tài liệu nào đi kèm.',
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-pill"
                            onClick={() =>
                              setSelected(attachments.map((item) => item.id))
                            }
                          >
                            {t('Chọn tất cả')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="rounded-pill"
                            onClick={() => setSelected([])}
                          >
                            {t('Bỏ chọn tất cả')}
                          </Button>
                        </div>
                      </div>
                      <ul className="space-y-1.5">
                        {attachments.map((item) => (
                          <li key={item.id}>
                            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1 py-1 hover:bg-surface-2">
                              <input
                                type="checkbox"
                                checked={selected.includes(item.id)}
                                onChange={() => toggle(item.id)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                              />
                              <span className="min-w-0 break-words text-sm text-ink-2">
                                {item.fileName}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        {t('{selected}/{total} tệp được chọn', {
                          selected: selected.length,
                          total: attachments.length,
                          count: attachments.length,
                        })}
                      </p>
                    </div>
                  )}

                  <div className="space-y-1.5 rounded-xl border-[1.5px] border-dashed border-border p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-ink-2">
                      {t('Mã chỉ hiện một lần lúc tạo — hãy sao chép hoặc chia sẻ ngay.')}
                    </p>
                    <p>{t(HANDOFF_ONE_TIME_NOTE, { days: HANDOFF_TTL_DAYS })}</p>
                    <p>{t(HANDOFF_COOLDOWN_NOTE, { days: HANDOFF_COOLDOWN_DAYS })}</p>
                    <p>{t(HANDOFF_UNCLAIMED_NOTE)}</p>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    className="rounded-pill border-border-strong"
                    onClick={() => handleOpenChange(false)}
                    disabled={pending}
                  >
                    {t('Huỷ')}
                  </Button>
                  <Button
                    className="rounded-pill"
                    onClick={submit}
                    disabled={pending}
                  >
                    {pending ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRightLeft className="mr-1.5 h-4 w-4" />
                    )}
                    {pending ? t('Đang tạo mã…') : t('Tạo mã chuyển chủ')}
                  </Button>
                </DialogFooter>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one-time reveal. It owns no state: the parent keeps the code, the
 * acknowledgement and the close gate.
 */
function CreatedPanel({
  created,
  deviceName,
  copiedCode,
  copiedLink,
  ack,
  blocked,
  urlRef,
  onCopyCode,
  onCopyLink,
  onShare,
  onAck,
  onClose,
}: {
  created: Created;
  deviceName: string;
  copiedCode: boolean;
  copiedLink: boolean;
  ack: boolean;
  blocked: boolean;
  urlRef: React.RefObject<HTMLInputElement | null>;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onShare: () => void;
  onAck: (value: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Check className="h-5 w-5 text-emerald-ink" />
          {t('Đã tạo mã chuyển chủ')}
        </DialogTitle>
        <DialogDescription>
          {t(
            'Gửi mã hoặc link dưới đây cho người mua. Họ đăng nhập Warrly để nhận thiết bị.',
          )}
        </DialogDescription>
      </DialogHeader>

      <div
        role="alert"
        className="rounded-xl border-[2px] border-destructive bg-destructive-soft p-3 text-destructive-ink"
      >
        <p className="flex items-center gap-2 font-display text-sm font-bold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t('Mã chỉ hiện một lần')}
        </p>
        <p className="mt-1 text-sm leading-relaxed">{t(HANDOFF_CODE_ONE_TIME)}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="handoff-code">{t('Mã chuyển chủ')}</Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id="handoff-code"
            readOnly
            value={created.code}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-lg font-bold tracking-[0.3em]"
            aria-describedby="handoff-code-note"
          />
          <Button
            type="button"
            onClick={onCopyCode}
            className={cn(
              'rounded-pill sm:shrink-0',
              copiedCode && 'bg-emerald-ink border-emerald-ink',
            )}
          >
            {copiedCode ? (
              <Check className="mr-1.5 h-4 w-4" />
            ) : (
              <Copy className="mr-1.5 h-4 w-4" />
            )}
            {copiedCode ? t('Đã sao chép mã') : t('Sao chép mã')}
          </Button>
        </div>
        <p id="handoff-code-note" className="text-xs text-muted-foreground">
          {handoffExpiryLabel(created.expiresAt, locale)}
          {handoffRemainingLabel(created.expiresAt, locale)
            ? ` • ${handoffRemainingLabel(created.expiresAt, locale)}`
            : ''}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="handoff-url">{t('Link nhận thiết bị')}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="handoff-url"
            ref={urlRef}
            readOnly
            value={created.url}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs"
            aria-describedby="handoff-url-note"
          />
          <Button
            type="button"
            onClick={onCopyLink}
            className={cn(
              'rounded-pill sm:shrink-0',
              copiedLink && 'bg-emerald-ink border-emerald-ink',
            )}
          >
            {copiedLink ? (
              <Check className="mr-1.5 h-4 w-4" />
            ) : (
              <Copy className="mr-1.5 h-4 w-4" />
            )}
            {copiedLink ? t('Đã sao chép link') : t('Sao chép link')}
          </Button>
        </div>
        <p id="handoff-url-note" className="text-xs text-muted-foreground">
          {t('Người nhận mở link, đăng nhập và bấm nhận. Bạn không cần làm gì thêm.')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border-[1.5px] border-border bg-surface-2 p-3 text-xs text-ink-2">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="rounded-pill border-border-strong"
        >
          <a href={created.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            {t('Mở link nhận thiết bị')}
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-pill border-border-strong"
          onClick={onShare}
        >
          <Share2 className="mr-1.5 h-3.5 w-3.5" />
          {t('Chia sẻ')}
        </Button>
        <span className="text-muted-foreground">{deviceName}</span>
      </div>

      <label
        htmlFor="handoff-ack"
        className={cn(
          'flex cursor-pointer items-start gap-2.5 rounded-xl border-[1.5px] p-3 text-sm',
          ack ? 'border-emerald-ink/50 bg-emerald-soft' : 'border-border bg-card',
        )}
      >
        <input
          id="handoff-ack"
          type="checkbox"
          checked={ack}
          onChange={(event) => onAck(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span className="text-ink-2">{t(HANDOFF_ACK_LABEL)}</span>
      </label>

      {blocked && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {t(HANDOFF_CLOSE_BLOCKED_HINT)}
        </p>
      )}

      <DialogFooter>
        <Button className="rounded-pill" onClick={onClose} disabled={!ack}>
          {t('Đóng')}
        </Button>
      </DialogFooter>
    </>
  );
}
