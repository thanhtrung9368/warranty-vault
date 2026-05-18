import { Bell, Database, Info, Lock, Palette, Trash2 } from 'lucide-react';
import { AppearanceTweaks } from '@/components/appearance-tweaks';
import { BackupTools } from '@/components/backup-tools';
import { PushSettings } from '@/components/push-settings';
import { ChangePasswordForm } from '@/components/change-password-form';
import { DeleteAccountForm } from '@/components/delete-account-form';
import { requireUser } from '@/lib/auth';

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="eyebrow">Tài khoản</p>
        <h1 className="display mt-1 text-3xl text-ink md:text-4xl">Cài đặt</h1>
        <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
          {user.email} · Quản lý tài khoản và dữ liệu cá nhân.
        </p>
      </div>

      <Section icon={<Palette className="h-4 w-4" />} tint="tint-violet" title="Giao diện">
        <AppearanceTweaks />
      </Section>

      <Section icon={<Bell className="h-4 w-4" />} tint="tint-primary" title="Thông báo">
        <PushSettings />
      </Section>

      <Section icon={<Lock className="h-4 w-4" />} tint="tint-violet" title="Đổi mật khẩu">
        <ChangePasswordForm />
      </Section>

      <Section icon={<Database className="h-4 w-4" />} tint="tint-sky" title="Sao lưu & khôi phục">
        <BackupTools />
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
