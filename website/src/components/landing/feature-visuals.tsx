import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Six small illustrations for the landing feature grid.
 *
 * One visual language, stated so a seventh can be added without redesigning:
 *   * 320×240, solid fills only — NO strokes, NO gradients, NO filters,
 *     NO text inside the artwork;
 *   * the palette is exactly three design tokens: `--ink`, `--primary-soft`
 *     (large quiet shapes) and `--primary` (used by exactly ONE dot per
 *     composition — the thing to remember, the same device as the mark's
 *     date dot);
 *   * the subject is a Vietnamese household, not generic SaaS: the rice
 *     cooker, the air-conditioner remote, the motorbike key, the warranty
 *     booklet, the red invoice and the phone.
 *
 * The SVG is inline (no request, no raster, no stock photography) and
 * `aria-label` carries the alt text in the reader's language. The parent
 * card's copy is still the meaning; the illustration is a quiet aid.
 */

export type FeatureVisualSubject =
  | 'rice-cooker'
  | 'ac-remote'
  | 'motorbike-key'
  | 'warranty-booklet'
  | 'red-invoice'
  | 'phone';

type Props = {
  subject: FeatureVisualSubject;
  /** Translated alt text; the component never owns copy. */
  label: string;
  className?: string;
  style?: CSSProperties;
};

const INK = 'hsl(var(--ink))';
const SOFT = 'hsl(var(--primary-soft))';
const ACCENT = 'hsl(var(--primary))';
// Used only for holes where the artwork is drawn on the card surface. It is a
// token, not a literal colour, so dark mode flips with the card.
const CARD = 'hsl(var(--card))';

function Stage({ children }: { children: ReactNode }) {
  return (
    <>
      <ellipse cx="160" cy="210" rx="104" ry="12" fill={SOFT} />
      {children}
    </>
  );
}

function RiceCooker() {
  return (
    <Stage>
      {/* steam, then lid, then body — all solid shapes */}
      <circle cx="146" cy="46" r="7" fill={SOFT} />
      <circle cx="164" cy="34" r="9" fill={SOFT} />
      <circle cx="184" cy="46" r="7" fill={SOFT} />
      <rect x="128" y="58" width="64" height="14" rx="7" fill={SOFT} />
      <rect x="68" y="72" width="184" height="32" rx="16" fill={INK} />
      <rect x="78" y="94" width="164" height="108" rx="30" fill={INK} />
      <rect x="108" y="126" width="104" height="34" rx="17" fill={SOFT} />
      <circle cx="140" cy="143" r="8" fill={INK} />
      <rect x="158" y="136" width="36" height="10" rx="5" fill={INK} />
      {/* exactly one coral dot: the "keep warm" light */}
      <circle cx="222" cy="174" r="10" fill={ACCENT} />
    </Stage>
  );
}

function AcRemote() {
  return (
    <Stage>
      {/* the wall unit the remote belongs to */}
      <rect x="194" y="42" width="90" height="34" rx="17" fill={SOFT} />
      <rect x="208" y="80" width="62" height="8" rx="4" fill={SOFT} />
      <rect x="102" y="26" width="116" height="192" rx="30" fill={INK} />
      {/* screen */}
      <rect x="120" y="48" width="80" height="58" rx="12" fill={SOFT} />
      <rect x="136" y="66" width="48" height="8" rx="4" fill={INK} />
      <rect x="136" y="82" width="30" height="8" rx="4" fill={INK} />
      {/* buttons */}
      <circle cx="160" cy="128" r="16" fill={SOFT} />
      <circle cx="160" cy="128" r="6" fill={INK} />
      <rect x="128" y="158" width="28" height="14" rx="7" fill={SOFT} />
      <rect x="164" y="158" width="28" height="14" rx="7" fill={SOFT} />
      <rect x="128" y="184" width="64" height="14" rx="7" fill={SOFT} />
      {/* exactly one coral dot: the remembered deadline on the screen */}
      <circle cx="194" cy="58" r="8" fill={ACCENT} />
    </Stage>
  );
}

function MotorbikeKey() {
  return (
    <Stage>
      {/* key tag */}
      <g transform="rotate(-18 82 66)">
        <rect x="50" y="46" width="64" height="40" rx="13" fill={SOFT} />
        <circle cx="82" cy="66" r="6" fill={CARD} />
      </g>
      {/* bow + hole */}
      <circle cx="122" cy="120" r="52" fill={INK} />
      <circle cx="122" cy="120" r="20" fill={CARD} />
      {/* shaft + two teeth */}
      <rect x="168" y="110" width="112" height="20" rx="10" fill={INK} />
      <rect x="238" y="128" width="16" height="28" rx="5" fill={INK} />
      <rect x="264" y="128" width="16" height="18" rx="5" fill={INK} />
      {/* exactly one coral dot: the keyring stamp */}
      <circle cx="122" cy="82" r="9" fill={ACCENT} />
    </Stage>
  );
}

function WarrantyBooklet() {
  return (
    <Stage>
      {/* bookmark tucked under the cover */}
      <rect x="204" y="30" width="18" height="54" rx="9" fill={SOFT} />
      <rect x="84" y="34" width="152" height="184" rx="18" fill={INK} />
      <rect x="102" y="52" width="120" height="148" rx="10" fill={SOFT} />
      <rect x="118" y="74" width="88" height="12" rx="6" fill={INK} />
      <rect x="118" y="98" width="62" height="8" rx="4" fill={INK} />
      <rect x="118" y="114" width="74" height="8" rx="4" fill={INK} />
      <rect x="118" y="130" width="52" height="8" rx="4" fill={INK} />
      <rect x="118" y="158" width="44" height="8" rx="4" fill={INK} />
      {/* exactly one coral dot: the date stamp beside the signature line */}
      <circle cx="196" cy="166" r="15" fill={ACCENT} />
    </Stage>
  );
}

function RedInvoice() {
  return (
    <Stage>
      {/* torn-bottom invoice paper — the zigzag is a fill path, not a stroke */}
      <path
        d="M96 30H224V198L214 188L204 198L194 188L184 198L174 188L164 198L154 188L144 198L134 188L124 198L114 188L104 198L96 188Z"
        fill={INK}
      />
      <rect x="110" y="48" width="100" height="28" rx="6" fill={SOFT} />
      <rect x="110" y="90" width="76" height="9" rx="4" fill={SOFT} />
      <rect x="110" y="108" width="100" height="9" rx="4" fill={SOFT} />
      <rect x="110" y="126" width="58" height="9" rx="4" fill={SOFT} />
      <rect x="110" y="144" width="86" height="9" rx="4" fill={SOFT} />
      {/* exactly one coral dot: the red-ink stamp */}
      <circle cx="194" cy="166" r="16" fill={ACCENT} />
    </Stage>
  );
}

function Phone() {
  return (
    <Stage>
      <rect x="106" y="22" width="108" height="196" rx="26" fill={INK} />
      <rect x="118" y="34" width="84" height="172" rx="18" fill={SOFT} />
      <rect x="144" y="42" width="32" height="6" rx="3" fill={INK} />
      {/* a receipt on the screen */}
      <rect x="132" y="62" width="56" height="68" rx="10" fill={INK} />
      <rect x="142" y="76" width="36" height="7" rx="3" fill={SOFT} />
      <rect x="142" y="90" width="26" height="7" rx="3" fill={SOFT} />
      <rect x="142" y="110" width="20" height="7" rx="3" fill={SOFT} />
      {/* list rows */}
      <rect x="132" y="148" width="56" height="10" rx="5" fill={INK} />
      <rect x="132" y="166" width="38" height="10" rx="5" fill={INK} />
      {/* exactly one coral dot: the notification that the date is near */}
      <circle cx="192" cy="56" r="9" fill={ACCENT} />
    </Stage>
  );
}

const ART: Record<FeatureVisualSubject, ComponentType> = {
  'rice-cooker': RiceCooker,
  'ac-remote': AcRemote,
  'motorbike-key': MotorbikeKey,
  'warranty-booklet': WarrantyBooklet,
  'red-invoice': RedInvoice,
  phone: Phone,
};

export function FeatureVisual({ subject, label, className, style }: Props) {
  const Art = ART[subject];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 320 240"
      role="img"
      aria-label={label}
      data-feature-visual={subject}
      className={cn('block h-auto w-full', className)}
      style={style}
    >
      <Art />
    </svg>
  );
}
