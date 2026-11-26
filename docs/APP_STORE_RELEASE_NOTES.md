# Warrly — App Store release & review notes

Version: **1.0.3 (build 36)** · Bundle: `com.warrly` · Updated: 2026-11-26

> Dùng file này để copy từng mục vào App Store Connect. Không đưa mật khẩu demo
> vào đây; demo account nằm trong **App Review Information** của ASC.
> Mục **1.0.3 (build 36)** bên dưới là bản sắp submit; mục **1.0.2** giữ để tham
> chiếu (bản đã submit trước đó), và các mục 1–5 là bản 1.0.0 giữ để tham chiếu
> (phần Premium ở mục 3–4 vẫn dùng nguyên).

## 1.0.3 (build 36) — What's New (English)

```
Warrly 1.0.3

• Devices bought in another currency: enter the original listed price, the amount
  your card was actually charged in VND, and see today's market rate as a
  reference only.
• The exchange rate you save is locked when you enter it, so totals never drift
  with the market.
• Fixed an issue where editing a device could remove its warranty.
• More reliable sign-in when the network is unavailable.
• VoiceOver, Dynamic Type and accessibility improvements.
• Bug fixes and performance improvements.
```

## 1.0.3 (build 36) — What's New (Tiếng Việt)

```
Warrly 1.0.3

• Thiết bị mua bằng ngoại tệ: nhập giá niêm yết gốc, số tiền thực tế bị charge
  bằng VND, và xem tỷ giá thị trường hôm nay chỉ để tham khảo.
• Tỷ giá bạn lưu được khoá tại lúc nhập, nên tổng tiền không đổi theo thị trường.
• Sửa lỗi chỉnh sửa thiết bị có thể làm mất bảo hành.
• Đăng nhập ổn định hơn khi không có mạng.
• Cải thiện VoiceOver, Dynamic Type và khả năng tiếp cận.
• Sửa lỗi và cải thiện hiệu năng.
```

## 1.0.3 (build 36) — Giá gốc, số tiền bị charge, tỷ giá tham khảo (VI/EN)

### Tiếng Việt

- **Giá gốc** — `purchasePrice` theo `currency` của thiết bị: con số niêm yết, không
  quy đổi khi lưu.
- **Số tiền thực tế bị charge** — ô **"Số tiền thực tế bị charge (VND)"**: nhập vào
  thì app tính `fxRate = round(actualChargedVnd / purchasePrice)`, cho người dùng xem
  và sửa tỷ giá; sửa tỷ giá thì tính lại số tiền sẽ lưu. Chỉ `purchasePrice`,
  `currency`, `fxRate` được lưu — số tiền charge là ô tính, không phải cột mới.
- **Tỷ giá tham khảo** — `GET /api/v1/fx/rates?base=<currency>` lấy tỷ giá thị trường
  miễn phí hôm nay (`open.er-api.com`); form hiện `referenceVnd`, `actualVnd` và
  `delta`. Badge **"Chỉ tham khảo"** / **"Reference only"**: đây **không phải** số
  tiền bị charge và **không bao giờ** tự ghi đè `Device.fxRate`; tỷ giá đã lưu chỉ
  đổi khi người dùng chọn.
- **Miễn phí, cập nhật mỗi ngày** — nguồn cập nhật tối đa 1 lần/ngày; server cache
  trong DB (`ExchangeRate`, migration `0035`) **24 giờ** cho mỗi `base`, dùng chung
  mọi instance và sống qua restart/deploy. Nguồn lỗi thì trả bản cache cũ (`stale`)
  kèm `fetchedAt` gốc; không có cache thì 503 và người dùng tự nhập tỷ giá. Tối đa
  **1 request lên nguồn / base / 24 giờ / deployment**.

### English

- **Original price** — `purchasePrice` in the device's `currency`: the listed number,
  never converted on save.
- **Actual amount charged** — the **"Actual amount charged (VND)"** input: entering it
  sets `fxRate = round(actualChargedVnd / purchasePrice)`, and the rate field stays
  visible and editable; editing the rate recomputes the amount that will be saved.
  Only `purchasePrice`, `currency` and `fxRate` are stored — the charged amount is a
  calculator input, not a new column.
- **Reference only** — `GET /api/v1/fx/rates?base=<currency>` returns today's free
  market rate (`open.er-api.com`); the form shows `referenceVnd`, `actualVnd` and
  `delta`. Badge **"Chỉ tham khảo"** / **"Reference only"**: this is **not** the amount
  charged and it **never** automatically overwrites `Device.fxRate`; the saved rate
  changes only when the user chooses.
- **Free, updated daily** — the upstream refreshes at most once a day; the server
  caches it in the DB (`ExchangeRate`, migration `0035`) for **24 hours** per `base`,
  shared by every instance and surviving restarts/deploys. On upstream failure the
  last cached rate is served as `stale` with its original `fetchedAt`; with no cache
  the endpoint answers 503 and the user types the rate. At most **one upstream call
  per base per 24 hours per deployment**.

## 1.0.3 (build 36) — App Review Information → Notes (English)

Thêm đoạn này vào **đầu** ô Notes; phần Premium ở mục 3 giữ nguyên bên dưới:

```
Warrly 1.0.3 adds a price-entry helper for devices bought in a currency other
than VND. The user enters the original listed price in the device's currency and
the amount their card was actually charged in VND; the app derives the exchange
rate, and the user can see and edit it before saving. The saved rate is locked
and is never refreshed afterwards.

The app also shows today's free-market rate (open.er-api.com — free, no API key,
refreshed at most once a day and cached by our server for 24 hours) as a
REFERENCE only. That reference rate is NOT the amount charged: it is never saved
automatically and never overwrites the rate the user locked. No purchase,
payment or financial service is provided in the app for this feature.
```

## 1.0.3 (build 36) — Checklist trước khi submit

- [ ] Build **36** của version **1.0.3** đã upload và được chọn
- [ ] API đã deploy và migration **`0035`** (cache tỷ giá `ExchangeRate`) đã apply trên
      production — `migrate status` báo goose version **35**
- [ ] Review note ở trên đã dán vào **App Review Information → Notes**, nói rõ tỷ giá
      tham khảo **không phải** số tiền bị charge
- [ ] Thử trên máy thật với một thiết bị ngoại tệ: nhập giá niêm yết và số tiền thực
      tế bị charge, sửa tỷ giá, thấy badge "Chỉ tham khảo" và số tiền sẽ lưu cập nhật

## 1.0.2 — What's New (English)

```
Warrly 1.0.2

• iPhone Duo support — Warrly now runs on both displays of Apple's first
  foldable iPhone: the outer screen and the inner screen.
• The interface is laid out for each display; it is not a stretched iPhone screen.
• Nothing else changes — devices, warranties, subscriptions, wishlist and
  receipts work exactly as before.
```

## 1.0.2 — What's New (Tiếng Việt)

```
Warrly 1.0.2

• Hỗ trợ iPhone Duo — dùng được trên cả hai màn hình của chiếc iPhone gập đầu
  tiên của Apple: màn hình ngoài và màn hình trong.
• Giao diện được bố cục cho từng màn hình, không phải giao diện iPhone phóng to.
• Không có thay đổi nào khác — thiết bị, bảo hành, gói đăng ký, wishlist và hoá
  đơn vẫn hoạt động như trước.
```

## 1.0.2 — App Review Information → Notes (English)

Thêm đoạn này vào **đầu** ô Notes; phần Premium ở mục 3 giữ nguyên bên dưới:

```
Warrly is a personal tracker for devices, warranties, subscriptions and a
wishlist. It is not a dating app and has no dating features, no user-generated
content or public profiles, no social feed, no messaging/chat and no location.

This version adds iPhone Duo support. App Store screenshots are uploaded for
both displays: inner 2007 × 2853 and outer 1398 × 2034.
```

## 1.0.2 — iPhone Duo screenshot checklist

- [ ] Build **34** của version **1.0.2** đã upload và được chọn
- [ ] Version page → tab **iPhone Duo** (tab riêng, không dùng chung với iPhone)
- [ ] Inner display — **10** ảnh, **2007 × 2853** (portrait)
- [ ] Outer display — **10** ảnh, **1398 × 2034** (portrait)
- [ ] Ảnh chụp từ build **1.0.2 (34)** — giao diện đã tối ưu cho Duo, không phải
      giao diện iPhone phóng to
- [ ] Upload đủ cả hai bộ trước khi **Add for Review**

## 1. Version 1.0.0 → What's New (English)

```
Warrly 1.0.0

• Keep devices, warranties, subscriptions and your wishlist in one place.
• Get reminders before warranties and subscriptions expire, and keep receipts securely.
• Warrly Premium is available as an optional auto-renewable subscription:
  remove ads and raise your limits. 7-day free trial.
```

## 2. Version 1.0.0 → What's New (Tiếng Việt)

```
Warrly 1.0.0

• Quản lý thiết bị, bảo hành, gói đăng ký và wishlist trong một nơi.
• Nhắc hạn bảo hành/gói đăng ký và lưu hoá đơn an toàn.
• Warrly Premium là gói đăng ký tự động gia hạn không bắt buộc:
  bỏ quảng cáo và nâng giới hạn. Dùng thử 7 ngày.
```

## 3. App Review Information → Notes (English)

```
Warrly is a personal device, warranty, subscription and wishlist tracker.
The app is free with ads. Warrly Premium is an optional auto-renewable
subscription that removes ads and raises account limits.

How to review Premium:
1. Sign in with the demo account provided in App Review Information.
2. Open More → Settings → Warrly Premium.
3. Both subscription products are attached to this version:
   • com.warrly.premium.monthly — 49,000 VND per month — 7-day free trial
   • com.warrly.premium.yearly  — 399,000 VND per year  — 7-day free trial
   The localized StoreKit price is shown inside the app.
4. Premium removes ads and raises limits:
   • 200 active devices (2,000 devices total, including sold)
   • 500 subscriptions
   • 1,000 wishlist items
   Free tier: 50 active devices / 500 total / 100 subscriptions / 200 wishlist.
5. Restore purchases is on the paywall. Manage subscription opens Apple's
   subscription-management screen.
6. Apple processes payment. Warrly verifies the StoreKit transaction on its
   server and stores only the product ID, transaction ID, expiry and environment;
   Warrly does not receive card or bank details.
7. Ads are served by Google AdMob on the free tier, with ATT/UMP consent.
   Premium has no ads.
8. Legal: https://warrly.com/terms and https://warrly.com/privacy
   Support: support@warrly.com
```

## 4. Subscription review — copy-paste checklist

- Subscription group: **Warrly Premium**
- `com.warrly.premium.monthly` — 1 month — **49,000đ** — **7-day free trial**
- `com.warrly.premium.yearly` — 1 year — **399,000đ** — **7-day free trial**
- Both statuses: **Ready to Submit**
- Review screenshots: `artifacts/appstore/premium-monthly-640x1120.png` and
  `artifacts/appstore/premium-yearly-640x1120.png` (fallback: `…-640x920.png`)
- Attach both products to version **1.0.0** before submitting.
- The paywall is reached from **More → Settings → Warrly Premium**.

## 5. Trước khi bấm Submit — kiểm đầu mục

- [ ] Build **23** uploaded and selected for version **1.0.0**
- [ ] Both subscription products exist, are **Ready to Submit**, and are attached
- [ ] Subscription review screenshots uploaded
- [ ] App Privacy questionnaire completed and **Published**
- [ ] App Store listing screenshots (iPhone 6.9" / 6.5") uploaded
- [ ] Demo account still works (App Review Information)
- [ ] Sandbox purchase + Restore tested on a real device
- [ ] App Review Notes above pasted into **App Review Information → Notes**
- [ ] Add for Review → Submit
