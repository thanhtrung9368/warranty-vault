'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

export function YearPicker({ years, value }: { years: number[]; value: number }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => {
        const next = new URLSearchParams(params.toString());
        next.set('year', v);
        router.replace(`/stats?${next.toString()}`);
      }}
    >
      <SelectTrigger className="w-[110px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {y}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
