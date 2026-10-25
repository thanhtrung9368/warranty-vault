import type { ReactNode } from 'react';

/**
 * A visible gap in a legal document.
 *
 * The ad network, the legal entity, the data-protection contact and the ad-data
 * retention period are facts only the owner can supply. Inventing any of them
 * in a privacy policy would be worse than publishing the gap, so every one is
 * rendered as `[CẦN ĐIỀN: …]` in both languages and listed in the change report.
 *
 * It is deliberately not translated: the marker is an instruction to the owner,
 * not copy for a visitor, and keeping one exact string makes the gaps greppable
 * (`rg 'CẦN ĐIỀN'`) before deploy.
 */
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded-sm border border-amber-ink bg-amber-soft px-1 py-0.5 font-mono text-[0.9em] font-normal text-amber-ink">
      [CẦN ĐIỀN: {children}]
    </mark>
  );
}
