'use client';

// Camera preview + native `BarcodeDetector` loop for the serial / IMEI field.
//
// This is the untestable half of the feature: `getUserMedia`, the `<video>` and
// the detector all require a real browser. The pure decisions (feature
// detection, format narrowing, payload normalisation, error classification)
// live in `lib/serial-scan.ts` and are unit-tested; this component only wires
// them to the DOM.
//
// The dialog is MOUNTED ONLY WHILE OPEN by the caller. That is deliberate: the
// camera effect then starts on mount and the cleanup below is guaranteed to run
// on close, with no stale stream carried between openings.

import * as React from 'react';
import { AlertTriangle, Camera, Loader2, RotateCcw, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/lib/i18n/client';
import {
  BARCODE_FORMATS,
  classifyCameraError,
  isDetectorFormatError,
  isDetectorMiss,
  normalizeScannedSerial,
  resolveScanFormats,
  supportsSerialScan,
  type BarcodeDetectorConstructor,
  type BarcodeDetectorLike,
} from '@/lib/serial-scan';

export function SerialScanner({
  onClose,
  onScanned,
}: {
  onClose: () => void;
  onScanned: (value: string) => void;
}) {
  const t = useT();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const onScannedRef = React.useRef(onScanned);
  const [starting, setStarting] = React.useState(true);
  const [attempt, setAttempt] = React.useState(0);
  // A fatal camera/detector problem: the preview is replaced by the message.
  const [error, setError] = React.useState<string | null>(null);
  // A decoded payload that is not usable as a serial. The camera keeps running
  // so the user can simply scan another code.
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    onScannedRef.current = onScanned;
  }, [onScanned]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;

    const stopStream = () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
      if (video) video.srcObject = null;
    };

    const fail = (message: string) => {
      if (cancelled) return;
      cancelled = true;
      stopStream();
      setNotice(null);
      setError(message);
      setStarting(false);
    };

    const start = async () => {
      if (!supportsSerialScan(window)) {
        fail(t('Trình duyệt này không hỗ trợ quét mã vạch — nhập serial bằng tay.'));
        return;
      }

      let detector: BarcodeDetectorLike;
      try {
        const Detector = (
          window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
        ).BarcodeDetector;
        if (!Detector) {
          fail(t('Trình duyệt này không hỗ trợ quét mã vạch — nhập serial bằng tay.'));
          return;
        }

        let formats = [...BARCODE_FORMATS];
        if (typeof Detector.getSupportedFormats === 'function') {
          const supported = await Detector.getSupportedFormats();
          if (cancelled) return;
          formats = resolveScanFormats(supported);
          if (formats.length === 0) {
            fail(
              t(
                'Trình duyệt không quét được định dạng mã vạch này. Thử nhập serial bằng tay.',
              ),
            );
            return;
          }
        }

        detector = new Detector({ formats });
      } catch {
        // A constructor throw is exactly the "unsupported format" case: some
        // builds reject the whole option list when one format is unknown.
        fail(
          t('Trình duyệt không quét được định dạng mã vạch này. Thử nhập serial bằng tay.'),
        );
        return;
      }

      const mediaDevices = navigator.mediaDevices;
      const getUserMedia = mediaDevices?.getUserMedia?.bind(mediaDevices);
      if (!getUserMedia) {
        fail(t('Trình duyệt này không hỗ trợ quét mã vạch — nhập serial bằng tay.'));
        return;
      }

      try {
        stream = await getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (err) {
        const kind = classifyCameraError(err);
        fail(
          kind === 'permission'
            ? t(
                'Không có quyền dùng camera. Bật quyền camera cho trang này trong cài đặt trình duyệt rồi thử lại.',
              )
            : kind === 'not-found'
              ? t('Không tìm thấy camera nào trên thiết bị này.')
              : kind === 'busy'
                ? t(
                    'Camera đang được ứng dụng khác dùng. Đóng ứng dụng đó rồi thử lại.',
                  )
                : t('Không mở được camera. Thử lại sau.'),
        );
        return;
      }

      if (cancelled) {
        stopStream();
        return;
      }

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // `autoPlay` + `muted` normally makes this unnecessary; if the browser
        // still refuses, there is no useful recovery beyond the error state.
      }
      if (cancelled) return;
      setStarting(false);

      const tick = async () => {
        if (cancelled) return;
        try {
          const codes = await detector.detect(video);
          if (cancelled) return;
          const raw = codes.find((code) => typeof code.rawValue === 'string')?.rawValue;
          if (raw) {
            const result = normalizeScannedSerial(raw);
            if (result.ok) {
              cancelled = true;
              stopStream();
              // The caller puts this in the editable field. Nothing is saved.
              onScannedRef.current(result.value);
              return;
            }
            if (result.reason === 'too-long') {
              setNotice(
                t(
                  'Mã vừa quét quá dài ({count} ký tự) — có vẻ không phải serial. Nhập tay nếu cần.',
                  { count: result.length },
                ),
              );
            } else if (result.reason === 'url') {
              setNotice(
                t('Mã vừa quét là một đường dẫn, không phải serial. Nhập tay nếu cần.'),
              );
            }
            // `empty`: nothing readable in the payload; keep scanning.
          }
        } catch (err) {
          if (isDetectorMiss(err)) {
            // No barcode in this frame: the normal state while aiming.
          } else if (isDetectorFormatError(err)) {
            fail(
              t(
                'Trình duyệt không quét được định dạng mã vạch này. Thử nhập serial bằng tay.',
              ),
            );
            return;
          } else {
            fail(t('Không đọc được mã vạch. Giữ máy ổn định và thử lại.'));
            return;
          }
        }
        if (!cancelled) {
          timer = window.setTimeout(() => {
            void tick();
          }, 200);
        }
      };

      void tick();
    };

    void start();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stopStream();
    };
    // `t` is in the list because the messages are copy: switching language while
    // the dialog is open must show the new language. `attempt` restarts the
    // whole flow from the Retry button.
  }, [attempt, t]);

  const retry = () => {
    setError(null);
    setNotice(null);
    setStarting(true);
    setAttempt((n) => n + 1);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            {t('Quét serial / IMEI')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Dùng camera để đọc mã vạch trên tem máy hoặc hộp. Ảnh không rời khỏi thiết bị.',
            )}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl border-[1.5px] border-destructive/40 bg-destructive/5 px-6 text-center">
            <AlertTriangle className="h-7 w-7 text-destructive" />
            <p role="alert" className="text-sm font-medium text-ink">
              {error}
            </p>
          </div>
        ) : (
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              aria-label={t('Khung hình camera để quét mã vạch')}
              className="h-full w-full object-cover"
            />
            {starting ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm font-medium">{t('Đang mở camera…')}</p>
              </div>
            ) : (
              <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg bg-black/60 px-3 py-2 text-center text-xs font-medium text-white">
                {t(
                  'Đưa mã vạch vào khung hình. Định dạng thường gặp: Code 128, EAN-13, EAN-8, QR và Data Matrix.',
                )}
              </div>
            )}
          </div>
        )}

        {notice && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-xl bg-amber-soft px-3 py-2 text-xs font-medium text-amber-ink"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {notice}
          </p>
        )}

        {!error && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('Mã quét được chỉ điền vào ô serial — bạn vẫn sửa và kiểm tra trước khi lưu.')}
          </p>
        )}

        <DialogFooter>
          {error && (
            <Button type="button" variant="outline" className="rounded-pill" onClick={retry}>
              <RotateCcw className="mr-1 h-4 w-4" />
              {t('Thử lại')}
            </Button>
          )}
          <Button type="button" className="rounded-pill" onClick={onClose}>
            {t('Đóng')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
