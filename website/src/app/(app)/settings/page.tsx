import { Bell, Database, FileSpreadsheet, Info, Lock, MonitorSmartphone, Palette, ScanLine, Trash2, UserRound } from 'lucide-react';
import { AppearanceTweaks } from '@/components/appearance-tweaks';
import { BackupTools } from '@/components/backup-tools';
import { CsvExport } from '@/components/csv-export';
import { PushSettings } from '@/components/push-settings';
import { PushDevices } from '@/components/push-devices';
import { SessionList } from '@/components/session-list';
import { ChangePasswordForm } from '@/components/change-password-form';
import { DeleteAccountForm } from '@/components/delete-account-form';
import { EmailChangeForm } from '@/components/email-change-form';
import { AISettings } from '@/components/ai-settings';
import { ProfileForm } from '@/components/profile-form';
import { listMySubscriptions } from '@/app/actions/push';
import { listMySessions } from '@/app/actions/sessions';
import { requireUser } from '@/lib/auth';

export default async function SettingsPage() {
  const user = await requireUser();
  const [pushSubscriptions, sessions] = await Promise.all([
    listMySubscriptions(),
    listMySessions(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="eyebrow">Tài khoản</p>
        <h1 className="display mt-1 text-3xl text-ink md:text-4xl">Cài đặt</h1>
        <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
          {user.email} · Quản lý tài khoản và dữ liệu cá nhân.
        </p>
      </div>

      <Section icon={<UserRound className="h-4 w-4" />} tint="tint-violet" title="Hồ sơ">
        <div className="space-y-4">
          <ProfileForm email={user.email} initialName={user.name} />
          {/* Step 1 of the email-change flow. The mailed link lands on
              /confirm-email/<token>, which is public (the token is the
              credential). */}
          <EmailChangeForm currentEmail={user.email} />
        </div>
      </Section>

      <Section icon={<Palette className="h-4 w-4" />} tint="tint-violet" title="Giao diện">
        <AppearanceTweaks />
      </Section>

      <Section icon={<Bell className="h-4 w-4" />} tint="tint-primary" title="Thông báo">
        <PushSettings />
        <PushDevices
          subscriptions={pushSubscriptions.subscriptions}
          unavailable={!pushSubscriptions.ok}
        />
      </Section>

      <Section icon={<Lock className="h-4 w-4" />} tint="tint-violet" title="Đổi mật khẩu">
        <ChangePasswordForm />
      </Section>

      {/* Every active login session, with a per-session "Gỡ". Deliberately a
          different thing from "Thiết bị nhận thông báo" above: removing a push
          target only stops notifications, revoking a session cuts data access. */}
      <Section
        icon={<MonitorSmartphone className="h-4 w-4" />}
        tint="tint-sky"
        title="Phiên đăng nhập"
      >
        <SessionList sessions={sessions.sessions} unavailable={!sessions.ok} />
      </Section>

      <Section icon={<ScanLine className="h-4 w-4" />} tint="tint-primary" title="Quét hoá đơn (AI)">
        <AISettings initialEnabled={user.aiOptIn} />
      </Section>

      <Section icon={<Database className="h-4 w-4" />} tint="tint-sky" title="Sao lưu & khôi phục">
        <BackupTools />
      </Section>

      <Section
        icon={<FileSpreadsheet className="h-4 w-4" />}
        tint="tint-emerald"
        title="Xuất bảng tính (CSV)"
      >
        <CsvExport />
      </Section>

      <section className="rounded-lg border-2 border-destructive/30 bg-destructive-soft/40 p-6">
        <h2 className="mb-4 flex items-center gap-2 font-display text-[15px] font-bold text-destructive">
          <span className="icon-badge icon-badge-sm tint-rose">
            <Trash2 className="h-4 w-4" />
          </span>
          Xoá tài khoản
        </h2>
        <DeleteAccountForm />
      </section>

      <section className="rounded-lg border-[1.5px] border-border bg-surface-2 p-6">
        <h2 className="mb-3 flex items-center gap-2 font-display text-[15px] font-bold text-ink">
          <span className="icon-badge icon-badge-sm tint-zinc">
            <Info className="h-4 w-4" />
          </span>
          Về WarrantyVault
        </h2>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            App cá nhân theo dõi thiết bị, bảo hành và chi phí. Mỗi tài khoản dữ liệu riêng, không
            chia sẻ. Backup JSON xuất/nhập bất cứ lúc nào.
          </p>
          <p>Tech stack: Next.js 16, React 19, Go backend, Tailwind, shadcn/ui, recharts.</p>
        </div>
      </section>
    </div>
  );
}

function Section({
  icon,
  tint,
  title,
  children,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border-[1.5px] border-border bg-card p-6 shadow-soft">
      <h2 className="mb-4 flex items-center gap-2 font-display text-[15px] font-bold text-ink">
        <span className={`icon-badge icon-badge-sm ${tint}`}>{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
