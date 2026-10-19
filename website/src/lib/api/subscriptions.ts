// Typed client for /v1/subscriptions on the Go service.
//
// Mirrors the OpenAPI shapes (`Subscription`, `SubscriptionInput`, `Payment`).
// Date fields come back as ISO strings — callers that render dates should
// `new Date(...)` at the boundary.

import { apiFetch, type ApiResult } from './client';

export type Subscription = {
  id: string;
  userId?: string;
  name: string;
  category: string | null;
  brand: string | null;
  plan: string | null;
  billingCycle: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'LIFETIME' | 'CUSTOM';
  intervalDays: number | null;
  price: number;
  currency: string;
  startedAt: string;
  renewalDate: string;
  autoRenew: boolean;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELED' | 'EXPIRED';
  accountEmail: string | null;
  paymentMethod: string | null;
  manageUrl: string | null;
  cancelUrl: string | null;
  notes: string | null;
  // Reminder lead times: 1..5 integers, each 0..365, no duplicates, sorted
  // descending by the server. `[30, 7]` is the create default.
  leadDays: number[];
  // Free trial (Feature B). `trialEndsAt` is when the free period ends and
  // billing starts; null when the plan has no trial. `convertsToPrice` is what
  // the plan costs AFTER that conversion, in VND.
  //
  // The pair is one-way: a price without a trial end is meaningless and the
  // server rejects it with `fieldErrors.convertsToPrice`, so the form never
  // submits that combination (it hides — and clears — the price when the date
  // is cleared). A trial end without a price is valid: "billing starts, figure
  // not known yet".
  trialEndsAt: string | null;
  convertsToPrice: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export type Payment = {
  id: string;
  subscriptionId: string;
  amount: number;
  paidAt: string;
  note: string | null;
};

export type SubscriptionDetail = Subscription & {
  payments: Payment[];
};

export type SubscriptionInput = {
  name: string;
  category?: string | null;
  brand?: string | null;
  plan?: string | null;
  billingCycle: Subscription['billingCycle'];
  intervalDays?: number | null;
  price: number;
  startedAt: string;
  renewalDate?: string | null;
  autoRenew: boolean;
  status?: Subscription['status'];
  accountEmail?: string | null;
  paymentMethod?: string | null;
  manageUrl?: string | null;
  cancelUrl?: string | null;
  notes?: string | null;
  // Reminder lead days. Same wire semantics as `DeviceInput.leadDays`: absent
  // means "server default on create / unchanged on update", empty is rejected
  // by Go, and `lib/lead-days.ts` normalises what the form sends.
  leadDays?: number[];
  // Free trial (Feature B). Absent means "no trial / unchanged"; `null` clears a
  // recorded trial. `convertsToPrice` without `trialEndsAt` is the one
  // combination Go rejects (`fieldErrors.convertsToPrice`) — the form enforces
  // that rule by construction, not by a local copy of the server validator.
  trialEndsAt?: string | null;
  convertsToPrice?: number | null;
  // NOTE: there is deliberately no `fromWishlistId` here. The device importer
  // supports that link (`DeviceCreateInput.fromWishlistId`), subscriptions do
  // not: `openapi.yaml`'s `SubscriptionInput` has no such field, Go's strict
  // decoder rejects it with 400, and `services/subscriptions.go` contains no
  // wishlist code. Sending it from the web used to break every create and edit.
  // The wishlist page's "convert to subscription" flow is a prefill only.
};

export type PaymentInput = {
  amount: number;
  paidAt: string;
  note?: string | null;
};

export type SubscriptionFilter = {
  q?: string;
  category?: string;
  status?: string;
  billingCycle?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
};

function buildQuery(filter: SubscriptionFilter | undefined): string {
  if (!filter) return '';
  const sp = new URLSearchParams();
  if (filter.q) sp.set('q', filter.q);
  if (filter.category) sp.set('category', filter.category);
  // `ALL` is a UI sentinel (subscription-filter-bar). Go's list handler only
  // accepts the four real statuses and answers 400 `bad_input` for anything
  // else, so strip it — same convention as `lib/api/devices.ts`.
  if (filter.status && filter.status !== 'ALL') sp.set('status', filter.status);
  if (filter.billingCycle) sp.set('billingCycle', filter.billingCycle);
  if (filter.sort) sp.set('sort', filter.sort);
  if (filter.dir) sp.set('dir', filter.dir);
  const q = sp.toString();
  return q ? `?${q}` : '';
}

export async function list(
  filter?: SubscriptionFilter,
): Promise<ApiResult<{ subscriptions: Subscription[] }>> {
  return apiFetch<{ subscriptions: Subscription[] }>(
    'GET',
    `/v1/subscriptions${buildQuery(filter)}`,
  );
}

export async function get(
  id: string,
): Promise<ApiResult<{ subscription: SubscriptionDetail }>> {
  return apiFetch<{ subscription: SubscriptionDetail }>(
    'GET',
    `/v1/subscriptions/${encodeURIComponent(id)}`,
  );
}

export async function create(
  input: SubscriptionInput,
): Promise<ApiResult<{ subscription: Subscription }>> {
  return apiFetch<{ subscription: Subscription }>('POST', '/v1/subscriptions', input);
}

export async function update(
  id: string,
  input: SubscriptionInput,
): Promise<ApiResult<{ subscription: Subscription }>> {
  return apiFetch<{ subscription: Subscription }>(
    'PATCH',
    `/v1/subscriptions/${encodeURIComponent(id)}`,
    input,
  );
}

export async function remove(id: string): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>(
    'DELETE',
    `/v1/subscriptions/${encodeURIComponent(id)}`,
  );
}

export async function logPayment(
  id: string,
  body: PaymentInput,
): Promise<ApiResult<{ payment: Payment }>> {
  return apiFetch<{ payment: Payment }>(
    'POST',
    `/v1/subscriptions/${encodeURIComponent(id)}/payments`,
    body,
  );
}

export async function renew(id: string): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>(
    'POST',
    `/v1/subscriptions/${encodeURIComponent(id)}/renew`,
  );
}

// ---- Soát gói đăng ký (GET /v1/subscriptions/audit) ---------------------------

// Mirrors services.SubscriptionAuditThresholds. The payload carries its own
// thresholds precisely so a client can show the rule that produced a verdict.
export type SubscriptionAuditThresholds = {
  quietMinAutoCharges: number;
  quietMinMonths: number;
  upcomingRenewalDays: number;
  priceRiseMinPercent: number;
  duplicateNormalized: boolean;
};

export type SubscriptionAuditKind =
  | 'QUIET_AUTO_RENEW'
  | 'PRICE_INCREASED'
  | 'DUPLICATE';

export type SubscriptionAuditReason = 'SAME_NAME' | 'SAME_BRAND_CATEGORY';

// Mirrors services.AuditFinding. `omitempty` fields are absent (not null) when
// the rule does not produce them.
export type SubscriptionAuditFinding = {
  findingKey: string;
  kind: SubscriptionAuditKind | string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  title: string;
  detail: string;
  // One id for the single-subscription rules, two for DUPLICATE.
  subscriptionIds: string[];
  names: string[];
  monthlyVnd: number;
  // Automatic charges already taken (QUIET_AUTO_RENEW). NOT a total of every
  // payment, and never a usage signal.
  chargedTotalVnd: number;
  chargeCount: number;
  // Newest recorded payment — explicitly NOT the last day of use; the app has no
  // such data.
  lastRecordedAt?: string | null;
  nextRenewalAt?: string | null;
  daysUntilRenewal?: number | null;
  previousAmountVnd?: number | null;
  amountVnd?: number | null;
  increaseVnd?: number | null;
  increasePercent?: number | null;
  // false for a rise below `priceRiseMinPercent` — the finding is still
  // reported, only its prominence is the client's call.
  material?: boolean | null;
  reason?: SubscriptionAuditReason | string | null;
};

export type SubscriptionAudit = {
  generatedAt: string;
  findings: SubscriptionAuditFinding[];
  // Same counter shape as the action queue — here it counts findings.
  counts: SubscriptionAuditCounts;
  // Always true: the endpoint has no write path at all.
  advisory: boolean;
  thresholds: SubscriptionAuditThresholds;
  note: string;
};

// Local copy of the shared `ActionCounts` shape so this module stays free of a
// runtime cross-import with `./actions`.
export type SubscriptionAuditCounts = {
  total: number;
  high: number;
  medium: number;
  low: number;
};

// Advisory only. Nothing here (or downstream) cancels, disables auto-renew or
// changes a price — turning a finding into an action stays a user click on the
// existing subscription endpoints.
export async function audit(): Promise<ApiResult<SubscriptionAudit>> {
  return apiFetch<SubscriptionAudit>('GET', '/v1/subscriptions/audit');
}
