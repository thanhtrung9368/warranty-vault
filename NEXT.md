# Plan kế tiếp — sau Phase F, hướng tới deploy + parity mobile

> Cập nhật: 2026-05-31. File cũ (bản 14/5) đã lỗi thời — Phase E, Phase F, và Block "Go API quality"
> trong bản cũ **đã xong hết** (xem commit `33c79c4` "Phase F decommission + cron idempotency + vitest").
> Bản này viết lại theo đúng những gì còn lại.

## Hiện trạng (verified)

**Đã xong:**
- ✅ **Backend Go (Phase A–F)** — toàn bộ API ở `api/`. Prisma đã gỡ sạch khỏi `website/src/app/actions/`
  (chỉ còn `website/src/app/api/files/[id]/` proxy stream). Go đã có `backup.go` (export/import),
  `ResetPassword`, `DELETE /api/v1/auth/me`.
- ✅ **Web cutover** — mọi server action là thin proxy qua `src/lib/api/*` → Go. Vitest đã có (`warranty.test.ts`).
- ✅ **Go quality** — `.golangci.yml` + lint trong CI, OpenAPI drift check trong `api.yml`,
  cron idempotency test, bcrypt compat test, file interop test.
- ✅ **Deploy templates** — `docker-compose.yml`, `deploy/caddy/Caddyfile`, `deploy/systemd/*cron*`,
  `api/Dockerfile`, `website/Dockerfile`, `api/.env.example` + `website/.env.example`.
- ✅ **Mobile MVP** — iOS + Android đều có auth, devices, warranties, subscriptions, wishlist,
  attachments, catalog autocomplete, stats, reminders, change password, push register.

**Block 0 — ĐÃ XONG (2026-06-05):** working tree đã chốt + commit, chia theo component.
- ✅ **AI receipt OCR** (mới, ngoài plan cũ) — Anthropic vision + tool-use, per-user opt-in
  (migration `0003`, default OFF), 403 gate / 503 khi thiếu key. Wired đủ ở Go + web + iOS + Android.
- ✅ iOS: bỏ Sheet-modal → full-screen forms + shell 5 tab + `DashboardView` + `MoreScreen` + DesignSystem mới
  (`Charts.swift`, `Formatters.swift`). swift build ✅ + chạy được trên simulator.
- ✅ Android: thêm `DashboardScreen` + `Tab.Dashboard` + `ViewModelFactory`, đổi `BASE_URL` 3000 → 4000.
  `assembleDebug` ✅.
- ✅ Go: tối ưu `ListDevices` N+1 → batch query, push dispatch concurrent (errgroup limit 8).
  build/vet/test ✅, sqlc không drift.
- ✅ Web: opt-in Next data cache, bỏ `revalidatePath` (mọi page đã dynamic). lint/tsc/vitest/build ✅.

Commits: `perf(api)…` · `refactor(web)…` · `feat(ios)…` · `feat(android)…` · `docs:…`.

---

## Block 1 — Vá parity mobile (việc chính, backend đã sẵn) (2–3 ngày)

Backend đã có đủ endpoint; đây thuần là UI mobile còn thiếu so với web.

### 1.1 Backup export/import — iOS + Android ✅ XONG (2026-06-05)
- iOS: `SettingsView` Dữ liệu section — export qua `.fileExporter` (JSONBackupDocument),
  import qua `.fileImporter` + confirmationDialog chọn merge/replace. Bỏ row giả iCloud/wipe.
- Android: `SettingsScreen` Dữ liệu section — SAF `CreateDocument`/`OpenDocument`, dialog chọn mode.
- Network: iOS `rawDataRequest` (verbatim body); Android `exportBackup(): ResponseBody` +
  `importBackup(mode, RequestBody)`. Model `ImportResult` cả 2 bên. Build xanh cả 2.

### 1.2 Delete account — iOS + Android ✅ XONG (2026-06-05)
- Server **yêu cầu mật khẩu hiện tại** trong body → cả 2 client thu password trước khi gọi.
- iOS: `AccountView` alert + SecureField → `auth.deleteAccount(password:)` clear keychain → login.
- Android: `SettingsScreen` nút "Xoá tài khoản" + AlertDialog password → `auth.deleteAccount` clear token.

### 1.3 Dismiss/restore reminder UI — cả 3 client ✅ XONG (2026-06-05)
- Dismissed reminder rời khỏi list "sắp tới", nên "restore" = **undo ngay sau dismiss**, nhất quán 3 client.
- iOS: `RemindersStore.restore()` + banner "Đã ẩn — Hoàn tác"; sửa fetch 30→90 ngày cho bucket 60/90.
- Android: `RemindersViewModel.restore()` + Snackbar action "Hoàn tác".
- Web: `DismissButton` gọi `router.refresh()` + toast có nút "Hoàn tác".

### 1.4 Subscription detail + payment log — mobile ✅ ĐÃ CÓ SẴN (NEXT cũ lỗi thời)
- iOS `SubscriptionDetailView`: `SubLogPaymentSheet` + `paymentsSection` + `renewNow` + biểu đồ — đủ.
- Android `SubscriptionDetailScreen`: `LogPaymentSheet` + payment history + renew dialog — đủ.

### 1.5 Vietnamese label parity ✅ ĐÃ PARITY (verified 2026-06-05)
- 6 enum (DeviceStatus, WarrantyType, BillingCycle, SubscriptionStatus, WishlistStatus, WishlistPriority)
  label tiếng Việt **giống hệt** giữa web `types.ts` ↔ iOS `Models.swift` ↔ Android `Models.kt`. Không phải sửa.

---

## Block 2 — Đồng bộ docs + dọn nốt ✅ XONG (2026-06-05)

- [x] `privacy/terms/cookies` — viết nội dung thật (mã hoá AES, AI opt-in gửi Anthropic, cookie `wv_session`,
      Resend email, không tracking; quyền export/xoá tài khoản).
- [x] `ios/README.md` + `android/README.md` — sửa "Next.js backend" → Go (`../api`), port 3000 → 4000,
      tên file mới (`DeviceFormView`/`DevicesScreen`), bỏ tham chiếu file đã xoá.
- [x] Xoá TODO trong `health.sql` source + regen sqlc (gen sạch).
- [ ] (còn) `BACKEND_GO_PLAN.md` / `MOBILE_PLAN.md` — đánh dấu hoàn tất (low-pri).

---

## Block 3 — Siết test + CI ✅ XONG (2026-06-05)

- [x] `website.yml`: thêm step `npm test`.
- [x] `subscription-types.test.ts` — 12 test cho `monthlyEquivalent` + `nextRenewalDate` (22 test total xanh).
      (Bỏ test `toFormState`: import `client.ts` kéo theo `auth-cookie` cần `SESSION_SECRET` → fragile.)
- [x] `android.yml`: thêm step `:app:testDebugUnitTest`.
- [ ] (còn, optional) `ios.yml` build cả app; deploy workflow push image khi tag.

---

## Block 4 — Pre-deploy (chờ account/server, soạn sẵn được)

Template đã có (`docker-compose.yml`, `deploy/`, kể cả `android/app/google-services.json` stub). Còn thiếu:
- [x] `deploy/backup.sh` — dump DB (`pg_dump`) + tar blob qua `docker compose exec`, timestamp + retention prune.
- [ ] Production checklist + health monitoring (optional).
- [ ] `android/app/google-services.json` THẬT — thay stub bằng file từ Firebase project (deferred).

---

## Defer hẳn (chờ tiền/tài khoản)

| Việc | Chờ gì |
|---|---|
| Apple Developer + APNs .p8 | $99/năm |
| Firebase project + service account JSON + `google-services.json` | Google account |
| VPS + domain + Caddy TLS | Card + DNS |
| TestFlight / Play Console internal | Apple/Google account |
| Upstash (rate-limit) / Resend (email) prod keys | Signup free tier |

---

## Đề xuất thứ tự

1. ~~**Block 0** — chốt working tree~~ ✅ XONG (2026-06-05).
2. ~~**Block 1.1 + 1.2** — backup + delete account mobile~~ ✅ XONG (2026-06-05).
3. ~~**Block 1.3–1.5** — reminder/payment/label parity~~ ✅ XONG (2026-06-05).
4. ~~**Block 2** — đồng bộ docs~~ ✅ XONG (2026-06-05).
5. ~~**Block 3** — CI test~~ ✅ XONG (2026-06-05).
6. **Block 4** — `backup.sh` xong; phần còn lại chờ server/account.

> Còn lại đều **chờ tiền/tài khoản** (Apple Dev, Firebase, VPS, prod keys) — xem bảng "Defer hẳn".
> Code/feature parity giữa web ↔ iOS ↔ Android coi như đã đầy đủ.
