// Dismissed-reminder rollup for the /reminders page.
//
// The Go reminders feed (`GET /v1/reminders`) deliberately excludes dismissed
// rows, and `GET /v1/devices/{id}` projects only the *active* reminder
// (`services.GetActiveReminderForWarranty`). The only documented read that
// still carries `Reminder.isDismissed` for dismissed rows is the backup export
// (`GET /v1/backup/export`, openapi `BackupDevice.warranties[].reminders[]`),
// so that is what the page reads to list what the user has hidden. Restoring
// then goes through the existing `DELETE /v1/warranties/{id}/reminder`.
//
// Pure + synchronous so it can be unit-tested without a backend.

// Structural subset of `BackupExport` — just what this rollup needs. Keeping it
// structural means the page can hand over the parsed JSON without a cast and
// the tests can build tiny fixtures.
export type DismissedReminderSource = {
  devices?:
    | Array<{
        id: string;
        name: string;
        category: string;
        status?: string;
        warranties?:
          | Array<{
              id: string;
              type: string;
              provider: string | null;
              endDate: string;
              reminders?: Array<{ isDismissed: boolean }> | null;
            }>
          | null;
      }>
    | null;
};

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
// dismiss/restore flips the same `Reminder` row), newest end date first.
export function dismissedRemindersFromBackup(
  backup: DismissedReminderSource,
): DismissedReminder[] {
  const out: DismissedReminder[] = [];
  for (const device of backup.devices ?? []) {
    for (const warranty of device.warranties ?? []) {
      const dismissed = (warranty.reminders ?? []).some((r) => r.isDismissed);
      if (!dismissed) continue;
      out.push({
        warrantyId: warranty.id,
        deviceId: device.id,
        deviceName: device.name,
        deviceCategory: device.category,
        deviceStatus: device.status ?? 'ACTIVE',
        warrantyType: warranty.type,
        warrantyProvider: warranty.provider,
        endDate: warranty.endDate,
      });
    }
  }
  return out.sort(
    (a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime(),
  );
}
