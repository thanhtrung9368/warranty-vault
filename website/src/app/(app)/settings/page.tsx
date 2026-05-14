import { Bell, Database, Info, Lock, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
        <h1 className="text-2xl font-bold tracking-tight">Cài đặt</h1>
        <p className="text-sm text-muted-foreground">
          {user.email} · Quản lý tài khoản và dữ liệu cá nhân.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-5 w-5 text-primary" />
            Thông báo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PushSettings />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-5 w-5 text-primary" />
            Đổi mật khẩu
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-5 w-5 text-primary" />
            Sao lưu & khôi phục
          </CardTitle>
        </CardHeader>
        <CardContent>
          <BackupTools />
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <Trash2 className="h-5 w-5" />
            Xoá tài khoản
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DeleteAccountForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-5 w-5 text-muted-foreground" />
            Về AssetVault
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            App cá nhân theo dõi thiết bị, bảo hành và chi phí. Mỗi tài khoản dữ liệu riêng, không
            chia sẻ. Backup JSON xuất/nhập bất cứ lúc nào.
          </p>
          <p>Tech stack: Next.js 16, React 19, Go backend, Tailwind, shadcn/ui, recharts.</p>
        </CardContent>
      </Card>
    </div>
  );
}
