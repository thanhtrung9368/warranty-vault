-- WarrantyVault initial schema, hand-translated from website/prisma/schema.prisma.
-- Source-of-truth ownership transfers to this file (and subsequent goose migrations)
-- after BACKEND_GO_PLAN.md Phase F. Until then, keep this file in sync if Prisma schema changes.
--
-- Notes:
--   * Prisma 7 generated `text` columns for string id/enum-like fields. The schema uses
--     `String` (not Prisma enum), so all "enum" values (DeviceStatus, WarrantyType,
--     BillingCycle, SubscriptionStatus, WishlistStatus, WishlistPriority) are plain
--     `text` with app-level validation. We keep that here — no `CREATE TYPE` needed.
--   * Timestamps mirror Prisma's mapping: `timestamp(3) without time zone`
--     with `DEFAULT CURRENT_TIMESTAMP`. UTC is assumed at the application layer.
--   * Primary keys are `text` populated by the app with cuid() — no DB-side default.
--   * Money columns (Device.purchasePrice, Warranty.cost, Subscription.price,
--     SubscriptionPayment.amount, WishlistItem.{initialPrice,currentPrice},
--     WishlistPrice.price) are integer VND.
--   * Foreign keys mirror Prisma's `onDelete: Cascade | SetNull` (Prisma always emits
--     `ON UPDATE CASCADE`).

-- +goose Up
-- +goose StatementBegin

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    name text,
    "passwordHash" text NOT NULL,
    "passwordChangedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);

CREATE TABLE public."Session" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "tokenHash" text NOT NULL,
    "deviceLabel" text,
    platform text,
    "lastSeenAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "revokedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "Session_pkey" PRIMARY KEY (id),
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON public."Session" USING btree ("tokenHash");
CREATE INDEX "Session_userId_idx" ON public."Session" USING btree ("userId");
CREATE INDEX "Session_expiresAt_idx" ON public."Session" USING btree ("expiresAt");

CREATE TABLE public."PasswordReset" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "tokenHash" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY (id),
    CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON public."PasswordReset" USING btree ("tokenHash");
CREATE INDEX "PasswordReset_userId_idx" ON public."PasswordReset" USING btree ("userId");
CREATE INDEX "PasswordReset_expiresAt_idx" ON public."PasswordReset" USING btree ("expiresAt");

CREATE TABLE public."Category" (
    code text NOT NULL,
    name text NOT NULL,
    "sortOrder" integer DEFAULT 100 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    CONSTRAINT "Category_pkey" PRIMARY KEY (code)
);

CREATE TABLE public."Brand" (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    CONSTRAINT "Brand_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "Brand_slug_key" ON public."Brand" USING btree (slug);

CREATE TABLE public."BrandCategory" (
    "brandId" text NOT NULL,
    "categoryCode" text NOT NULL,
    CONSTRAINT "BrandCategory_pkey" PRIMARY KEY ("brandId", "categoryCode"),
    CONSTRAINT "BrandCategory_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES public."Brand"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "BrandCategory_categoryCode_fkey" FOREIGN KEY ("categoryCode") REFERENCES public."Category"(code) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX "BrandCategory_categoryCode_idx" ON public."BrandCategory" USING btree ("categoryCode");

CREATE TABLE public."Store" (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    type text DEFAULT 'BOTH'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    CONSTRAINT "Store_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "Store_slug_key" ON public."Store" USING btree (slug);

CREATE TABLE public."WarrantyProvider" (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    phone text,
    address text,
    "websiteUrl" text,
    notes text,
    "isActive" boolean DEFAULT true NOT NULL,
    CONSTRAINT "WarrantyProvider_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "WarrantyProvider_slug_key" ON public."WarrantyProvider" USING btree (slug);

CREATE TABLE public."Device" (
    id text NOT NULL,
    "userId" text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    brand text,
    model text,
    "serialNumber" text,
    "purchaseDate" timestamp(3) without time zone NOT NULL,
    "purchasePrice" integer NOT NULL,
    "purchasePlace" text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "Device_pkey" PRIMARY KEY (id),
    CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX "Device_userId_idx" ON public."Device" USING btree ("userId");
CREATE INDEX "Device_purchaseDate_idx" ON public."Device" USING btree ("purchaseDate");
CREATE INDEX "Device_category_idx" ON public."Device" USING btree (category);
CREATE INDEX "Device_status_idx" ON public."Device" USING btree (status);

CREATE TABLE public."Warranty" (
    id text NOT NULL,
    "deviceId" text NOT NULL,
    type text NOT NULL,
    provider text,
    "startDate" timestamp(3) without time zone NOT NULL,
    "endDate" timestamp(3) without time zone NOT NULL,
    months integer NOT NULL,
    cost integer,
    address text,
    phone text,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "Warranty_pkey" PRIMARY KEY (id),
    CONSTRAINT "Warranty_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES public."Device"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX "Warranty_deviceId_idx" ON public."Warranty" USING btree ("deviceId");
CREATE INDEX "Warranty_endDate_idx" ON public."Warranty" USING btree ("endDate");
CREATE INDEX "Warranty_type_idx" ON public."Warranty" USING btree (type);

CREATE TABLE public."Attachment" (
    id text NOT NULL,
    "deviceId" text NOT NULL,
    "fileName" text NOT NULL,
    "storagePath" text NOT NULL,
    "fileType" text NOT NULL,
    "fileSize" integer NOT NULL,
    iv bytea NOT NULL,
    "wrappedKey" bytea NOT NULL,
    description text,
    "uploadedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "Attachment_pkey" PRIMARY KEY (id),
    CONSTRAINT "Attachment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES public."Device"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX "Attachment_deviceId_idx" ON public."Attachment" USING btree ("deviceId");

CREATE TABLE public."Reminder" (
    id text NOT NULL,
    "warrantyId" text NOT NULL,
    "isDismissed" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "Reminder_pkey" PRIMARY KEY (id),
    CONSTRAINT "Reminder_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES public."Warranty"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX "Reminder_warrantyId_idx" ON public."Reminder" USING btree ("warrantyId");
CREATE INDEX "Reminder_isDismissed_idx" ON public."Reminder" USING btree ("isDismissed");

CREATE TABLE public."Subscription" (
    id text NOT NULL,
    "userId" text NOT NULL,
    name text NOT NULL,
    category text,
    brand text,
    plan text,
    "billingCycle" text NOT NULL,
    "intervalDays" integer,
    price integer NOT NULL,
    currency text DEFAULT 'VND'::text NOT NULL,
    "startedAt" timestamp(3) without time zone NOT NULL,
    "renewalDate" timestamp(3) without time zone NOT NULL,
    "autoRenew" boolean DEFAULT true NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "accountEmail" text,
    "paymentMethod" text,
    "manageUrl" text,
    "cancelUrl" text,
    notes text,
    "lastNotifiedRenewalAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY (id),
    CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX "Subscription_userId_idx" ON public."Subscription" USING btree ("userId");
CREATE INDEX "Subscription_renewalDate_idx" ON public."Subscription" USING btree ("renewalDate");
CREATE INDEX "Subscription_status_idx" ON public."Subscription" USING btree (status);

CREATE TABLE public."SubscriptionPayment" (
    id text NOT NULL,
    "subscriptionId" text NOT NULL,
    amount integer NOT NULL,
    "paidAt" timestamp(3) without time zone NOT NULL,
    note text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY (id),
    CONSTRAINT "SubscriptionPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES public."Subscription"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX "SubscriptionPayment_subscriptionId_idx" ON public."SubscriptionPayment" USING btree ("subscriptionId");
CREATE INDEX "SubscriptionPayment_paidAt_idx" ON public."SubscriptionPayment" USING btree ("paidAt");

CREATE TABLE public."WishlistItem" (
    id text NOT NULL,
    "userId" text NOT NULL,
    name text NOT NULL,
    category text,
    brand text,
    "initialPrice" integer,
    "currentPrice" integer,
    "buyUrl" text,
    "imageUrl" text,
    "targetDate" timestamp(3) without time zone,
    priority text DEFAULT 'WANT'::text NOT NULL,
    status text DEFAULT 'WATCHING'::text NOT NULL,
    notes text,
    "reminderIntervalDays" integer,
    "lastNotifiedAt" timestamp(3) without time zone,
    "purchasedDeviceId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY (id),
    CONSTRAINT "WishlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "WishlistItem_purchasedDeviceId_fkey" FOREIGN KEY ("purchasedDeviceId") REFERENCES public."Device"(id) ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX "WishlistItem_userId_idx" ON public."WishlistItem" USING btree ("userId");
CREATE INDEX "WishlistItem_status_idx" ON public."WishlistItem" USING btree (status);
CREATE INDEX "WishlistItem_targetDate_idx" ON public."WishlistItem" USING btree ("targetDate");
CREATE INDEX "WishlistItem_purchasedDeviceId_idx" ON public."WishlistItem" USING btree ("purchasedDeviceId");

CREATE TABLE public."WishlistPrice" (
    id text NOT NULL,
    "itemId" text NOT NULL,
    price integer NOT NULL,
    note text,
    "recordedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "WishlistPrice_pkey" PRIMARY KEY (id),
    CONSTRAINT "WishlistPrice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES public."WishlistItem"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX "WishlistPrice_itemId_idx" ON public."WishlistPrice" USING btree ("itemId");
CREATE INDEX "WishlistPrice_recordedAt_idx" ON public."WishlistPrice" USING btree ("recordedAt");

CREATE TABLE public."PushSubscription" (
    id text NOT NULL,
    "userId" text NOT NULL,
    endpoint text NOT NULL,
    p256dh text,
    auth text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    platform text DEFAULT 'web'::text NOT NULL,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY (id),
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON public."PushSubscription" USING btree (endpoint);
CREATE INDEX "PushSubscription_userId_idx" ON public."PushSubscription" USING btree ("userId");
CREATE INDEX "PushSubscription_platform_idx" ON public."PushSubscription" USING btree (platform);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS public."PushSubscription";
DROP TABLE IF EXISTS public."WishlistPrice";
DROP TABLE IF EXISTS public."WishlistItem";
DROP TABLE IF EXISTS public."SubscriptionPayment";
DROP TABLE IF EXISTS public."Subscription";
DROP TABLE IF EXISTS public."Reminder";
DROP TABLE IF EXISTS public."Attachment";
DROP TABLE IF EXISTS public."Warranty";
DROP TABLE IF EXISTS public."Device";
DROP TABLE IF EXISTS public."WarrantyProvider";
DROP TABLE IF EXISTS public."Store";
DROP TABLE IF EXISTS public."BrandCategory";
DROP TABLE IF EXISTS public."Brand";
DROP TABLE IF EXISTS public."Category";
DROP TABLE IF EXISTS public."PasswordReset";
DROP TABLE IF EXISTS public."Session";
DROP TABLE IF EXISTS public."User";

-- +goose StatementEnd
