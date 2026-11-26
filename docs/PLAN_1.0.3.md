# Warrly 1.0.3 — quality / performance / accessibility / price entry

Base: `ac122f8` (1.0.2 build 34), archived as 1.0.3 build 35 at `8dbe68b`. Build 36
adds one product feature — the price entry below — and is still 1.0.3, not a new
version. Everything else in 1.0.3 is release quality.

## Goals
- Fix the only P0: editing a device from iOS could delete its STANDARD warranty and reminders.
- Reduce first-screen / large-list / image-memory cost on iOS.
- Close the worst auth/offline and VoiceOver gaps.
- Make failed website reads look like failures, not empty accounts.
- Harden the public share URL and API client IP forwarding; redact auth links in logs.
- Ship the build-36 price entry: original listed price vs actual charged VND vs reference-only market rate.

## Non-goals
- Any new feature beyond the build-36 price entry; redesign; Android feature work; China/DSA expansion.
- A full website CWV overhaul or API pagination rewrite (1.0.4 backlog).

## P0 — fixed
- **iOS edit deleted warranty** — `DeviceInput.warrantyMonths` is now optional and omitted when the form cannot know it; the edit branch no longer sends `0`.
  Files: `ios/Sources/WarrlyKit/Models.swift`, `ios/App/Features/Devices/DeviceFormView.swift`, `ios/Sources/WarrlyKit/BulkDevices.swift`.

## P1 — fixed in 1.0.3
- **Offline launch no longer signs out / wipes widget** — Keychain and out-of-app surfaces are cleared only on a real 401; transport/5xx keeps the session.
- **Dead bearer token exits the shell once** — one 401 hook → `AuthStore` sign-out, instead of every screen erroring.
- **VoiceOver labels on icon controls** — add/filter/more/delete on Staples, Subscriptions, Wishlist, Dashboard, Push Devices.
- **WVSegmented exposes selection** — `.isSelected` on the active option, fixing 10 screens.
- **Toast/error announcements** — failed saves and copy confirmations are announced.
- **Website list reads** — failed devices/reminders/stats reads render a retryable error component, not an empty account.
- **Public share links** — built from `PUBLIC_API_URL` instead of the server-only `GO_API_URL`.
- **Visitor IP forwarding** — the website passes the real client IP to Go for rate limiting.
- **Auth-link log redaction** — password-reset / email-change links are redacted from logs.
- **API server deadlines** — read/write timeouts raised to 6 minutes for long uploads.

## Build 36 — price entry: original price, actual charged, reference only

Added to 1.0.3 as build 36. One feature, narrowly scoped: make the existing
`Device.currency` / `Device.fxRate` pair usable when the card was charged in VND
but the listed price is in another currency. Motivation: a device listed at
`999 USD` is charged to a Vietnamese card as a specific VND amount, and that
charged amount — not the listed price and not today's market rate — is what the
user actually paid. No new device column, no payment flow, no live market feed
(the only new table is the FX cache described below).

### Amounts and what they mean

| Number | Stored? | Meaning |
|---|---|---|
| `purchasePrice` + `currency` | `Device` (existing, migration 0022) | The **original listed price**, in `Device.currency`. Never converted on save. |
| `fxRate` | `Device` (existing) | **VND for one unit of `currency`, LOCKED at entry.** Never refreshed afterwards. |
| `purchasePriceVnd` = `purchasePrice × fxRate` | derived on read (existing) | The **amount actually charged in VND** — what every total reads. |
| `actualChargedVnd` | **form only, never stored** | What the card was actually charged, in VND. Typing it derives the rate. |
| `referenceVnd` = `round(purchasePrice × rates.VND)` | **response only, never stored** | Today's free-market conversion — **reference only**. |

### Form behaviour
- New form-only input **"Số tiền thực tế bị charge (VND)"** / "Actual amount charged (VND)".
  Typing it sets `fxRate = round(actualChargedVnd / purchasePrice)`; the rate field
  is filled in and **stays editable**.
- Editing `fxRate` recomputes the charged preview (`purchasePrice × fxRate`); the
  user's edit wins. Nothing is written until the device is saved.
- Only `purchasePrice`, `currency` and `fxRate` reach the API. `actualChargedVnd` is
  a calculator input, and `purchasePriceVnd` remains server-derived.
- `currency = "VND"` keeps the existing rule: no `fxRate`, and
  `purchasePriceVnd = purchasePrice`.
- `fxRate` is an integer (frozen contract), so a rate derived from a typed charge
  lands within `purchasePrice / 2` VND of it; the preview shows the derived
  `purchasePriceVnd`, which is what gets stored.
- The currency picker, its list and its existing "changing the currency clears the
  old rate" rule are unchanged.

### Reference block
- `GET /api/v1/fx/rates?base=<currency>` — the existing keyless endpoint backed by
  `open.er-api.com` — provides today's rate; no new endpoint.
- The form shows `referenceVnd = round(purchasePrice × rates.VND)`,
  `actualVnd = purchasePriceVnd`, and `delta = actualVnd − referenceVnd` (positive =
  the locked conversion is above today's market).
- The reference carries the badge **"Chỉ tham khảo"** / **"Reference only"**, and the
  screen may show its source plus the response's `fetchedAt` and `stale`. It is never
  stored on the device: it lives only in the form.
- **Never** write the market rate into `Device.fxRate` automatically, and never
  overwrite a saved rate. The reference is information; the user chooses the rate.

### Free daily rate, cached in the DB
- The upstream refreshes at most once a day. Migration **`0035`** adds the
  `ExchangeRate` snapshot table, one row per base currency, with a **24-hour** TTL —
  shared across API instances and surviving restarts and deploys, instead of the
  12 hours held in one process's memory (`api/internal/fx/fx.go`).
- **At most one upstream call per base per 24 hours per deployment.** A failed
  refresh keeps the snapshot: the last rate is served as **stale**, with its original
  `fetchedAt`.
- No snapshot and no reachable upstream ⇒ **503 `fx_unavailable`**; the form asks the
  user to type the rate. The server never invents a rate.

### Copy
- Input: **"Số tiền thực tế bị charge (VND)"** → "Actual amount charged (VND)".
- Badge: **"Chỉ tham khảo"** → "Reference only".
- Both languages ship in the same commit; no other device-form label changes.

### Where
- API: `api/internal/fx/`, migration `0035`, the `GET /api/v1/fx/rates` description
  in `openapi.yaml` (currently documents the 12-hour in-process cache — it must
  describe the 24-hour DB cache).
- Web: `website/src/components/device-form.tsx`, `website/src/app/actions/fx.ts`.
- iOS: `ios/App/Features/Devices/DeviceFormView.swift`,
  `ios/Sources/WarrlyKit/Endpoints.swift`, `ios/Sources/WarrlyKit/CurrencyRules.swift`.

## P1 — 1.0.4 backlog (audit evidence)
- iOS: lazy device rows (currently eager inside a single `VStack`); ImageIO downsampling + NSCache cost for receipt thumbnails; split `RemindersStore` three-request load; avoid duplicate `/devices` on launch/save; seed attachments from device detail; remove AppLock main-thread queries when disabled; avoid per-date regex.
- iOS a11y: paywall Dynamic Type; chart accessibility values; label3/tint contrast; Reduce Motion across shared surfaces.
- iOS: deep-link "not found" only after a successful load; pre-check picked-file size; Premium foreground sync/retry copy; handoff ambiguous transport result.
- Web: CWV/bundle/image pass; list pagination/virtualisation; review the new error states under slow networks.
- API: missing indexes/N+1 review; device list projection for stats; API-level pagination; observability.

## P2 backlog
- iOS stats fan-out (one detail request per device; Premium allows 200/2,000).
- Website SEO/structured-data polish; dependency/SBOM pass.
- Android parity audit items; release checklist automation.

## Implemented tasks (1.0.3 build 35 — 8 branches merged)
| Branch | Actual change |
|---|---|
| `feat/103-ios-perf` | P0 warranty preservation |
| `feat/103-ios-a11y` | offline session + single 401 sign-out |
| `feat/103-api-security` | iOS VoiceOver labels + toast announcements |
| `feat/103-api-db` | website failed-read error screens |
| `feat/103-contract-release` | PUBLIC_API_URL share links + deploy docs |
| `feat/103-web-a11y` | forwarded visitor IP |
| `feat/103-ios-reliability` | API auth-link log redaction |
| `feat/103-web-perf` | API 6-minute read/write deadlines |

> Branch names were assigned by the orchestration slot, not by content; the table is authoritative.

## Verification — 1.0.3 build 36 checklist
- [ ] Build **36** of **1.0.3** uploaded and selected; this docs branch does not touch the version/build (`ios/project.yml`).
- [ ] Migration **`0035`** (the `ExchangeRate` snapshot cache) applied before the API deploy; `migrate status` reports goose version **35**.
- [ ] App Review note pasted from `docs/APP_STORE_RELEASE_NOTES.md`: the reference conversion is **not** the charged amount.
- [ ] Price entry on web + iOS: listed price and actual charged VND derive an editable `fxRate`; editing the rate updates the charged preview; the badge reads "Chỉ tham khảo" / "Reference only".
- [ ] FX cache: at most one upstream call per base per 24 h; an upstream failure serves the stale snapshot with its original `fetchedAt`; no snapshot ⇒ 503 `fx_unavailable` and a manually typed rate.
- [ ] `GET /api/v1/fx/rates` in `openapi.yaml` no longer documents the 12-hour in-process cache.
- [ ] iOS app + widget build for iPhone Duo; manual edit-device check keeps the STANDARD warranty.
- [ ] Website `tsc`, lint, tests, Next build.
- [ ] Go `go build ./...`, tests, OpenAPI drift.
- [ ] Deploy website/API; archive 1.0.3 build 36.

## Build 39 — XCUITest flows
Added to 1.0.3 as build 39, no product change: the app ships the same features, plus a
UI-test target and its launch hook.

- `ios/UITests` is a `bundle.ui-testing` target (`WarrlyUITests`) in the `Warrly`
  scheme's **Test** action only — `xcodebuild build -scheme Warrly` still produces
  just the app.
- Each test starts an in-process mock HTTP server on `127.0.0.1`, then launches the
  app with `-ui-testing` + `WV_API_BASE_URL`. `UITestSupport` wipes Keychain,
  defaults and the App Group on that launch so every run starts signed out; ads/ATT
  are suppressed. A normal launch has no launch arguments and is untouched.
- 14 tests across 6 suites: login, dashboard, device price (charged vs reference),
  AI consent layout, paywall CTA/trial, Dynamic Type AX3 clipping. Runs on a
  simulator or a real iPhone (`ios/UITests/README.md`).
- Known gap: the paywall's ineligible-account branch skips — eligibility comes from
  StoreKit, which the HTTP mock cannot fake.

## Release note (draft)
```
Warrly 1.0.3

• Devices bought in another currency: original listed price, the amount actually
  charged in VND, and today's market rate as a reference only.
• The saved exchange rate is locked at entry, so totals never drift with the market.
• Fixed an issue where editing a device could remove its warranty.
• More reliable sign-in when the network is unavailable.
• VoiceOver, Dynamic Type and accessibility improvements.
• Faster, clearer website screens when data fails to load.
• Bug fixes and performance improvements.
```
