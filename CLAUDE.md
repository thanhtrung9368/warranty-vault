# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Next dev server (http://localhost:3000)
npm run build            # prisma generate + next build (always runs `prisma generate` first)
npm run start            # serve production build (required for service worker / push)
npm run lint             # eslint . (uses eslint-config-next/core-web-vitals, flat config)
npm run db:push          # push prisma/schema.prisma to the DB (no migrations folder used)
npm run db:studio        # open Prisma Studio
node scripts/test-backup-restore.mjs   # end-to-end test for export/import logic against the dev DB
```

There is no test framework installed — `scripts/test-backup-restore.mjs` is the only test, and it talks to the real `DATABASE_URL` (it creates and deletes a `__backup_test__@local.test` user).

Test the cron endpoint locally: `curl "http://localhost:3000/api/cron/warranty-check?secret=$CRON_SECRET"` (the route also accepts `Authorization: Bearer <CRON_SECRET>` for Vercel Cron).

## Architecture

Multi-user, Vietnamese-only Next.js 16 (App Router, React 19) personal warranty tracker. Local-first SQLite via Prisma 7's driver-adapter API (`@prisma/adapter-better-sqlite3`); production uses Turso libSQL by swapping the adapter (see DEPLOY.md — the adapter is the only code change).

**Routing layout (`src/app/`).** Two route groups:
- `(app)/` — protected. `(app)/layout.tsx` calls `requireUser()` (redirects to `/login`); every page below assumes an authenticated user is present.
- `(auth)/` — public auth flows (`login`, `register`, `forgot`, `reset/[token]`).

There is no middleware — auth is enforced inside the layout and inside every server action via `requireUser()` / `getCurrentUser()` from `src/lib/auth.ts`. When adding a new mutation, do BOTH: `requireUser()` for identity AND a per-row `findFirst({ where: { id, userId: user.id } })` ownership check before update/delete. This pattern is used in `src/app/actions/devices.ts` and `attachments.ts`; follow it.

**Sessions.** `iron-session` cookie (`wv_session`), encrypted with `SESSION_SECRET` (must be ≥32 chars; `src/lib/session.ts` throws at import time otherwise). Session contains only `{ userId, email }`; user data is re-fetched on each request.

**Server actions are the API.** All writes live in `src/app/actions/*.ts` (`'use server'`). There are only two HTTP routes: `app/api/cron/warranty-check/route.ts`. Don't add REST endpoints unless they need to be hit by an external system (cron, webhooks).

**Rate limiting (`src/lib/rate-limit.ts`).** In-memory token-bucket on `globalThis` — works for a single Vercel instance / local dev only. Two helpers:
- `rateLimitAuth('login'|'register'|'change-password', identifier)` — call before `prisma.user.findUnique` in auth flows.
- `rateLimitUserWrite(userId)` — 60 writes/min/user. Call at the top of every authenticated mutation server action (every action in `src/app/actions/` already does this).

**Prisma.** `src/lib/prisma.ts` returns a singleton stashed on `globalThis` to survive HMR. Schema in `prisma/schema.prisma`. Models cascade from `User` → `Device` → `{Attachment, Reminder}`, so deleting a user removes everything they own. Per-user limits enforced in app code, not the DB: `MAX_DEVICES_PER_USER = 50`, `MAX_PER_DEVICE = 5` attachments, `MAX_UPLOAD_BYTES_PER_USER = 100MB`. Money is stored as integer VND (`Device.purchasePrice: Int`).

**Uploads (`src/app/actions/attachments.ts`).** Files written to `public/uploads/<deviceId>/<uuid>.<ext>`. Strict whitelist: only `image/{jpeg,png,webp,gif,heic}` and `application/pdf`, **and** the magic bytes must match the declared MIME — SVG/HTML/JS are never allowed. Path traversal is defended in `deleteAttachment` by resolving against `UPLOAD_ROOT`. `next.config.mjs` serves `/uploads/*` with `Content-Security-Policy: default-src 'none'; sandbox` so user files can't execute. **Vercel filesystem is ephemeral** — for production this code must be ported to Vercel Blob (see DEPLOY.md step 3).

**Push notifications.** `src/lib/push.ts` lazily configures `web-push` from `VAPID_*` env vars (throws if missing). The cron at `api/cron/warranty-check` fires a notification for every `ACTIVE` device whose warranty ends in exactly 7 or 30 days, skipping devices that have a `Reminder` with `isDismissed = true`. A 404/410 response from the push service means the subscription is gone — the route deletes it. Push only works against `npm run start` (service worker), not `npm run dev`.

**Security headers (`next.config.mjs`).** Strict CSP (`default-src 'self'`), no inline scripts in prod beyond Next's bootstrap, `unsafe-eval` only in dev for HMR. HSTS only in prod. When adding third-party scripts/fonts/images, update the CSP — don't loosen it globally.

## Conventions

- **All user-facing strings are Vietnamese.** Error messages, validation messages, button labels, toast text — everything. The whole `src/lib/types.ts` label tables and every `z.string().min(...)` message in the actions are Vietnamese. Match this when adding new copy.
- Path alias `@/*` → `src/*` (see `tsconfig.json`).
- Validation: every server action parses `FormData` with a Zod schema and returns `{ ok, errors?, message? }` for `useFormState`. Don't trust raw form data.
- After mutating, call `revalidatePath` for every page that reads the changed data (typical set: `/dashboard`, `/devices`, `/devices/[id]`, `/reminders`).
- `prisma generate` runs in `postinstall` and at the start of `build` — committed Prisma client code is not needed.
