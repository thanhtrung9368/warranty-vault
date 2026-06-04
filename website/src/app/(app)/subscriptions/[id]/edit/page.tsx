import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { SubscriptionForm } from '@/components/subscription-form';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import type {
  BillingCycle,
  SubscriptionStatus,
} from '@/lib/subscription-types';

export default async function EditSubscriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [res, catalog] = await Promise.all([
    api.subscriptions.get(id),
    getDeviceFormCatalog(),
  ]);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive">
        Lỗi tải gói: {res.message ?? res.error}
      </div>
    );
  }
  const sub = res.data.subscription;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
          <Link href={`/subscriptions/${sub.id}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Quay lại chi tiết
          </Link>
        </Button>
        <p className="eyebrow">Chỉnh sửa</p>
        <h1 className="display mt-1 text-3xl text-ink">Sửa gói</h1>
        <p className="mt-1 text-sm text-muted-foreground">{sub.name}</p>
      </div>
      <SubscriptionForm
        catalog={{
          categories: catalog.categories,
          brands: catalog.brands,
        }}
        initial={{
          id: sub.id,
          name: sub.name,
          category: sub.category,
          brand: sub.brand,
          plan: sub.plan,
          billingCycle: sub.billingCycle as BillingCycle,
          intervalDays: sub.intervalDays,
          price: sub.price,
          startedAt: new Date(sub.startedAt),
          renewalDate: new Date(sub.renewalDate),
          autoRenew: sub.autoRenew,
          status: sub.status as SubscriptionStatus,
          accountEmail: sub.accountEmail,
          paymentMethod: sub.paymentMethod,
          manageUrl: sub.manageUrl,
          cancelUrl: sub.cancelUrl,
          notes: sub.notes,
        }}
      />
    </div>
  );
}
