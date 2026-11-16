# Warrly — App Store release & review notes

Version: **1.0.0 (build 23)** · Bundle: `com.warrly` · Updated: 2026-11-11

> Dùng file này để copy từng mục vào App Store Connect. Không đưa mật khẩu demo
> vào đây; demo account nằm trong **App Review Information** của ASC.

## 1. Version → What's New (English)

```
Warrly 1.0.0

• Keep devices, warranties, subscriptions and your wishlist in one place.
• Get reminders before warranties and subscriptions expire, and keep receipts securely.
• Warrly Premium is available as an optional auto-renewable subscription:
  remove ads and raise your limits. 7-day free trial.
```

## 2. Version → What's New (Tiếng Việt)

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
