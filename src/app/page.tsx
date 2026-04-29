import Link from 'next/link';
import {
  Shield,
  ShieldCheck,
  Bell,
  Receipt,
  BarChart3,
  Phone,
  Lock,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  PackagePlus,
  LayoutDashboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ThemeToggle } from '@/components/theme-toggle';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Theo dõi bảo hành',
    desc: 'Tự động tính ngày hết hạn từ ngày mua + số tháng. Biết ngay còn bao lâu.',
    tint: 'bg-primary/10 text-primary',
  },
  {
    icon: Bell,
    title: 'Cảnh báo sắp hết',
    desc: 'Nhắc nhở 30/60/90 ngày trước hạn. Không lo bỏ lỡ thời gian bảo hành miễn phí.',
    tint: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    icon: Receipt,
    title: 'Lưu hóa đơn & phiếu BH',
    desc: 'Đính kèm ảnh hoặc PDF cho từng thiết bị. Tìm lại trong vài giây khi cần.',
    tint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: Phone,
    title: 'Gọi & tìm trung tâm BH',
    desc: 'Một chạm gọi điện hoặc mở Google Maps đến trung tâm bảo hành đã lưu.',
    tint: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  {
    icon: BarChart3,
    title: 'Thống kê chi tiêu',
    desc: 'Biểu đồ chi phí theo tháng, theo loại. Top 5 thiết bị đắt nhất.',
    tint: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  },
  {
    icon: Lock,
    title: 'Riêng tư',
    desc: 'Mỗi tài khoản chỉ thấy dữ liệu của mình. Backup JSON xuất/nhập bất cứ lúc nào.',
    tint: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
  },
];

const STEPS = [
  {
    icon: Sparkles,
    title: 'Đăng ký miễn phí',
    desc: 'Email + mật khẩu. Không cần xác thực, không quảng cáo.',
  },
  {
    icon: PackagePlus,
    title: 'Thêm thiết bị',
    desc: 'Nhập tên, ngày mua, số tháng BH. Đính kèm hóa đơn nếu có.',
  },
  {
    icon: LayoutDashboard,
    title: 'Theo dõi tự động',
    desc: 'Dashboard hiển thị tình trạng. Nhắc nhở khi sắp hết hạn.',
  },
];

export default async function LandingPage() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-8">
          <Link href="/" className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <span className="text-base font-bold tracking-tight">AssetVault</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {user ? (
              <Button asChild size="sm">
                <Link href="/dashboard">
                  Vào app
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                  <Link href="/login">Đăng nhập</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/register">Bắt đầu miễn phí</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-16 md:px-8 md:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Miễn phí • Local-first • Tiếng Việt
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl">
            Đừng quên ngày hết
            <br />
            <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
              bảo hành thiết bị
            </span>{' '}
            của bạn
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">
            Một chỗ duy nhất để theo dõi bảo hành laptop, điện thoại, đồ gia dụng và mọi thứ bạn
            mua. Tự động cảnh báo trước khi hết hạn, lưu hóa đơn, thống kê chi tiêu.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {user ? (
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/dashboard">
                  Mở Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link href="/register">
                    Tạo tài khoản miễn phí
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                  <Link href="/login">Đã có tài khoản → Đăng nhập</Link>
                </Button>
              </>
            )}
          </div>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Không cần thẻ tín dụng
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Không quảng cáo
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Backup xuất/nhập JSON
            </li>
          </ul>
        </div>

        {/* Mock dashboard preview */}
        <div className="mx-auto mt-16 max-w-4xl">
          <div className="rounded-2xl border bg-card/40 p-3 shadow-2xl shadow-primary/5 backdrop-blur md:p-4">
            <div className="rounded-xl border bg-background p-4 md:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Tổng quan
                  </p>
                  <p className="text-lg font-bold">Chào, Trung 👋</p>
                </div>
                <div className="hidden gap-2 sm:flex">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: 'Tổng', value: '12', tint: 'bg-primary/10 text-primary', icon: Shield },
                  {
                    label: 'Còn BH',
                    value: '9',
                    tint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                    icon: ShieldCheck,
                  },
                  {
                    label: 'Sắp hết',
                    value: '2',
                    tint: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                    icon: Bell,
                  },
                  {
                    label: 'Đã hết',
                    value: '1',
                    tint: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
                    icon: Lock,
                  },
                ].map((c) => {
                  const Icon = c.icon;
                  return (
                    <div
                      key={c.label}
                      className="flex items-center justify-between rounded-lg border bg-card p-3"
                    >
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground">{c.label}</p>
                        <p className="text-xl font-bold">{c.value}</p>
                      </div>
                      <div className={`rounded-md p-2 ${c.tint}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 space-y-2">
                {[
                  { name: 'MacBook Pro M3', label: 'Còn 12 ngày', tone: 'text-red-600' },
                  { name: 'iPhone 15 Pro', label: 'Còn 28 ngày', tone: 'text-amber-600' },
                  { name: 'Máy giặt LG', label: 'Còn 4 tháng', tone: 'text-emerald-600' },
                ].map((d) => (
                  <div
                    key={d.name}
                    className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{d.name}</span>
                    <span className={`text-xs font-semibold ${d.tone}`}>{d.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t bg-card/30 py-20">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Có đủ những gì bạn cần</h2>
            <p className="mt-3 text-muted-foreground">
              Đơn giản, gọn, tiếng Việt 100%. Không bloated, không tracking.
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <Card
                  key={f.title}
                  className="border-border/50 transition-colors hover:border-primary/40"
                >
                  <CardContent className="p-6">
                    <div className={`mb-4 inline-flex rounded-lg p-2.5 ${f.tint}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-base font-semibold">{f.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">3 bước để bắt đầu</h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={s.title} className="relative">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-primary/30 bg-primary/10 text-sm font-bold text-primary">
                      {i + 1}
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" />
                        <h3 className="font-semibold">{s.title}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground">{s.desc}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t bg-gradient-to-br from-primary/5 via-background to-background py-20">
        <div className="mx-auto max-w-3xl px-4 text-center md:px-8">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Sẵn sàng quản lý thiết bị?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Đăng ký mất 30 giây. Thêm thiết bị đầu tiên trong 1 phút.
          </p>
          <div className="mt-8">
            {user ? (
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Vào Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg">
                <Link href="/register">
                  Tạo tài khoản miễn phí
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted-foreground md:flex-row md:px-8">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="font-medium text-foreground">AssetVault</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-foreground">
              Đăng nhập
            </Link>
            <Link href="/register" className="hover:text-foreground">
              Đăng ký
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
