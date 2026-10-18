// Native barcode scanning for the serial / IMEI field.
//
// The web has exactly one browser-native path here: the Shape Detection API's
// `BarcodeDetector`. It is a Chromium feature — Safari and Firefox do not ship
// it — so this module is deliberately small and every browser-specific decision
// is made in ONE place. The UI never guesses from the user agent: it asks
// `supportsSerialScan(window)` and renders the scan button only when the answer
// is yes.
//
// What is in here (and therefore unit-testable):
//   * the feature-detection predicate,
//   * the formats we ask the detector for, narrowed to what the browser reports,
//   * the pure post-processing of a decoded payload (a QR code is not
//     necessarily a serial number),
//   * camera-error classification, so the component only maps a code to copy.
//
// What is NOT in here: `getUserMedia`, the `<video>` element, the detector loop.
// Those are browser APIs and cannot run in this test environment (node, no DOM,
// no camera); `components/serial-scanner.tsx` owns them and is untested.

/** The formats that matter for device labels, boxes and warranty cards. */
export const BARCODE_FORMATS = [
  'code_128',
  'ean_13',
  'ean_8',
  'qr_code',
  'data_matrix',
] as const;

export type BarcodeFormat = (typeof BARCODE_FORMATS)[number];

/** One decoded barcode, as the native detector returns it. */
export type DetectedBarcode = {
  rawValue: string;
  format?: string;
};

/**
 * The slice of the native `BarcodeDetector` this app uses.
 *
 * `lib.dom` has no declaration for it (it is not a web standard yet), so the
 * shape is declared here instead of adding a global `declare`.
 */
export type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement | ImageBitmap | Blob | ImageData): Promise<DetectedBarcode[]>;
};

export type BarcodeDetectorConstructor = {
  new (options?: { formats?: readonly string[] }): BarcodeDetectorLike;
  /** Optional static helper — present in Chromium, used to avoid a hard throw. */
  getSupportedFormats?: () => Promise<string[]>;
};

/**
 * Structural shape used by the pure feature detection.
 *
 * `Window` is passed in the browser; a plain object is passed in the tests. The
 * helper never touches a global itself, which is what keeps it safe under SSR.
 */
export type BarcodeScanEnvironment = {
  BarcodeDetector?: unknown;
  isSecureContext?: boolean;
  navigator?: {
    mediaDevices?: {
      getUserMedia?: unknown;
    };
  };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `'BarcodeDetector' in window` plus a function check.
 *
 * The `in` test is what the requirement asks for (and the reason this lives in
 * one helper): a browser can expose the property as `undefined` after a
 * half-shipped implementation, and rendering a button for that would be the
 * "camera opens and silently fails" failure mode this feature is supposed to
 * avoid.
 */
export function hasBarcodeDetector(environment: unknown): boolean {
  if (!isObject(environment)) return false;
  return (
    'BarcodeDetector' in environment &&
    typeof environment.BarcodeDetector === 'function'
  );
}

/**
 * Can this browser actually offer the scan action?
 *
 * Three independent gates, all required:
 *   1. native `BarcodeDetector` (Chromium; not Safari, not Firefox);
 *   2. a secure context — `getUserMedia` only exists on HTTPS and localhost;
 *   3. `navigator.mediaDevices.getUserMedia` (some embedded webviews expose
 *      the detector but not the camera).
 *
 * `isSecureContext` is required to be exactly `true`: if an environment cannot
 * answer the question, the honest default is "do not offer the feature".
 */
export function supportsSerialScan(environment: unknown): boolean {
  if (!hasBarcodeDetector(environment)) return false;
  const env = environment as BarcodeScanEnvironment;
  if (env.isSecureContext !== true) return false;
  return typeof env.navigator?.mediaDevices?.getUserMedia === 'function';
}

/**
 * Intersect the formats we want with the ones the browser reports.
 *
 * `null`/`undefined` means the browser has no `getSupportedFormats` helper; in
 * that case we ask for the full list and let the constructor decide (a throw is
 * handled as "unsupported format" in the scanner). An EMPTY supported list
 * means the browser is telling us it can decode nothing, so the caller must not
 * construct a detector at all.
 *
 * The result keeps `BARCODE_FORMATS` order, which makes the UI copy stable.
 */
export function resolveScanFormats(
  supported: readonly string[] | null | undefined,
): BarcodeFormat[] {
  if (supported == null) return [...BARCODE_FORMATS];
  const allowed = new Set(supported);
  return BARCODE_FORMATS.filter((format) => allowed.has(format));
}

export type SerialScanResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'url'; length: number };

/**
 * The OCR path caps a draft serial at 120 BYTES
 * (`api/internal/services/ai_extract.go::maxDraftSerialBytes`). A serial/IMEI
 * is ASCII, so a 120-character JS-string cap is the same ceiling for every
 * value this scanner should accept; a 120-emoji payload is rejected even later.
 */
export const MAX_SCANNED_SERIAL_CHARS = 120;

/**
 * A scanned serial is a DRAFT, and a QR code is often not a serial at all.
 *
 * Rules, each one chosen against a real failure:
 *   * only the first non-empty line is used — a QR may contain several lines of
 *     warranty text, and the IMEI is conventionally first;
 *   * a leading label (`IMEI:`, `S/N:`, `Serial:`) is stripped, because the
 *     scanner should not put the word "IMEI" into the field;
 *   * whitespace is removed — labels print IMEIs in groups ("356938 035643
 *     809"), but the API and service centres compare digits;
 *   * URLs are rejected rather than pasted into the serial field;
 *   * the same 120-character ceiling as the OCR draft is applied. Anything
 *     longer is a payload, not a serial, and the user is told to type it in.
 *
 * Case is preserved: most serials are uppercase, but case is meaningful on
 * some manufacturer labels and silently changing it would make the stored value
 * disagree with the sticker.
 */
export function normalizeScannedSerial(raw: string): SerialScanResult {
  const text = typeof raw === 'string' ? raw.normalize('NFKC') : '';
  const lines = text.split(/\r?\n/);
  let value = '';

  for (const line of lines) {
    const cleaned = line
      // Zero-width characters are invisible in a barcode payload but would be
      // stored forever, so they are dropped before anything else.
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .trim();
    if (cleaned !== '') {
      value = cleaned;
      break;
    }
  }

  // Labels are only stripped at the start; a serial that happens to contain
  // "SN" in the middle must survive untouched.
  value = value
    .replace(
      /^(?:imei|s\/?n|serial(?:\s*(?:number|no\.?))?|số serial|so serial|mã máy|ma may)\s*[:#：-]\s*/i,
      '',
    )
    .trim();

  if (value === '') {
    return { ok: false, reason: 'empty', length: 0 };
  }

  if (/^(?:https?:\/\/|www\.)/i.test(value)) {
    return { ok: false, reason: 'url', length: value.length };
  }

  // Whitespace inside a serial is a grouping character, never part of the
  // identifier the service centre types in.
  const compact = value.replace(/\s+/g, '');

  if (compact.length > MAX_SCANNED_SERIAL_CHARS) {
    return { ok: false, reason: 'too-long', length: compact.length };
  }

  return { ok: true, value: compact };
}

function errorName(error: unknown): string {
  if (!isObject(error)) return '';
  const name = error.name;
  return typeof name === 'string' ? name : '';
}

/**
 * The barcode detector reports "nothing in this frame" as a `NotFoundException`.
 * That is the normal state while the user aims the camera, not an error.
 */
export function isDetectorMiss(error: unknown): boolean {
  const name = errorName(error);
  return name === 'NotFoundException' || name === 'NotFoundError';
}

/**
 * Some builds accept the constructor call but reject `detect()` when the frame
 * or format turns out to be unsupported. That is the same user-facing problem
 * as a constructor throw — the browser cannot scan this code — so it gets the
 * same message rather than the generic "hold steady" one.
 */
export function isDetectorFormatError(error: unknown): boolean {
  const name = errorName(error);
  return name === 'NotSupportedError' || name === 'TypeError';
}

export type CameraFailure = 'permission' | 'not-found' | 'busy' | 'unknown';

/**
 * Map a `getUserMedia` rejection to the four cases the UI has copy for.
 *
 * The names are the DOMException names browsers actually use, including the
 * legacy prefixed ones still seen in older webviews. Classification is pure so
 * the messages can be tested through `translate` without a camera.
 */
export function classifyCameraError(error: unknown): CameraFailure {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'permission';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'not-found';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      return 'unknown';
  }
}
