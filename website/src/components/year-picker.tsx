'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useT } from '@/lib/i18n/client';

export function YearPicker({ years, value }: { years: number[]; value: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const t = useT();
  const go = (y: number) => {
    const next = new URLSearchParams(params.toString());
    next.set('year', String(y));
    router.replace(`/stats?${next.toString()}`);
  };
  return (
    <div className="pill-group" role="group" aria-label={t('Chọn năm')}>
      {years.map((y) => (
        <button
          key={y}
          type="button"
          aria-pressed={y === value}
          data-active={y === value}
          onClick={() => go(y)}
        >
          {y}
        </button>
      ))}
    </div>
  );
}
