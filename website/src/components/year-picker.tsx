'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function YearPicker({ years, value }: { years: number[]; value: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const go = (y: number) => {
    const next = new URLSearchParams(params.toString());
    next.set('year', String(y));
    router.replace(`/stats?${next.toString()}`);
  };
  return (
    <div className="pill-group" role="tablist" aria-label="Chọn năm">
      {years.map((y) => (
        <button
          key={y}
          type="button"
          role="tab"
          aria-selected={y === value}
          data-active={y === value}
          onClick={() => go(y)}
        >
          {y}
        </button>
      ))}
    </div>
  );
}
