import { Sidebar, MobileSidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { countActiveReminders } from '@/lib/queries';
import { requireUser } from '@/lib/auth';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const reminderCount = await countActiveReminders(user.id).catch(() => 0);

  return (
    <>
      <div className="flex min-h-screen">
        <Sidebar reminderCount={reminderCount} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar user={user} />
          <main className="flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10">
            {children}
          </main>
        </div>
      </div>
      <MobileSidebar reminderCount={reminderCount} />
    </>
  );
}
