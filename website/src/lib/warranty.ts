import { addMonths } from 'date-fns';

export type WarrantyLike = {
  endDate: Date | string;
};

export function effectiveWarrantyEnd(warranties: WarrantyLike[] | null | undefined): Date | null {
  if (!warranties || warranties.length === 0) return null;
  let max: Date | null = null;
  for (const w of warranties) {
    const end = typeof w.endDate === 'string' ? new Date(w.endDate) : w.endDate;
    if (!max || end.getTime() > max.getTime()) max = end;
  }
  return max;
}

export function calcEndDate(startDate: Date | string, months: number): Date {
  const d = typeof startDate === 'string' ? new Date(startDate) : startDate;
  return addMonths(d, months);
}
