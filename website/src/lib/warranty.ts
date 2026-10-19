import { addMonths } from 'date-fns';
import { toDayDate } from './api-day';

export type WarrantyLike = {
  endDate: Date | string;
};

/**
 * `max(endDate)` across a device's plans, or `null` when none has a readable
 * end. `Warranty.endDate` is a calendar day (`YYYY-MM-DD`), so it is parsed at
 * local midnight: `new Date(day)` would be UTC midnight and every comparison
 * against it would sit a day early west of UTC.
 */
export function effectiveWarrantyEnd(warranties: WarrantyLike[] | null | undefined): Date | null {
  if (!warranties || warranties.length === 0) return null;
  let max: Date | null = null;
  for (const w of warranties) {
    const end = toDayDate(w.endDate);
    if (!max || end.getTime() > max.getTime()) max = end;
  }
  return max;
}

/** `startDate` + `months`, where `startDate` is a calendar day (or a `Date`). */
export function calcEndDate(startDate: Date | string, months: number): Date {
  return addMonths(toDayDate(startDate), months);
}
