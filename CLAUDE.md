# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

```
warranty-vault/
├── website/            # Next.js web UI + legacy backend (server actions, Prisma, cron). See sections below.
├── api/                # Go backend — the canonical API server going forward. See api/README.md.
├── ios/                # Native iOS app (Swift + SwiftUI). See ios/README.md.
├── android/            # Native Android app (Kotlin + Compose). See android/README.md.
├── mobile/             # Cross-platform mobile docs (Firebase setup, etc).
├── openapi.yaml        # Source of truth for the REST API contract — Go server, website client, and both mobile apps all bind to this.
├── BACKEND_GO_PLAN.md  # Phasing for the Next.js → Go migration (ends with Phase F: decommission Next.js /api/v1).
├── MOBILE_PLAN.md      # Phasing for the native rollout.
└── README.md           # Repo overview.
```

**Backend ownership is migrating.** The Go service in `api/` is the canonical backend. The Next.js app in `website/` is transitioning from "fullstack" to "web UI that proxies the Go API":
- Server actions in `website/src/app/actions/*.ts` are being rewritten to call the Go API via `website/src/lib/api/*` (uses `GO_API_URL`). New mutation logic goes in **Go**, not in `website/src/lib/services/`.
- The Next.js `/api/v1/*` routes still wrap local Prisma services and stay around for now — they are decommissioned in Phase F of `BACKEND_GO_PLAN.md`.
- iOS / Android also point at the Go API. Don't add new mobile endpoints to Next.js.

When the user says "the website" or refers to a route/server-action/Prisma path, they mean `website/`. "The API" / "the backend" means `api/` (Go).

## Commands (run from `website/` unless noted)

```bash
cd website
npm run dev              # Next dev server (http://localhost:3000)
npm run build            # prisma generate + next build
npm run start            # serve production build (required for service worker / web push)
npm run lint             # eslint . (uses eslint-config-next/core-web-vitals, flat config)
npm run db:push          # push prisma/schema.prisma to the DB (no migrations folder used)
npm run db:studio        # open Prisma Studio
node scripts/test-backup-restore.mjs       # export/import round-trip against the dev DB
node scripts/test-warranty-refactor.mjs    # multi-warranty + effective-end-date logic
node scripts/test-cron-flow.mjs            # subscription auto-bill + wishlist ping flow
node scripts/migrate-attachments-to-encrypted.mjs   # one-shot migration from public/uploads → private-uploads
```

There is no test framework installed. The `scripts/test-*.mjs` files talk to the real `DATABASE_URL` and create/destroy a scoped test user (`__backup_test__@local.test`, `__cron_test__@local.test`, …) so they're safe to run against the dev DB.

Test the cron endpoint locally: `curl "http://localhost:3000/api/cron/warranty-check?secret=$CRON_SECRET"` (the route also accepts `Authorization: Bearer <CRON_SECRET>` for Vercel Cron).

iOS commands (run from `ios/`): `swift build` to verify the WarrantyVaultKit library; the Xcode project itself is created by the user (see `ios/README.md`).

Android commands (run from `android/`): standard Gradle wrapper after Android Studio generates it (`./gradlew :app:assembleDebug`). See `android/README.md`.

## Architecture

Multi-user, Vietnamese-only Next.js 16 (App Router, React 19) personal **device + warranty + subscription + wishlist** tracker. Postgres 17 via Prisma 7's driver-adapter API (`@prisma/adapter-pg` + `pg`); the same adapter works for hosted Postgres (Neon / Supabase / Render / RDS) — just swap the connection string. The previous SQLite/Turso path was dropped when moving toward a multi-user shared deployment.

**Routing layout (`src/app/`).** Three route groups + a few HTTP routes:
- `(app)/` — protected. `(app)/layout.tsx` calls `requireUser()` (redirects to `/login`); every page below assumes an authenticated user is present. Sections: `dashboard`, `devices`, `subscriptions`, `wishlist`, `reminders`, `stats`, `settings`.
- `(auth)/` — public auth flows (`login`, `register`, `forgot`, `reset/[token]`).
- `(public)/` — landing page (`/`) plus `privacy`, `terms`, `cookies`.
- `api/cron/warranty-check/` — cron entrypoint (warranty + wishlist + subscription notifications and auto-bill).
- `api/files/[id]/` — auth-gated download/inline-stream of an encrypted attachment.

There is no middleware — auth is enforced inside the layout and inside every server action via `requireUser()` / `getCurrentUser()` from `src/lib/auth.ts`. When adding a new mutation, do BOTH: `requireUser()` for identity AND a per-row `findFirst({ where: { id, userId: user.id } })` ownership check before update/delete. This pattern is used in every action under `src/app/actions/`; follow it.

**Sessions.** `iron-session` cookie (`wv_session`), encrypted with `SESSION_SECRET` (must be ≥32 chars; `src/lib/session.ts` throws at import time otherwise). Session contains only `{ userId, email }`; user data is re-fetched on each request.

**Server actions wrap the Go API.** Writes live in `src/app/actions/*.ts` (`'use server'`): `auth`, `devices`, `warranties`, `attachments`, `subscriptions`, `wishlist`, `reminders`, `push`, `backup`, `password-reset`, `catalog`. Each action does `requireUser()` + `revalidatePath()` + form parsing, then forwards to the Go backend via `src/lib/api/*` (`GO_API_URL`). The local Prisma `src/lib/services/*` modules are the legacy implementation — still wired up behind `/api/v1/*` routes for now, but **don't add new business logic there**; put it in Go and call it from the action. New REST endpoints on the Next.js side are only justified for non-JSON streaming (e.g. `/api/files/[id]`) or external hooks that must hit the website.

**Rate limiting (`src/lib/rate-limit.ts`).** Uses Upstash REST when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set; otherwise falls back to in-memory token-bucket on `globalThis` (single Vercel instance / local dev only). Two helpers:
- `rateLimitAuth('login'|'register'|'change-password', identifier)` — call before `prisma.user.findUnique` in auth flows.
- `rateLimitUserWrite(userId)` — 60 writes/min/user. Call at the top of every authenticated mutation server action (every action in `src/app/actions/` already does this).

**Prisma.** `src/lib/prisma.ts` returns a singleton stashed on `globalThis` to survive HMR. Schema in `prisma/schema.prisma` (provider: `postgresql`; **no `url` field** — Prisma 7 driver-adapter pattern reads `DATABASE_URL` from env via the adapter constructor, putting `url` in the schema fails validation). `prisma.config.ts` provides the URL for CLI commands (`db push`, `studio`). Cascades from `User` → `{Device, Subscription, WishlistItem, PushSubscription, PasswordReset}` → child rows, so deleting a user removes everything they own. Money is stored as integer VND across the board (`Device.purchasePrice`, `Warranty.cost`, `Subscription.price`, `WishlistItem.{initialPrice,currentPrice}`, `WishlistPrice.price`, `SubscriptionPayment.amount`).

**Local dev DB.** Two databases on the local Postgres: `warranty_vault_dev` (used by `npm run dev` and the seed scripts) and `warranty_vault_test` (used by `test-backup-restore.mjs` + `test-cron-flow.mjs`). The test scripts default to swapping the dev DB name for the test name; override with `TEST_DATABASE_URL` if you need to point elsewhere. `prisma db push` is idempotent so first run creates tables, later runs are no-ops; the test scripts clean up via a scoped test user (cascades) rather than `--force-reset` (Prisma 7 blocks AI agents from running `--force-reset`).

**Per-user / per-row limits — enforced in app code, not the DB:**
| Constant | Where | Value |
|---|---|---|
| `MAX_DEVICES_PER_USER` | `actions/devices.ts` | 50 |
| `MAX_WARRANTIES_PER_DEVICE` | `actions/warranties.ts` | 5 |
| `MAX_PER_DEVICE` (attachments) | `actions/attachments.ts` | 5 |
| `MAX_BYTES` (single attachment) | `actions/attachments.ts` | 5 MB |
| `MAX_UPLOAD_BYTES_PER_USER` | `actions/attachments.ts` | 100 MB |
| `MAX_SUBS_PER_USER` (software subs) | `actions/subscriptions.ts` | 100 |
| `MAX_WISHLIST_PER_USER` | `actions/wishlist.ts` | 200 |

**Domain models worth knowing:**
- `Device` has 0..N `Warranty` rows (types: `STANDARD | EXTENDED | THIRD_PARTY`). The device's effective warranty end is `max(endDate)` over its warranties; helpers in `src/lib/warranty.ts`. Cron loops over `Warranty`, not `Device`.
- `Subscription` covers recurring software/services (Apple One, ChatGPT Plus). `billingCycle ∈ {MONTHLY, QUARTERLY, YEARLY, LIFETIME, CUSTOM}`; `CUSTOM` requires `intervalDays`. `nextRenewalDate()` and `monthlyEquivalent()` live in `src/lib/subscription-types.ts`. `SubscriptionPayment` is an append-only billing log written by the cron.
- `WishlistItem` is a "thèm" list (not yet purchased). `WishlistPrice` is an append-only price-history log; updating `currentPrice` writes a new row. When a user marks an item `PURCHASED`, the action creates a `Device` row and stores the link in `purchasedDeviceId` (`Device.wishlistOrigin` relation).
- Global catalogs (`Category`, `Brand`, `BrandCategory`, `Store`, `WarrantyProvider`) are admin-curated via Prisma Studio and used for autocomplete/autofill in device & subscription forms. Cached via `unstable_cache` in `src/app/actions/catalog.ts`.

**Encrypted attachments (`src/lib/files.ts` + `src/app/actions/attachments.ts`).** Files are AES-256-GCM encrypted at rest under `PRIVATE_UPLOAD_ROOT` (default `private-uploads/`, settable via env — Docker mounts `/data/uploads`). Per-file random data key, wrapped with `FILE_MASTER_KEY` (≥32 bytes, base64 or hex), wrapped key + IV stored on the `Attachment` row. **Disk alone or DB alone cannot decrypt — both are needed.** Strict MIME whitelist (`image/{jpeg,png,webp,gif,heic}`, `application/pdf`) plus magic-byte verification — SVG/HTML/JS never allowed. Images >1600px are downscaled by `sharp` before encryption. Files are served via `GET /api/files/<attachmentId>` (auth + per-row ownership), with `Cache-Control: private, no-store` and a sandboxing CSP header. `?download=1` flips Content-Disposition to attachment. There is no public `/uploads/*` URL anymore. To rotate `FILE_MASTER_KEY`, re-wrap every `Attachment.wrappedKey` (no need to re-encrypt blobs) — see comment in `files.ts`.

**Push notifications.** `src/lib/push.ts` lazily configures `web-push` from `VAPID_*` env vars (throws if missing). The cron at `api/cron/warranty-check` is one endpoint that fans out four kinds of notifications:
1. **Warranty expiry** — for every `ACTIVE` device whose warranty ends in exactly 7 or 30 days, skipping warranties whose `Reminder.isDismissed = true`.
2. **Wishlist target date** — for items in `WISHLIST_ACTIVE_STATUSES` (`WATCHING | DECIDED`) whose `targetDate` is today / +7 / +30. Stamps `lastNotifiedAt`.
3. **Wishlist periodic check-in** — items with `reminderIntervalDays` set get pinged every N days based on `lastNotifiedAt ?? createdAt`. The elapsed check is computed client-side (a leftover from the SQLite era — Postgres can do `now() - interval` in `WHERE` and we could push it down, but item count is small so it's not a bottleneck).
4. **Subscription renewal** — `ACTIVE`, non-`LIFETIME` subs whose `renewalDate` is today / +1 / +3. Subs whose `renewalDate` has passed get auto-billed in a transaction (append `SubscriptionPayment` + advance `renewalDate` via `nextRenewalDate()`); `autoRenew=false` flips status to `EXPIRED` instead.

A 404/410 from the push service means the subscription is gone — the route deletes it. Push only works against `npm run start` (service worker), not `npm run dev`.

**Security headers (`next.config.mjs`).** Strict CSP (`default-src 'self'`), no inline scripts in prod beyond Next's bootstrap, `unsafe-eval` only in dev for HMR. HSTS only in prod. When adding third-party scripts/fonts/images, update the CSP — don't loosen it globally. Note: `public/uploads/*` is no longer used — files go through `/api/files/[id]` which sets its own CSP.

## Conventions

- **All user-facing strings are Vietnamese.** Error messages, validation messages, button labels, toast text — everything. Label tables in `src/lib/types.ts`, `subscription-types.ts`, `wishlist-types.ts` and every `z.string().min(...)` message in the actions are Vietnamese. Match this when adding new copy.
- Path alias `@/*` → `src/*` (see `tsconfig.json`).
- Validation: every server action parses `FormData` with a Zod schema and returns `{ ok, errors?, message? }` for `useFormState`. Don't trust raw form data. The actions use a `blankToNull` preprocess so empty form fields don't get coerced to `0` and trip `.min(1)`.
- After mutating, call `revalidatePath` for every page that reads the changed data (typical sets: device writes → `/dashboard`, `/devices`, `/devices/[id]`, `/reminders`; subscription writes → `/dashboard`, `/subscriptions`, `/stats`; wishlist writes → `/dashboard`, `/wishlist`).
- `prisma generate` runs in `postinstall` and at the start of `build` — committed Prisma client code is not needed.

## Mobile clients

Native apps live in `ios/` and `android/`. Both are pure REST clients of the **Go** backend in `api/`; the same endpoints are codegen'd from `openapi.yaml`. When adding a new feature, add the endpoint to `openapi.yaml` + implement it in `api/` first, then wire up the Next.js action (proxy) and the iOS/Android clients.

- **Auth.** Web uses `iron-session` cookie (`wv_session`). Mobile + Go API use opaque bearer tokens. During the transition, `website/src/lib/auth.ts` still recognizes both (bearer first, then cookie); the Go server is the canonical issuer.
- **Push.** `PushSubscription.platform ∈ {web, apns, fcm}`. Web push (VAPID) is still fanned out from the Next.js cron during transition; APNs/FCM live in Go (env vars below). When env is missing, the helpers no-op.
- **Vietnamese copy.** Mobile labels mirror the web ones in `website/src/lib/types.ts`. iOS duplicates them in `ios/Sources/WarrantyVaultKit/Models.swift`; Android in `android/.../network/Models.kt`. When you change a Vietnamese label on the web, update the mobile copies too.

## Env vars (cross-service)

`website/` env (in addition to `DATABASE_URL`, `SESSION_SECRET`, `FILE_MASTER_KEY`, `VAPID_*`, `CRON_SECRET`):
- `GO_API_URL` — base URL of the Go backend. Required once an action is migrated to proxy mode.
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — optional. When both are set, rate limiting uses Upstash; otherwise in-memory.

`api/` (Go) env — push fanout for mobile:
- `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY_P8` — iOS push (APNs token auth, P8 key inline).
- `FCM_SERVICE_ACCOUNT_JSON` — Android push (FCM service account JSON inline).

See `api/README.md` for the full Go-side env list and `website/.env.example` for the web side.
