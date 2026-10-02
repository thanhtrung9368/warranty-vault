// Dismissed-reminder rollup for the /reminders page.
//
// The Go reminders feed (`GET /v1/reminders`) excludes dismissed rows by
// default, which is why this list used to be parsed out of the full backup
// export (`GET /v1/backup/export`, openapi `BackupDevice.warranties[].reminders[]`).
// The feed now takes the opt-in `includeDismissed=true`, which returns the
// hidden warranties too — same `ReminderRow` shape as the active rows, each
// flagged `isDismissed: true` and carrying the embedded device projection — so
// that is what the page reads now. The widened feed returns hidden rows
// regardless of the owning device's status (a reminder hidden on a device that
// has since been sold must not disappear), which is why `deviceStatus` is read
// off the row instead of assumed. Restoring still goes through the existing
// `DELETE /v1/warranties/{id}/reminder`.
//
// Pure + synchronous so it can be unit-tested without a backend.

// Structural subset of `services.ReminderRow` — just what this rollup needs.
// Keeping it structural means the page can hand over `res.data` without a cast
// and the tests can build tiny fixtures.
export type DismissedReminderRow = {
  id: string;
  type: string;
  provider: string | null;
  endDate: string;
  // Set by the widened feed; absent on the default (dismissed-free) feed.
  isDismissed?: boolean;
  device?:
    | {
        id: string;
        name: string;
        category: string;
        status?: string;
      }
    | null;
};

// The widened feed's rows. `null`/`undefined` are tolerated so a caller can
// pass a failed/partial read straight through without a guard.
export type DismissedReminderSource = ReadonlyArray<DismissedReminderRow> | null | undefined;

export type DismissedReminder = {
  warrantyId: string;
  deviceId: string;
  deviceName: string;
  deviceCategory: string;
  deviceStatus: string;
  warrantyType: string;
  warrantyProvider: string | null;
  endDate: string;
};

// One entry per warranty (a warranty can only be dismissed once at a time —
// dismiss/restore flips the same `Reminder` row) — newest end date first.
export function dismissedReminders(feed: DismissedReminderSource): DismissedReminder[] {
  const out: DismissedReminder[] = [];
  for (const row of feed ?? []) {
    if (row.isDismissed !== true) continue;
    const device = row.device;
    // Without the embedded device we can neither render nor link the row;
    // skip it instead of emitting a broken entry.
    if (!device) continue;
    out.push({
      warrantyId: row.id,
      deviceId: device.id,
      deviceName: device.name,
      deviceCategory: device.category,
      // Devices without a status in the projection read as ACTIVE, so the UI's
      // "not ACTIVE" badge never fires on a missing field.
      deviceStatus: device.status ?? 'ACTIVE',
      warrantyType: row.type,
      warrantyProvider: row.provider,
      endDate: row.endDate,
    });
  }
  return out.sort(
    (a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime(),
  );
}
