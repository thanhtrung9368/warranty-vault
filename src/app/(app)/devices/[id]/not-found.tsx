import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function DeviceNotFound() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
      <h2 className="text-2xl font-bold">Không tìm thấy thiết bị</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Thiết bị này không tồn tại hoặc đã bị xóa.
      </p>
      <Button asChild className="mt-4">
        <Link href="/devices">Quay lại danh sách</Link>
      </Button>
    </div>
  );
}
