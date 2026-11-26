# App Store Connect — việc còn lại (mày tự làm)

App: **Warrly: Warranty Tracker** · Apple ID **6824143315** · Bundle `com.warrly`
ASC: https://appstoreconnect.apple.com/apps/6824143315
Listing công khai: https://apps.apple.com/app/id6824143315 — đã mở ngày
2026-11-26, chuyển tới bản US `warrly-warranty-tracker/id6824143315`. Đây là URL
thật duy nhất; repo không có URL listing nào khác, đừng tạo link `warrly.com/...`
thay thế.

> Trạng thái 2026-11-26: **1.0.2 (build 34) đang live** trên App Store (phát hành
> 2026-11-25). Bản đang chuẩn bị là **1.0.3**: repo ở build **39**, build
> submit là **39** (`ios/project.yml`; docs này không sửa số build). App Privacy
> đã Publish, age rating **4+**, hai subscription product đã tạo và listing 1.0.2
> hiển thị In-App Purchases.

## Đã xong (không cần làm lại)

- App record, tên, subtitle, category Productivity + Finance.
- Content Rights: "No… third-party content".
- Age Rating: **4+** (Advertising = Yes; không UGC/dating/location).
  Xác nhận từ listing công khai: `contentAdvisoryRating: 4+`.
- App Privacy: **đã Publish**. Listing công khai hiển thị:
  - Data Used to Track You: Identifiers, Usage Data.
  - Data Linked to You: Purchases, Contact Info, User Content, Identifiers.
  - Data Not Linked to You: Usage Data.
  Khớp `ios/App/PrivacyInfo.xcprivacy`: DeviceID + AdvertisingData tracking =
  true, Name/Email/UserID linked, App Functionality; không có crash/analytics SDK.
  `NSUserTrackingUsageDescription` và AdMob/UMP vẫn là lý do phải khai tracking.
- Subscription group **Warrly Premium** (ID `22560559`) + hai product
  `com.warrly.premium.monthly` (49.000đ/tháng) và
  `com.warrly.premium.yearly` (399.000đ/năm), cùng 7-day free trial; listing
  1.0.2 hiển thị In-App Purchases.
- Screenshots đang live: **10 ảnh iPhone + 10 ảnh iPad** (tên `01-dashboard` …
  `10-final`). Bộ trong repo `artifacts/appstore/` chỉ còn 5+5 bản cũ — xem
  `docs/APP_STORE_VI.md` mục 7.
- iPhone Duo: bộ **10 inner + 10 outer** trong
  `artifacts/appstore/duo-official/` (và bản VI), đủ số lượng. Nhưng xem cảnh
  báo nguồn ảnh bên dưới trước khi coi là ảnh Duo thật.
- Encryption: `ITSAppUsesNonExemptEncryption = false` đã có trong `ios/App/Info.plist`.
- Digital Services Act (trader): đã tự khai.

## Còn lại cho 1.0.3

1. **Build 39**: `CURRENT_PROJECT_VERSION` = **39** đã đặt trong `ios/project.yml`
   (gồm XCUITest); archive và upload; chọn build 39 cho version 1.0.3. Build 39
   là bản hiện tại trong repo; **không** submit build 36/37/38.
2. **App Review Information → Notes**: dán nguyên khối "1.0.3 — App Review
   Information → Notes" trong `docs/APP_STORE_RELEASE_NOTES.md` lên đầu ô Notes.
   Nói rõ: tỷ giá tham khảo **không phải** số tiền bị charge; 7-day trial chỉ hiện
   khi StoreKit báo tài khoản đủ điều kiện.
3. **What's New**: dán bản VI + EN của 1.0.3 từ `docs/APP_STORE_RELEASE_NOTES.md`
   vào cả localization English và Vietnamese của version 1.0.3.
4. **Screenshots**: kiểm bộ 10+10 iPhone/iPad và 10+10 Duo còn gắn đúng version
   1.0.3. Bộ Duo hiện có là ảnh **dựng** từ capture iPad-width trong khung Duo
   chính thức (`Tools/appstore_screenshots_duo_official.py`), không phải capture
   trực tiếp màn hình trong/ngoài — xem mục "Screenshot sets" trong
   `docs/APP_STORE_RELEASE_NOTES.md`. Nếu cần claim ảnh Duo thật, phải chụp lại
   trước khi submit; đừng dán câu "ảnh chụp từ build 1.0.2 (34)" cho bộ này.
5. **Demo account** trong App Review Information còn đăng nhập được (không ghi
   mật khẩu vào repo).
6. **Sandbox purchase + Restore** trên máy thật với cả hai product; kiểm paywall
   chỉ hiện "Dùng thử 7 ngày" khi tài khoản đủ điều kiện.
7. **App Accessibility** (ASC → App Accessibility): chưa xác nhận trạng thái.
   Chỉ tick tính năng đã tự thử trên máy — đừng khai theo số grep. Bằng chứng
   trong `ios/`: Dynamic Type có, VoiceOver một phần, Reduce Motion chưa.
8. Bấm **Add for Review → Submit** khi 1–7 xong.

## Kiểm tra nhanh trước submit

- [ ] `https://warrly.com`, `/privacy`, `/terms` mở được; privacy §4 khớp AI
      consent (ba việc, Anthropic, lưu `extractedText` dạng plaintext).
- [ ] Listing URL/ID đúng: **6824143315** /
      https://apps.apple.com/app/id6824143315
- [ ] App Privacy và Age Rating không đổi so với 1.0.2 (1.0.3 không thêm SDK hay
      loại dữ liệu mới).
- [ ] Không còn câu "TestFlight" hoặc "chưa mở bán" trong mô tả/What's New.
- [ ] App Review Notes nói rõ tỷ giá tham khảo không phải số tiền bị charge.

## Ghi chú lịch sử

- 1.0.0 (build 23) và 1.0.2 (build 34) đã submit/live. Hướng dẫn tạo
  subscription group ban đầu nằm trong `docs/APP_STORE_SUBSCRIPTION_GROUP.md`;
  tài liệu đó mang tính lịch sử và số build trong đó đã cũ.
