import { addMonths } from 'date-fns';
import { toDayDate } from './api-day';

export type WarrantyLike = {
  endDate: Date | string;
  /**
   * A component-scoped row ("Động cơ", "Pin") covers one part, not the device.
   * The API omits the field entirely for whole-unit rows (`omitempty`), so
   * absent and blank both mean whole-unit — the same rule as
   * `wholeUnitWarrantyEnd` in `api/internal/services/brand_warranty.go`, which
   * is the one definition the server uses for `effectiveWarrantyEnd`.
   */
  component?: string | null;
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
    // A ten-year motor warranty must not become "the fridge is covered until
    // 2035". openapi.yaml's `effectiveWarrantyEnd` says exactly this.
    if (w.component != null && w.component.trim() !== '') continue;
    const end = toDayDate(w.endDate);
    if (!max || end.getTime() > max.getTime()) max = end;
  }
  return max;
}

/** `startDate` + `months`, where `startDate` is a calendar day (or a `Date`). */
export function calcEndDate(startDate: Date | string, months: number): Date {
  return addMonths(toDayDate(startDate), months);
}
