# Warrly — App Store release & review notes

Version: **1.0.2 (build 34)** · Bundle: `com.warrly` · Updated: 2026-11-24

> Dùng file này để copy từng mục vào App Store Connect. Không đưa mật khẩu demo
> vào đây; demo account nằm trong **App Review Information** của ASC.
> Mục **1.0.2** bên dưới là bản đang submit; các mục 1–5 là bản 1.0.0 giữ để
> tham chiếu (phần Premium ở mục 3–4 vẫn dùng nguyên).

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
