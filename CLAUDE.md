# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

```
warranty-vault/
├── website/            # Next.js web UI — thin frontend that proxies the Go API. See sections below.
├── api/                # Go backend — the canonical API server. See api/README.md.
├── ios/                # Native iOS app (Swift + SwiftUI). See ios/README.md.
├── android/            # Native Android app (Kotlin + Compose). See android/README.md.
├── mobile/             # Cross-platform mobile docs (Firebase setup, etc).
├── docs/               # FEATURE_ROADMAP.md (15 ranked items + live status), HUMAN_TASKS.md
│                       # (owner-only work), SPEC-WARRANTY-CLAIM.md, SPEC-MAINTENANCE-SCHEDULES.md.
├── deploy/             # Caddyfile, systemd units, backup.sh, PRODUCTION_CHECKLIST.md, README.md.
├── openapi.yaml        # Source of truth for the REST API contract — Go server, website client, and both mobile apps all bind to this.
├── NEXT.md             # Live plan / what's left. BACKEND_GO_PLAN.md + MOBILE_PLAN.md are history.
└── README.md           # Repo overview.
```

**Backend lives in Go.** The Next.js app in `website/` is a pure web UI — every read/write goes through `website/src/lib/api/*` (a typed client over `GO_API_URL`) and the Go service is the only thing that talks to Postgres. There is no Prisma, no `/api/v1/*`, no cron route in the website any more — schema management is in `api/migrations/` (goose), and the canonical cron is `api/cmd/cron` (also exposed as `POST /api/v1/cron/warranty-check`).

When the user says "the website" they mean `website/`. "The API" / "the backend" means `api/` (Go). Mobile / iOS / Android clients also hit the Go service directly.

## Commands

```bash
cd website
npm run dev              # Next dev server (http://localhost:3000)
npm run build            # next build
npm run start            # serve production build (required for service worker / web push)
npm run lint             # eslint . (uses eslint-config-next/core-web-vitals, flat config)
npm test                 # vitest run (unit tests under src/**/__tests__/)
```

Test the cron endpoint: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:4000/api/v1/cron/warranty-check` (Go service). Schema management is via goose in `api/migrations/` (`go run ./cmd/migrate up` / `status` / `down`). The HTTP end-to-end suite is `api/scripts/test_*.sh`, and `api/scripts/e2e.sh` is the runner that makes it usable: it creates a throwaway database, migrates it, builds and starts the server on a test port, runs every script, and drops the database afterwards (`--only <name>`, `--go-tests`, `--list`). The scripts need no `psql` — SQL goes through `api/scripts/dbtool` (Go + pgx).

`bash api/scripts/check_openapi_drift.sh` diffs the `"METHOD /api/…"` literals registered in `api/cmd/server/main.go` + `api/internal/handlers/` against `openapi.yaml`; CI (`api.yml`) fails on drift. It currently reports **67 endpoints** across 48 paths (a number that keeps moving — trust the script, not this line) — add the route literal *and* the openapi entry in the same commit or CI goes red. Re-derive both: the script prints the endpoint count itself, and the path count is the number of distinct `paths:` keys carrying at least one method in `openapi.yaml`.

iOS (`cd ios/`): `swift build` verifies the `WarrantyVaultKit` library; `swift test` runs its 324 tests (a fast-moving number — the iOS client is under active development, so trust the run over this line; the runner prints `Executed N tests`). On this machine `xcode-select` still points at CommandLineTools, so the suite needs `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --disable-sandbox`. The Xcode app project itself is created by the user (see `ios/README.md`), which is why CI only builds the library.

Android (`cd android/`): `./gradlew :app:testDebugUnitTest --no-daemon` (needs `ANDROID_HOME` + `JAVA_HOME`; 419 tests in 41 classes — re-derive from the JUnit XML under `app/build/test-results/`). `android.yml` fails if the task produces no test-result XML — it used to report `NO-SOURCE` and pass silently.

## Architecture

Multi-user, Vietnamese-only Next.js 16 (App Router, React 19) personal **device + warranty + subscription + wishlist** tracker. All persistence is in Postgres 17, owned by the Go service.

**Routing layout (`src/app/`).** Three route groups + one HTTP route:
- `(app)/` — protected. `(app)/layout.tsx` calls `requireUser()` (redirects to `/login`); every page below assumes an authenticated user is present. Sections: `dashboard`, `devices`, `subscriptions`, `wishlist`, `reminders`, `stats`, `settings`.
- `(auth)/` — public auth flows (`login`, `register`, `forgot`, `reset/[token]`).
- `(public)/` — landing page (`/`) plus `privacy`, `terms`, `cookies`.
- `api/files/[id]/` — only Next.js HTTP route left. Thin proxy: reads the bearer token from the iron-session cookie and forwards to Go's `GET /api/files/{id}` (auth-gated, ownership-checked, decrypts blob, streams body). Re-emits defensive security headers locally. (Go route names: everything else is `/api/v1/*`, but file streaming is deliberately `/api/files/{id}` — see `api/internal/handlers/attachments.go`.)

There is no middleware — the `(app)/` layout calls `requireUser()` from `src/lib/auth.ts` (reads the bearer token from the iron-session cookie and calls `GET /api/v1/auth/me` against Go, deduped per request via React `cache()`), and Go enforces auth on every request. Server actions do *not* each re-check identity: calls through `src/lib/api/*` attach the cookie's bearer via `bearerHeader()` (empty object when the cookie is missing/expired) and Go answers 401. Only the actions that need the user object up front (`backup.ts`, `ai.ts`) call `requireUser()` explicitly. Per-row ownership is the Go server's responsibility — every Go handler does `AND userId = $1` on its queries; the web does not re-check.

**Sessions.** `iron-session` cookie (`wv_session`), encrypted with `SESSION_SECRET` (≥32 chars). Stores only `{ accessToken, expiresAt }` — userID/email come from `GET /api/v1/auth/me` per request.

**Server actions are thin Go proxies.** Writes live in `src/app/actions/*.ts` (`'use server'`): `auth`, `devices`, `warranties`, `attachments`, `subscriptions`, `wishlist`, `reminders`, `push`, `backup`, `password-reset`, `catalog`, `ai`. Each action parses its `FormData`/payload and forwards to Go via `src/lib/api/*`, then maps the result for `useFormState`. Form parsing is mostly hand-rolled (`str()` / `num()` helpers in e.g. `devices.ts`) — only the pre-auth flows `auth.ts` and `password-reset.ts` use a local Zod schema; everywhere else Go's validator produces the Vietnamese `fieldErrors`. `revalidatePath()` is called after mutations where the affected pages aren't already `dynamic = 'force-dynamic'` (device create, for instance, deliberately skips it — see the comment in `devices.ts`). **All business logic, rate limiting, encryption, push fanout, and validation lives in Go** — see `api/internal/{services,handlers,httpx,files,push,ratelimit,email}/`. Don't add `prisma.*`, `web-push`, `resend`, `sharp`, `bcrypt`, or `pg` back into the web — those deps are gone on purpose.

**Per-user / per-row limits — enforced in Go** (`api/internal/services/`):
| Constant | Where | Value |
|---|---|---|
| MAX_DEVICES_PER_USER | `services/devices.go` | 50 **active** (any status other than `SOLD`) |
| MAX_DEVICES_TOTAL_PER_USER | `services/devices.go` | 500 rows in total, sold ones included |
| MAX_WARRANTIES_PER_DEVICE | `services/warranties.go` | 5 |
| MAX_ATTACHMENTS_PER_DEVICE | `services/attachments.go` | 5 |
| MAX_ATTACHMENT_BYTES | `services/attachments.go` | 5 MB |
| MAX_UPLOAD_BYTES_PER_USER | `services/attachments.go` | 100 MB |
| MAX_SUBS_PER_USER | `services/subscriptions.go` | 100 |
| MAX_WISHLIST_PER_USER | `services/wishlist.go` | 200 |

Both device ceilings are applied by the single rule `enforceDeviceQuota` (`services/devices.go`), reached on **three** write paths into `Device`: `CreateDevice`, the backup importer (`services/backup.go`), and wishlist → `PURCHASED` (`services/wishlist.go`) — that last one used to bypass the limit entirely. A write that adds no active rows skips the active count. Deliberately *not* blocked: un-selling a device, so an account can sit above 50 active rows after undoing a mistaken sale (bounded by the 500-row ceiling). Clients must treat `status`, not the quota, as the source of truth for "how many devices do I have".

The web doesn't pre-validate these. Which status a limit surfaces as: **`LIMIT_REACHED` → 409** with a Vietnamese `message` (the action surfaces it through `useFormState`), while `VALIDATION` and `CATEGORY_INVALID` → 400. The 409 was previously a 400 in Go while `openapi.yaml` documented 409; Go was the side that was wrong and it was fixed in `services/errors.go`, so a client that stops a doomed bulk import on 409 now really does get 409.

**Migrations (`api/migrations/`, goose).** Thirteen so far — `ls api/migrations/` is the authority:
- `0001_initial` (17 tables) · `0002_cron_idempotency` · `0003_user_ai_optin`.
- `0004_seed_category_catalog` (the 20 `CATEGORY_LABELS` codes — without it no device can be created on a fresh DB) · `0008_seed_brand_store_warranty_provider` (the other three catalogs, so a fresh DB has working pickers and `BrandCategory` + the OCR `matchBrand` path are not dead code).
- `0005_device_search_unaccent` + `0007_locale_safe_unaccent` (search: `0007` rebuilds the indexes on `lower(public.wv_unaccent(x))` because `0005`'s `wv_unaccent(lower(x))` order is wrong under a C collation).
- `0006_device_resale` (`Device.soldAt`/`soldPrice`) · `0009_email_change` (adds `PasswordReset.pendingEmail` for the two-step email change).
- `0010_return_window` — `Device.returnWindowDays` / `receivedAt` / `returnWindowNotifiedAt`, the retailer "1 đổi 1" exchange deadline (FEATURE_IDEAS #1). It lives on `Device` rather than `Reminder` because `Reminder.warrantyId` is NOT NULL and `isDismissed` there gates real warranty push.
- `0011_decision_snooze` — table `DecisionSnooze`, keyed per user by the string `<KIND>:<entityId>` (action items are derived, so there is no row to point at), unique on `(userId, itemKey)` so "hoãn lại" is an upsert (FEATURE_IDEAS #3).
- `0012_brand_service_info` — table `BrandServiceInfo`, the brand → vendor service-page directory (FEATURE_IDEAS #15). Deliberately stores the vendor's own lookup URL and **not** phone numbers or street addresses, which 0008 already refused to invent.
- `0013_device_share` — table `DeviceShare`, token-hashed read-only share links. This is the first row in the schema that grants read access to a non-owner; the only unauthenticated read path in the service is keyed on its `tokenHash`.

`deploy/PRODUCTION_CHECKLIST.md` §2 pins the same list and is currently **in sync** at 13 — keep it that way when you add one. Migrations run through `api/cmd/migrate`, which refuses destructive commands unless `WV_ALLOW_DESTRUCTIVE=1`.

**Search.** Device search (`GET /api/v1/devices?q=`) is diacritic-insensitive via the `IMMUTABLE` SQL wrapper `public.wv_unaccent` + four GIN trigram indexes over `lower(public.wv_unaccent(col))` for `name`/`brand`/`model`/`serialNumber`. The index expression and the query predicate in `api/internal/store/queries/devices.sql` must stay byte-for-byte identical or the planner silently stops using them. Cross-entity search is a separate endpoint — `GET /api/v1/search?q=&limit=` returns `{query, devices[], subscriptions[], wishlist[]}` in one round trip (`services/search.go`): groups are always `[]` (never `null`), `limit` is **per group** (default 20, max 50), a blank `q` is a 200 with empty groups (deleting the last character of a search box must not raise an error), and `q` over 200 runes is a 400. The per-entity `q`/`status` filters on the list endpoints are unchanged. All of this needs the database to be **UTF-8 encoded** (a non-UTF-8 cluster stores no Vietnamese characters and search returns empty with no error); collation no longer matters. `services/device_search_locale_test.go` covers it against both C and UTF-8 clusters.

**Domain models.** Same shape as before — see `openapi.yaml` for the canonical schemas and `api/internal/store/queries/*.sql` for the DB definitions. Highlights:
- `Device` has 0..N `Warranty` rows (`STANDARD | EXTENDED | THIRD_PARTY`). Effective warranty end = `max(endDate)` across rows. The helper `effectiveWarrantyEnd()` in `src/lib/warranty.ts` is RSC-friendly (takes plain JSON, no DB access) and is unit-tested in `src/lib/__tests__/warranty.test.ts`.
- `Device` also carries the resale pair `soldAt` / `soldPrice` (nullable, migration `0006`). They must be sent together or not at all — enforced in `services.ValidateDeviceInput`, not by a DB constraint, so legacy rows can't be rejected. `status = 'SOLD'` alone stays valid and just means "sold, details not recorded". Profit/loss = `soldPrice − purchasePrice`.
- `Subscription` covers recurring software/services. `billingCycle ∈ {MONTHLY, QUARTERLY, YEARLY, LIFETIME, CUSTOM}`. `monthlyEquivalent()` + `nextRenewalDate()` in `src/lib/subscription-types.ts` are pure functions, also reused in RSC for dashboard totals.
- `WishlistItem` is a "thèm" list. Marking PURCHASED creates a `Device` row in the same Go transaction (see openapi `PATCH /api/v1/wishlist/{id}` and `services/wishlist.go`).
- Global catalogs (Category / Brand / Store / WarrantyProvider) are curated in the DB. Web reads them via `getCategories()` and `getDeviceFormCatalog()` in `src/app/actions/catalog.ts` — the latter backs every combobox in the device form. Both slice a single `GET /v1/catalog` call (deduped per render by React `cache()`). That endpoint is auth-gated, so `unstable_cache` can't wrap it; the fetch in `src/lib/api/catalog.ts` opts into Next's Data Cache instead (`revalidate: 300`, tag `catalog`). There is **no admin UI** — the tables are populated by migrations `0004` (Category) and `0008` (Brand / Store / WarrantyProvider) and edited directly in Postgres afterwards (`services/catalog.go` says so explicitly, and has a 60 s in-process cache with `InvalidateCatalogCache()` for out-of-band edits).

**Two narrow write paths worth knowing:**
- `PATCH /api/v1/auth/me` accepts **only** `displayName` (≤80 bytes; `""`/`null` clears). Changing the account email is a **separate two-step flow**: `POST /api/v1/auth/change-email` (requires the current password, rate-limited) mails a single-use token to the **new** address, and `POST /api/v1/auth/confirm-email-change` consumes it. The token reuses the `PasswordReset` table with `pendingEmail` set (migration `0009`), and the queries keep the two purposes strictly disjoint — an email-change token can never set a password and vice versa. The old address keeps working until confirm. The mailed link points at `<APP_URL>/confirm-email/<token>`: web has both that page (`src/app/(auth)/confirm-email/[token]/page.tsx`) and the request form (`components/email-change-form.tsx`), and iOS has `EmailChangeSheet.swift` (it cannot open the mailed link, so it accepts the pasted token or the whole URL). **Android is the remaining gap** — `ProfileEditSheet.kt` still states email change is unsupported, which is no longer true of the contract.
- `PATCH /api/v1/attachments/{id}` accepts **only** `description`. There is no PATCH endpoint for the blob itself.

**Reminders feed.** `GET /api/v1/reminders?withinDays=&includeDismissed=` is opt-in. With `includeDismissed=false` (default) `withinDays` and the ACTIVE-device filter apply and the response is byte-identical to the pre-existing one. With `true` the dismissed rows are added and **neither filter applies to them** — a reminder hidden long ago, or hidden on a device that was later sold, stays visible instead of silently vanishing. Dismissed rows are bounded structurally by the write paths, and `ReminderRow.isDismissed` is `omitempty`, so it is serialised only when `true`. Web and iOS read this feed for their "Đã ẩn" list; Android still only offers undo-after-dismiss. ⚠️ The bound is quoted as **250 (50 devices × 5 warranties)** in the comments on `services/reminders.go` and `store/queries/warranties.sql`, but that arithmetic predates the 500-row total device ceiling (migration-era `0010`/`#14`): with sold devices countable, the real structural bound is **2500 (500 × 5)**. The comments are stale, the code is not — there is no `LIMIT` on the query.

**Stats (`GET /api/v1/stats`).** `devices.totalWarrantyCost` is the new field (SUM of `Warranty.cost`). Only Android reads it. The web `/stats` page and iOS both recompute the same rollup on their own side (web: `src/lib/stats-rollup.ts` in RSC; iOS: `Sources/WarrantyVaultKit/StatsRollup.swift`) and use Go only for the subscription totals — so changing the money math in one client does not change the others. Test fixtures exist on all three sides.

**Encrypted attachments.** Everything is in Go — see `api/internal/files/` (AES-256-GCM, per-file data key wrapped with `FILE_MASTER_KEY`, magic-byte whitelist, image downscale, served via `GET /api/files/{id}`). The web only proxies the byte stream through `app/api/files/[id]/route.ts` so cookie-based auth works in the browser. To rotate `FILE_MASTER_KEY`, re-wrap every `Attachment.wrappedKey` server-side; see `api/README.md`. Accepted types are JPG/PNG/WEBP/GIF/HEIC + PDF (`files/mime.go`); PDF and HEIC skip the downscale step. OCR has its own, narrower gate: `ai.IsSupportedReceiptType` (`api/internal/ai/extract.go`) accepts the three image types that Anthropic has a content block for **plus `application/pdf`**, which is sent as a `document` block — so **PDF receipts CAN be OCR'd** (that changed with roadmap #15; it used to be a flat 400). GIF and HEIC are still refused with a clear 400 before any paid model call, because there is no block type for them. The service-level gate is `services/ai_extract.go`.

**Backup format (`GET /api/v1/backup/export[?includeBlobs=true]`, `POST /api/v1/backup/import?mode=merge|replace`).** Two shapes on the same endpoints, and the payload is self-describing in both:
- **JSON, version 5 (default)** — user, devices (+ warranties + reminders), subscriptions (+ payments), wishlist (+ prices), attachment **metadata only**. Envelope says `includesAttachmentBytes: false` + `attachmentBytesNote` (Vietnamese, "KHÔNG chứa nội dung ảnh…"). This document is byte-for-byte the old format on purpose, so v5 files and v5-only importers keep working.
- **ZIP, version 6 (`includeBlobs=true`, `Content-Type: application/zip`)** — the same document plus each attachment's encrypted blob, and the note flips to "CÓ chứa … cần đúng `FILE_MASTER_KEY`". Blobs are AES-256-GCM ciphertext, so restoring them elsewhere without the matching `FILE_MASTER_KEY` imports the files but cannot decrypt them. `missingAttachmentIds` lists blobs absent from disk at export time (export still succeeds rather than silently shipping a smaller backup).

Import accepts **both** on the same route, deciding by ZIP magic (`PK\x03\x04`) rather than a filename or header, and `MinBackupVersion` stays 5 so older files remain importable. `services/backup_honesty_test.go` pins the honesty fields. Operator-side, `deploy/backup.sh` archives the blob volume alongside the `pg_dump`. `openapi.yaml` **does** document `includeBlobs` now (the `/api/v1/backup/export` description and the query parameter), so the earlier "not documented there yet" warning no longer applies — but note it documents the 400/401 responses only, while the importer can also answer **409** when the payload would break the device ceiling.

**Push notifications.** Web push (VAPID), APNs (.p8 token auth), and FCM (service account) all live in Go (`api/internal/push/`). The cron job at `api/cmd/cron` (also `POST /api/v1/cron/warranty-check`) fans out warranty-expiry, wishlist target-date, wishlist check-in, and subscription-renewal notifications. The subscribed device's `platform` field (`web | apns | fcm`) routes the payload. 404/410 from any backend → Go deletes the `PushSubscription` row.

**Rate limiting.** Per-endpoint, in Go (`api/internal/ratelimit/`). Uses Upstash REST when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set; otherwise in-memory token-bucket. The web no longer carries rate-limit code.

**Security headers (`next.config.mjs`).** Strict CSP (`default-src 'self'`), HSTS in prod, `unsafe-eval` only in dev for HMR. When adding third-party scripts/fonts/images, update the CSP — don't loosen it globally. The `/api/files/[id]` proxy re-applies its own sandboxing CSP for served blobs.

## Conventions

- **All user-facing strings are Vietnamese.** Validation copy comes from the Go server (Go writes Vietnamese into `message` + `fieldErrors`); web only adds Vietnamese for transport errors. Static labels live in `src/lib/types.ts`, `subscription-types.ts`, `wishlist-types.ts`.
- Path alias `@/*` → `src/*` (see `tsconfig.json`).
- Server actions call `api.*`; the result is mapped to `{ ok, errors?, message? }` for `useFormState` via `toFormState()` in `src/lib/api/client.ts`. A local Zod schema guards `FormData` only in the public auth flows (`auth.ts`, `password-reset.ts`) — the rest pass raw values through and surface Go's validator errors. There is no form library: forms are plain React + `useFormState`.
- After mutating, call `revalidatePath` for every page that reads the changed data.

## Mobile clients

Native apps live in `ios/` and `android/`. Both are pure REST clients of the **Go** backend in `api/`; OpenAPI in `openapi.yaml` is the contract. When adding a new feature: update `openapi.yaml` + implement in `api/` first, then wire the Next.js action (proxy) and the iOS/Android clients.

- **Auth.** Web stores the bearer token in an `iron-session` cookie (`wv_session`); mobile stores it in the platform keystore. Both flows issue tokens via `POST /api/v1/auth/login` on Go.
- **Vietnamese copy / label parity.** Mobile labels mirror the web ones in `website/src/lib/types.ts`. iOS duplicates them in `ios/Sources/WarrantyVaultKit/Models.swift`; Android in `android/.../network/Models.kt`. When you change a Vietnamese label on the web, update the mobile copies too. The **Category** catalog (20 codes) has its own static mirrors — `ios/Sources/WarrantyVaultKit/CategoryLabels.swift` and `android/.../ui/components/CategoryLabels.kt` — because list/chart/reminder payloads carry only the code; `api/internal/services/category_seed_test.go` re-parses `types.ts`, both mobile mirrors **and** migration `0004` and fails on any drift, and Android pins the six enum label sets in `ModelsSerializationTest.kt`. Add a category in one place only if you enjoy red CI.
- **iOS app lock.** Opt-in Face ID / Touch ID lock: `ios/Sources/WarrantyVaultKit/AppLock.swift` (`AppLockStore`) + `RootView`, wired from the "Face ID & Touch ID" row in `AccountView`. Rules that matter if you touch it: enabling *and* disabling each require one successful authentication; unlocking evaluates `.deviceOwnerAuthentication` (biometrics **with** passcode fallback); a device with no passcode never locks; re-lock happens on backgrounding (not `.inactive`); the lock screen always offers "Đăng xuất". It is a UI lock only — the bearer token still lives in the Keychain untouched, nothing extra is encrypted at rest.
- **Two features that are deliberately NOT built** — don't "fix" them: **Sign in with Apple** (the row says "Chưa khả dụng" on purpose) and **per-user reminder lead time** (the row states the real fixed schedule, 7 & 30 days, because the API has no field for it).

## Env vars (cross-service)

`website/` env:
- `GO_API_URL` — base URL of the Go backend **including the `/api` prefix** (Go serves `/api/v1/*` while `src/lib/api/*` appends `/v1/...`), e.g. `http://localhost:4000/api`.
- `SESSION_SECRET` — ≥32 chars, used for `iron-session` cookie encryption.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — used by the service worker on the client to subscribe to web push.

`api/` (Go) env — see `api/README.md` for the full list. Notables:
- `DATABASE_URL`, `FILE_MASTER_KEY`, `PRIVATE_UPLOAD_ROOT`, `CRON_SECRET`.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — web push.
- `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY` (contents of the `.p8`), `APNS_PRODUCTION=1` for the production gateway — iOS push.
- `FCM_SERVICE_ACCOUNT_JSON` (+ optional `FCM_PROJECT_ID`) — Android push.
- `RATE_LIMITER` (`memory` default; `upstash` or `redis`) + `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — optional distributed rate-limit backing; missing Upstash vars with `RATE_LIMITER` set just logs a warning and falls back to memory.
- `RESEND_API_KEY`, `RESEND_FROM` — outbound email, now used by **two** flows: password reset and the email-change confirmation. With no key both links are only written to the log, so password reset *and* email change are effectively broken in production (see `docs/HUMAN_TASKS.md` 1.3).
- `WV_ALLOW_DESTRUCTIVE=1` — required only by `api/cmd/migrate` for `down`/`reset`; `--force-reset` is refused permanently.
- **`SESSION_TTL_DAYS` does nothing.** Compose forwards it and `deploy/PRODUCTION_CHECKLIST.md` mentions it, but Go never reads it — the session TTL is the constant `30 * 24h` in `api/internal/auth/session.go`. Don't wire anything to it.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (optional, defaults to `claude-haiku-4-5-20251001`) — OCR receipt extraction (`POST /api/v1/ai/extract-receipt`). When the key is absent the endpoint returns 503 `feature_disabled` and the server still boots. The AI client lives in `api/internal/ai/` (vision + tool-use, prompt-cached Vietnamese prompt); the tool schema extracts vendor/date/price **plus `serialNumber` (IMEI) and `warrantyMonths` (bounded 0–120)**; the service `api/internal/services/ai_extract.go` decrypts the image via the existing attachment pipeline, calls the model, fuzzy-maps free-text to the catalog, and returns a **draft only** (never writes a Device — confirm-before-save). Images and **PDF** reach the model (PDF as a `document` block); GIF/HEIC and any other non-image type get a 400 before any model call, as does a PDF that is too large for the upstream API. Gated behind a per-user opt-in (`User.aiOptIn`, migration `0003`, default OFF — since the decrypted image leaves the box to a third-party AI): the endpoint returns 403 `ai_optin_required` until the user enables it via `PUT /api/v1/ai/opt-in`. All three clients gate the "Quét hoá đơn" button on this flag and expose a Settings toggle.
