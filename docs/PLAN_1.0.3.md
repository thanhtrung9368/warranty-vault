# Warrly 1.0.3 — quality / performance / accessibility

Base: `ac122f8` (1.0.2 build 34). Scope: release quality, no new product features.

## Goals
- Fix the only P0: editing a device from iOS could delete its STANDARD warranty and reminders.
- Reduce first-screen / large-list / image-memory cost on iOS.
- Close the worst auth/offline and VoiceOver gaps.
- Make failed website reads look like failures, not empty accounts.
- Harden the public share URL and API client IP forwarding; redact auth links in logs.

## Non-goals
- New features, redesign, Android feature work, China/DSA expansion.
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

## Implemented tasks (8 branches merged)
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

## Verification
- iOS app + widget build for iPhone Duo; manual edit-device check keeps the STANDARD warranty.
- Website `tsc`, lint, tests, Next build.
- Go `go build ./...`, tests, OpenAPI drift.
- Deploy website/API; archive 1.0.3 build 35.

## Release note (draft)
```
Warrly 1.0.3

• Fixed an issue where editing a device could remove its warranty.
• More reliable sign-in when the network is unavailable.
• VoiceOver, Dynamic Type and accessibility improvements.
• Faster, clearer website screens when data fails to load.
• Bug fixes and performance improvements.
```
