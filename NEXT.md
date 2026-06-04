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

### 1.3 Dismiss/restore reminder UI — cả 3 client (~2h) 🟡
- Backend: `POST` / `DELETE /api/v1/warranties/{id}/reminder` — đã có.
- iOS `RemindersView` có swipe-to-dismiss; verify nút "Đã xem" gọi đúng endpoint + có restore.
- Android `RemindersScreen`: thêm swipe/long-press dismiss + restore.
- Web: thêm nút dismiss ở warranty detail (hiện chưa có).

### 1.4 Subscription detail + payment log — mobile (~2h) 🟡
- Backend: `GET /api/v1/subscriptions/{id}/payments`, `POST .../payments`, `POST .../renew` — kiểm tra đủ.
- iOS/Android `SubscriptionDetail*`: list payment history + nút log payment + manual renew.

### 1.5 Vietnamese label parity (~30 phút)
- Diff enum labels giữa `website/src/lib/types.ts` ↔ `ios/Sources/WarrantyVaultKit/Models.swift`
  ↔ `android/.../network/Models.kt`. Sync: DEVICE_STATUS, WARRANTY_TYPE, BILLING_CYCLE, WISHLIST_STATUS, SUB_STATUS.

---

## Block 2 — Đồng bộ docs + dọn nốt (1–2h)

- [ ] Update `BACKEND_GO_PLAN.md`: đánh dấu Phase F complete (nếu chưa).
- [ ] Update `MOBILE_PLAN.md` + `ios/README.md` + `android/README.md`: README iOS vẫn nói
      "talks to the Next.js backend" và liệt kê các Sheet đã xoá (`AddDeviceSheet`, `DevicesListView`…)
      → cập nhật sang Go backend + tên file mới (`DeviceFormView`, `DevicesScreen`, shell 5 tab).
- [ ] Viết nội dung thật cho `website/src/app/(public)/{privacy,terms,cookies}/page.tsx`
      (đang là placeholder "sẽ được cập nhật").
- [ ] Xoá `api/internal/store/gen/health.sql.go` TODO comment nếu đã chạy sqlc.

---

## Block 3 — Siết test + CI (1 ngày, song song)

- [ ] `website.yml`: thêm step `npm test` (vitest đã có nhưng CI chưa chạy).
- [ ] Mở rộng `website/src/lib/__tests__/`: test cho `subscription-types.ts` (monthlyEquivalent, nextRenewalDate)
      + vài server action mapping (`toFormState`).
- [ ] `android.yml`: thêm `./gradlew test` (unit). `ios.yml`: cân nhắc build cả app (hiện chỉ build lib `WarrantyVaultKit`).
- [ ] (Optional) deploy workflow: build + push Docker image lên registry khi tag.

---

## Block 4 — Pre-deploy (chờ account/server, soạn sẵn được)

Template đã có (`docker-compose.yml`, `deploy/`, kể cả `android/app/google-services.json` stub). Còn thiếu:
- [ ] `deploy/backup.sh` — script dump DB + blob (README có nhắc nhưng chưa có file).
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
3. **Block 1.3–1.5** — reminder/payment/label parity. ⬅ TIẾP THEO
4. **Block 2** — đồng bộ docs (rẻ, gỡ nợ nhận thức).
5. **Block 3** — CI test.
6. **Block 4** — khi có server/account.
