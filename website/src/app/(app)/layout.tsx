import { Sidebar, MobileBottomNav } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { api } from '@/lib/api';
import { badgeCount } from '@/lib/action-queue';
import { requireUser } from '@/lib/auth';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Two sidebar badges, both derived server-side:
  //  - reminders: 30-day horizon to match the previous countActiveReminders()
  //    default. The Go endpoint already filters out dismissed reminders and only
  //    returns warranties on ACTIVE devices.
  //  - actions: `ActionQueue.counts.total`, asked for WITHOUT `snoozed=true` so
  //    the badge is the actionable subset only. `badgeCount()` is the single
  //    place that rule is written down.
  const [remindersRes, actionsRes] = await Promise.all([
    api.reminders.list(30),
    api.actions.list(),
  ]);
  const reminderCount = remindersRes.ok ? remindersRes.data.length : 0;
  const actionCount = actionsRes.ok ? badgeCount(actionsRes.data.counts) : 0;

  return (
    <>
      <div className="flex min-h-screen">
        <Sidebar reminderCount={reminderCount} actionCount={actionCount} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar user={user} />
          <main className="flex-1 px-4 pb-28 pt-6 md:px-9 md:pb-12 md:pt-8">
            <div className="mx-auto w-full max-w-[1200px]">{children}</div>
          </main>
        </div>
      </div>
      <MobileBottomNav reminderCount={reminderCount} actionCount={actionCount} />
    </>
  );
}
