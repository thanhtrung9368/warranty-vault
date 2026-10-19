'use server';

// The client-side entry point to the brand lookup resolver.
//
// The device form's brand combobox is client state, so the URL for a brand the
// user just picked cannot be resolved during the RSC render. `DeviceForm` calls
// this action on an explicit "Đối chiếu với hãng" click (not on every keystroke
// in the free-text field), and receives `lookupUrl: null` when the brand has no
// page — the UI then says so instead of guessing one.
//
// Read-only: no mutation, no revalidation.

import {
  resolveBrandWarrantyLookup,
  type BrandLookupResolution,
} from '@/lib/brand-warranty-lookup';

export async function lookupBrandWarranty(
  brandName: string,
): Promise<BrandLookupResolution> {
  return resolveBrandWarrantyLookup(brandName);
}
