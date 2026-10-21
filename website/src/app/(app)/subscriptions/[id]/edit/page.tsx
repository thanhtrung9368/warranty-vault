import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { SubscriptionForm } from '@/components/subscription-form';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { getI18n } from '@/lib/i18n/server';
import type {
  BillingCycle,
  SubscriptionStatus,
} from '@/lib/subscription-types';
import { parseDay } from '@/lib/api-day';

export default async function EditSubscriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t } = await getI18n();
  const [res, catalog] = await Promise.all([
    api.subscriptions.get(id),
    getDeviceFormCatalog(),
  ]);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return (
      <PageShell className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow={t('Chỉnh sửa')}
          title={t('Sửa gói')}
        />
        <div className="rounded-lg border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive">
          {t('Lỗi tải gói: {message}', { message: res.message ?? res.error })}
        </div>
      </PageShell>
    );
  }
  const sub = res.data.subscription;

  return (
    <PageShell className="mx-auto max-w-3xl">
      <PageHeader
        back={
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
            <Link href={`/subscriptions/${sub.id}`}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('Quay lại chi tiết')}
            </Link>
          </Button>
        }
        eyebrow={t('Chỉnh sửa')}
        title={t('Sửa gói')}
        description={sub.name}
      />
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
          // Calendar days (`YYYY-MM-DD`): local midnight, not UTC midnight.
          startedAt: parseDay(sub.startedAt),
          renewalDate: parseDay(sub.renewalDate),
          autoRenew: sub.autoRenew,
          status: sub.status as SubscriptionStatus,
          accountEmail: sub.accountEmail,
          paymentMethod: sub.paymentMethod,
          manageUrl: sub.manageUrl,
          cancelUrl: sub.cancelUrl,
          notes: sub.notes,
          // Reminder schedule — the form edits it; PATCH is a full payload but
          // Go treats an absent/null leadDays as "unchanged", so this pass
          // exists to show the stored value (and let the form submit it).
          leadDays: sub.leadDays,
          // Free trial (Feature B) — loaded so the trial date and post-trial
          // price start on the stored values. The form only renders the price
          // when a trial end exists, which is also the only combination the
          // server accepts.
          trialEndsAt: sub.trialEndsAt,
          convertsToPrice: sub.convertsToPrice,
        }}
      />
    </PageShell>
  );
}
