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
├── openapi.yaml        # Source of truth for the REST API contract — Go server, website client, and both mobile apps all bind to this.
├── BACKEND_GO_PLAN.md  # Phasing history for the Next.js → Go migration (Phase F complete).
├── MOBILE_PLAN.md      # Phasing for the native rollout.
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

Test the cron endpoint: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:4000/api/v1/cron/warranty-check` (Go service). Schema management is via goose in `api/migrations/` (`go run ./cmd/migrate up` / `status` / `down`). End-to-end / parity scripts live in `api/scripts/test_*.sh` and Go test files under `api/`.

iOS commands (run from `ios/`): `swift build` to verify the WarrantyVaultKit library; the Xcode project itself is created by the user (see `ios/README.md`).

Android commands (run from `android/`): standard Gradle wrapper after Android Studio generates it (`./gradlew :app:assembleDebug`). See `android/README.md`.

## Architecture

Multi-user, Vietnamese-only Next.js 16 (App Router, React 19) personal **device + warranty + subscription + wishlist** tracker. All persistence is in Postgres 17, owned by the Go service.

**Routing layout (`src/app/`).** Three route groups + one HTTP route:
- `(app)/` — protected. `(app)/layout.tsx` calls `requireUser()` (redirects to `/login`); every page below assumes an authenticated user is present. Sections: `dashboard`, `devices`, `subscriptions`, `wishlist`, `reminders`, `stats`, `settings`.
- `(auth)/` — public auth flows (`login`, `register`, `forgot`, `reset/[token]`).
- `(public)/` — landing page (`/`) plus `privacy`, `terms`, `cookies`.
- `api/files/[id]/` — only Next.js HTTP route left. Thin proxy: reads the bearer token from the iron-session cookie and forwards to Go's `GET /api/v1/files/{id}` (auth-gated, ownership-checked, decrypts blob, streams body). Re-emits defensive security headers locally.

There is no middleware — auth is enforced inside the `(app)/` layout and inside every server action via `requireUser()` from `src/lib/auth.ts`. `requireUser()` reads the bearer token from the iron-session cookie and calls `GET /api/v1/auth/me` against Go (deduped per request via React `cache()`). Per-row ownership is the Go server's responsibility — every Go handler does `AND userId = $1` on its queries; the web does not re-check.

**Sessions.** `iron-session` cookie (`wv_session`), encrypted with `SESSION_SECRET` (≥32 chars). Stores only `{ accessToken, expiresAt }` — userID/email come from `GET /api/v1/auth/me` per request.

**Server actions are thin Go proxies.** Writes live in `src/app/actions/*.ts` (`'use server'`): `auth`, `devices`, `warranties`, `attachments`, `subscriptions`, `wishlist`, `reminders`, `push`, `backup`, `password-reset`, `catalog`. Each action does `requireUser()` (identity) + form parsing + `revalidatePath()`, then forwards to Go via `src/lib/api/*`. **All business logic, rate limiting, encryption, push fanout, and validation lives in Go** — see `api/internal/{services,handlers,httpx,files,push,ratelimit,email}/`. Don't add `prisma.*`, `web-push`, `resend`, `sharp`, `bcrypt`, or `pg` back into the web — those deps are gone on purpose.

**Per-user / per-row limits — enforced in Go** (`api/internal/services/`):
| Constant | Where | Value |
|---|---|---|
| MAX_DEVICES_PER_USER | `services/devices.go` | 50 |
| MAX_WARRANTIES_PER_DEVICE | `services/warranties.go` | 5 |
| MAX_ATTACHMENTS_PER_DEVICE | `services/attachments.go` | 5 |
| MAX_ATTACHMENT_BYTES | `services/attachments.go` | 5 MB |
| MAX_UPLOAD_BYTES_PER_USER | `services/attachments.go` | 100 MB |
| MAX_SUBS_PER_USER | `services/subscriptions.go` | 100 |
| MAX_WISHLIST_PER_USER | `services/wishlist.go` | 200 |

The web doesn't pre-validate these — Go returns 409 with a Vietnamese `message` and the action surfaces it through `useFormState`.

**Domain models.** Same shape as before — see `openapi.yaml` for the canonical schemas and `api/internal/store/queries/*.sql` for the DB definitions. Highlights:
- `Device` has 0..N `Warranty` rows (`STANDARD | EXTENDED | THIRD_PARTY`). Effective warranty end = `max(endDate)` across rows. The helper `effectiveWarrantyEnd()` in `src/lib/warranty.ts` is RSC-friendly (takes plain JSON, no DB access) and is unit-tested in `src/lib/__tests__/warranty.test.ts`.
- `Subscription` covers recurring software/services. `billingCycle ∈ {MONTHLY, QUARTERLY, YEARLY, LIFETIME, CUSTOM}`. `monthlyEquivalent()` + `nextRenewalDate()` in `src/lib/subscription-types.ts` are pure functions, also reused in RSC for dashboard totals.
- `WishlistItem` is a "thèm" list. Marking PURCHASED creates a `Device` row in the same Go transaction (see openapi `PATCH /api/v1/wishlist/{id}` and `services/wishlist.go`).
- Global catalogs (Category / Brand / Store / WarrantyProvider) are admin-curated in the DB. Web reads them via `getDeviceFormCatalog()` server action which is cached with `unstable_cache`.

**Encrypted attachments.** Everything is in Go — see `api/internal/files/` (AES-256-GCM, per-file data key wrapped with `FILE_MASTER_KEY`, magic-byte whitelist, image downscale, served via `GET /api/v1/files/{id}`). The web only proxies the byte stream through `app/api/files/[id]/route.ts` so cookie-based auth works in the browser. To rotate `FILE_MASTER_KEY`, re-wrap every `Attachment.wrappedKey` server-side; see `api/README.md`.

**Push notifications.** Web push (VAPID), APNs (.p8 token auth), and FCM (service account) all live in Go (`api/internal/push/`). The cron job at `api/cmd/cron` (also `POST /api/v1/cron/warranty-check`) fans out warranty-expiry, wishlist target-date, wishlist check-in, and subscription-renewal notifications. The subscribed device's `platform` field (`web | apns | fcm`) routes the payload. 404/410 from any backend → Go deletes the `PushSubscription` row.

**Rate limiting.** Per-endpoint, in Go (`api/internal/ratelimit/`). Uses Upstash REST when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set; otherwise in-memory token-bucket. The web no longer carries rate-limit code.

**Security headers (`next.config.mjs`).** Strict CSP (`default-src 'self'`), HSTS in prod, `unsafe-eval` only in dev for HMR. When adding third-party scripts/fonts/images, update the CSP — don't loosen it globally. The `/api/files/[id]` proxy re-applies its own sandboxing CSP for served blobs.

## Conventions

- **All user-facing strings are Vietnamese.** Validation copy comes from the Go server (Go writes Vietnamese into `message` + `fieldErrors`); web only adds Vietnamese for transport errors. Static labels live in `src/lib/types.ts`, `subscription-types.ts`, `wishlist-types.ts`.
- Path alias `@/*` → `src/*` (see `tsconfig.json`).
- Server actions parse `FormData` with a Zod schema (web side), then call `api.*`. The result is mapped to `{ ok, errors?, message? }` for `useFormState` via `toFormState()` in `src/lib/api/client.ts`.
- After mutating, call `revalidatePath` for every page that reads the changed data.

## Mobile clients

Native apps live in `ios/` and `android/`. Both are pure REST clients of the **Go** backend in `api/`; OpenAPI in `openapi.yaml` is the contract. When adding a new feature: update `openapi.yaml` + implement in `api/` first, then wire the Next.js action (proxy) and the iOS/Android clients.

- **Auth.** Web stores the bearer token in an `iron-session` cookie (`wv_session`); mobile stores it in the platform keystore. Both flows issue tokens via `POST /api/v1/auth/login` on Go.
- **Vietnamese copy.** Mobile labels mirror the web ones in `website/src/lib/types.ts`. iOS duplicates them in `ios/Sources/WarrantyVaultKit/Models.swift`; Android in `android/.../network/Models.kt`. When you change a Vietnamese label on the web, update the mobile copies too.

## Env vars (cross-service)

`website/` env:
- `GO_API_URL` — base URL of the Go backend (e.g. `http://localhost:4000`).
- `SESSION_SECRET` — ≥32 chars, used for `iron-session` cookie encryption.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — used by the service worker on the client to subscribe to web push.

`api/` (Go) env — see `api/README.md` for the full list. Notables:
- `DATABASE_URL`, `FILE_MASTER_KEY`, `PRIVATE_UPLOAD_ROOT`, `CRON_SECRET`.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — web push.
- `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY_P8` — iOS push.
- `FCM_SERVICE_ACCOUNT_JSON` — Android push.
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — optional rate-limit backing.
- `RESEND_API_KEY` — password reset emails.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (optional, defaults to `claude-haiku-4-5-20251001`) — OCR receipt extraction (`POST /api/v1/ai/extract-receipt`). When the key is absent the endpoint returns 503 `feature_disabled` and the server still boots. The AI client lives in `api/internal/ai/` (vision + tool-use, prompt-cached Vietnamese prompt); the service `api/internal/services/ai_extract.go` decrypts the image via the existing attachment pipeline, calls the model, fuzzy-maps free-text to the catalog, and returns a **draft only** (never writes a Device — confirm-before-save). Gated behind a per-user opt-in (`User.aiOptIn`, migration `0003`, default OFF — since the decrypted image leaves the box to a third-party AI): the endpoint returns 403 `ai_optin_required` until the user enables it via `PUT /api/v1/ai/opt-in`. All three clients gate the "Quét hoá đơn" button on this flag and expose a Settings toggle.
