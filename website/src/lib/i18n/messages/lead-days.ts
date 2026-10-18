// Reminder lead days (`Device.leadDays` + `Subscription.leadDays`).
//
// Shared by both the device form/detail page and the subscription form/detail
// page, so the copy lives in one domain file instead of being duplicated (and
// possibly translated differently) in `devices.ts` and `subscriptions.ts`.
//
// Keys are the Vietnamese originals (see `../types.ts`). The sentence the Go
// validator puts in `fieldErrors.leadDays` is not repeated here: the client
// only ever writes its own "at least one day" message, and the server's copy is
// surfaced untouched when the request actually reaches Go.

import { defineMessages } from '../types';

export const leadDays = defineMessages({
  // ── Form control (`components/lead-days-field.tsx`) ─────────────────────
  'Mốc nhắc trước': 'Reminder lead times',
  'Chọn từ 1 đến 5 mốc — mỗi mốc là số ngày trước khi đến hạn, từ 0 đến 365 (0 = đúng ngày).':
    'Pick 1 to 5 lead times — each is the number of days before the due date, from 0 to 365 (0 = on the day).',
  'Cần chọn ít nhất một mốc nhắc': 'Choose at least one reminder day',
  'Mốc gợi ý': 'Suggested lead times',
  'Đã chọn': 'Selected',
  'Chưa đặt mốc nhắc': 'No reminder days set',
  'Số ngày tuỳ chọn': 'Custom days',
  'Thêm mốc': 'Add lead time',
  'Tối đa 5 mốc': 'Up to 5 lead times',
  'Bỏ mốc {days} ngày': 'Remove the {days}-day lead time',
  'Đúng ngày': 'On the day',

  // ── Detail pages (`devices/[id]`, `subscriptions/[id]`) ─────────────────
  'Mốc nhắc': 'Reminder schedule',
  'Nhắc trước {days} ngày': {
    en: 'Remind {days} days before',
    enOne: 'Remind {days} day before',
  },
  'Nhắc trước {days} ngày và đúng ngày': {
    en: 'Remind {days} days before and on the day',
    enOne: 'Remind {days} day before and on the day',
  },
  'Nhắc đúng ngày': 'Remind on the day',

  // ── Small joiners ───────────────────────────────────────────────────────
  // `lib/lead-days.ts` joins three or more days with commas and the final pair
  // with this sentence, so the conjunction itself is translated.
  '{head} và {last}': '{head} and {last}',
});
