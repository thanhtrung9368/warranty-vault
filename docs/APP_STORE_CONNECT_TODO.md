# App Store Connect — việc còn lại (mày tự làm)

App: Warrly · Apple ID 6824143315 · iOS 1.0.0 (Prepare for Submission) · build 5 on ASC

> Trạng thái 2026-11-08: backend Premium đã live; legal copy đã live. Cần tạo 2
> subscription product, build/upload build mới và test sandbox trước khi submit.

## Đã điền xong (2026-11-02)
- Version page: Promotional Text, Description, Keywords, Support URL `https://warrly.com`,
  Version, Copyright, Build 5, Manually release, Contact Information, Sign-in demo account.
- App Information: Name `Warrly: Warranty Tracker`, Subtitle `Receipts, warranties, renewals`,
  Category Productivity + Finance.


## Warrly Premium — mới, chưa tạo trên ASC

Backend đã xong và đã deploy production:
- `POST /api/v1/billing/verify` live (không auth → 401; JWS rác → 400).
- Migration `0027_premium_entitlement` đã apply; goose version 27.
- `/auth/me` có `premium` khi tài khoản đang Premium.
- Giới hạn Premium: 200 thiết bị đang dùng / 2.000 tổng / 500 đăng ký / 1.000 wishlist.

iOS:
- Nhánh sạch `feat/premium-ios` (commit `852f037`) có StoreKit 2, paywall, Settings row,
  ads gating; build simulator xanh.
- Chưa có `.xcarchive`: archive fail vì đĩa đầy (`No space left on device`), không phải code.
  Cần free ~4–5GB rồi archive trong Xcode từ nhánh sạch hoặc working tree integrated.

Tạo trên ASC (mày làm):
1. Monetization → Subscriptions → Subscription Group `Warrly Premium`.
2. `com.warrly.premium.monthly` — 1 month — **49.000đ** — 7-day free trial.
3. `com.warrly.premium.yearly` — 1 year — **399.000đ** — 7-day free trial.
4. Localization en + vi; review screenshot (paywall); **Ready to Submit**; gắn cả hai vào
   app version.
5. Tạo **Sandbox Tester**; sau khi có build mới, test mua + Restore.
6. App Review note: subscription removes ads and raises limits; auto-renewable; both products.

Legal copy đã live: `https://warrly.com/terms` §5 và `https://warrly.com/privacy` §5.

## Chưa làm — cần mày

1. ~~**Content Rights**~~ — ✅ đã xong (chọn "No... third-party content").
2. ~~**Age Ratings**~~ — ✅ đã xong (4+; Advertising = Yes, còn lại No/None).
3. **App Privacy** (https://appstoreconnect.apple.com/apps/6824143315/distribution/privacy)
   - Privacy Policy URL: `https://warrly.com/privacy`
   - Apple đang báo đỏ: app có `NSUserTrackingUsageDescription` → phải khai có tracking.
   - Contact info: Email Address, Name — linked to user, App Functionality, không tracking.
   - User Content: Photos, Other User Content — linked to user, App Functionality, không tracking.
   - Purchases: Purchase History — linked to user, App Functionality.
   - Identifiers: User ID (App Functionality, linked); Device ID (IDFA/push token) —
     Third-Party Advertising, **có tracking**.
   - Usage Data: Advertising Data — **có tracking**.
   - Không thu Location, Contacts. Code chỉ có AdMob + UMP, không có crash/analytics SDK.
   - Bấm **Publish** ở cuối.
4. **App Accessibility** (…/distribution/accessibility): khai đúng thực tế. Bằng chứng trong
   `ios/`: `accessibilityLabel` 25 chỗ, `accessibilityHint` 2, `dynamicTypeSize` 88,
   `@ScaledMetric` 3, `accessibilityReduceMotion` 0, `preferredColorScheme` 1.
   → Dynamic Type có vẻ có; VoiceOver một phần; Reduce Motion chưa. **Chỉ tick tính năng
   đã tự thử trên máy**, đừng khai theo số grep.
5. **Screenshots iPhone** (version page → App Previews and Screenshots): chưa có.
   Premium còn cần **review screenshot** cho từng subscription (dùng màn hình paywall).
6. **Encryption**: `ITSAppUsesNonExemptEncryption = false` đã có trong Info.plist → không cần gì thêm.
7. **Build mới**: build 5 trên ASC là bản cũ. Upload build mới (project build > 5), chọn
   build đó cho version 1.0.0.
8. **Add for Review / Submit**: mày tự bấm khi 1–7 xong.

## Cần kiểm tra
- `https://warrly.com` và `https://warrly.com/privacy` phải mở được và là nội dung thật.
- Digital Services Act (trader) đã tự khai, tao không đụng.
