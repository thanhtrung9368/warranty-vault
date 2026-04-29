import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { SubscriptionForm } from '@/components/subscription-form';
import { Button } from '@/components/ui/button';
import { getSubscription } from '@/lib/subscriptions';
import { requireUser } from '@/lib/auth';
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
  const user = await requireUser();
  const { id } = await params;
  const sub = await getSubscription(user.id, id);
  if (!sub) notFound();
  const catalog = await getDeviceFormCatalog();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href={`/subscriptions/${sub.id}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Quay lại chi tiết
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Sửa gói</h1>
        <p className="text-sm text-muted-foreground">{sub.name}</p>
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
          startedAt: sub.startedAt,
          renewalDate: sub.renewalDate,
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
