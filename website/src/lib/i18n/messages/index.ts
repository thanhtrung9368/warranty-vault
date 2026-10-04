// The web message catalog, assembled from one file per domain.
//
// `defineMessages` (see ../types.ts) is what the domain files use, so the
// Vietnamese column is never re-typed: the KEY is the Vietnamese original and
// the English translation is the value.
//
// The merge below is deliberately loud about collisions. Two domain files may
// legitimately carry the same key — "Lưu" is one word — but they must agree on
// the translation, or one of them silently wins and the other reader gets the
// wrong sentence. `conflicts` collects the disagreements and
// `__tests__/i18n.test.ts` fails on a non-empty list.

import type { Catalog } from '../types';
import { common } from './common';
import { auth } from './auth';
import { publicPages } from './public';
import { devices } from './devices';
import { warranties } from './warranties';
import { subscriptions } from './subscriptions';
import { wishlist } from './wishlist';
import { dashboard } from './dashboard';
import { settings } from './settings';
import { system } from './system';

/** Domain file name → its catalog. `system` is the API/lib layer, not a page. */
export const catalogs: Record<string, Catalog> = {
  common,
  auth,
  public: publicPages,
  devices,
  warranties,
  subscriptions,
  wishlist,
  dashboard,
  settings,
  system,
};

export type CatalogConflict = {
  key: string;
  /** Every `messages/*.ts` file that defines this key, in merge order. */
  files: string[];
  /** The English translations that disagree. */
  translations: string[];
};

function mergeCatalogs(): { messages: Catalog; conflicts: CatalogConflict[] } {
  const messages: Catalog = {};
  const owners = new Map<string, string[]>();
  const conflicts: CatalogConflict[] = [];

  for (const [file, catalog] of Object.entries(catalogs)) {
    for (const [key, message] of Object.entries(catalog)) {
      const seen = owners.get(key);
      if (!seen) {
        owners.set(key, [file]);
        messages[key] = message;
        continue;
      }
      seen.push(file);
      const existing = messages[key];
      if (existing.en !== message.en || existing.enOne !== message.enOne) {
        conflicts.push({
          key,
          files: [...seen],
          translations: [existing.en, message.en],
        });
      }
    }
  }
  return { messages, conflicts };
}

const merged = mergeCatalogs();

/** Every registered message, keyed by its Vietnamese original. */
export const messages: Catalog = merged.messages;

/** Non-empty ⇒ two domain files disagree about the same Vietnamese sentence. */
export const conflicts: CatalogConflict[] = merged.conflicts;

/** Which `messages/*.ts` file(s) define each key — used by the tests. */
export const messageOwners: Map<string, string[]> = (() => {
  const owners = new Map<string, string[]>();
  for (const [file, catalog] of Object.entries(catalogs)) {
    for (const key of Object.keys(catalog)) {
      owners.set(key, [...(owners.get(key) ?? []), file]);
    }
  }
  return owners;
})();
