import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata = {
  title: 'Ngoại tuyến — AssetVault',
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-full bg-muted p-4 text-muted-foreground">
        <WifiOff className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-bold">Đang mất kết nối</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        AssetVault cần mạng để đồng bộ dữ liệu. Kết nối lại internet rồi thử lại.
      </p>
      <Button asChild>
        <Link href="/dashboard">Thử lại</Link>
      </Button>
    </div>
  );
}
