# Warrly iOS

Native iOS app — SwiftUI + async/await, talks to the Go backend (`../api`) via REST.

## Song ngữ (Anh + Việt)

Xem [docs/I18N_PLAN.md](../docs/I18N_PLAN.md) §3 pha 3. Tóm tắt:

- **Tiếng Việt là bản gốc.** Chuỗi tiếng Việt đang có là **khoá** của catalog; bản tiếng Anh
  là bản dịch thêm. Cách này giống hệt `api/internal/i18n/catalog.go`.
- Catalog là một **String Catalog** thật — `Sources/WarrlyKit/Resources/Localizable.xcstrings`
  — mở/sửa được bằng String Catalog editor của Xcode. Nó được khai báo `.copy` trong
  `Package.swift`: thiếu khai báo đó thì file **không** vào `Bundle.module` và mọi chuỗi
  lặng lẽ rơi về tiếng Việt, không có lỗi nào.
- Gọi chuỗi qua `L.t("…")` (có tham số thì `%d` / `%@`) và `L.p("…", n)` khi câu đếm số
  lượng — tiếng Việt không biến đổi, tiếng Anh có (`1 day` / `3 days`).
- Ngôn ngữ chọn ở **Cài đặt → Ngôn ngữ**, lưu bằng `PATCH /api/v1/auth/me {locale}` vì cron
  của server cần biết để dựng push/email. `Accept-Language` được gắn trong `APIClient` cho
  **mọi** request nên lỗi validate của Go về cùng ngôn ngữ với UI.
- Test trong `Tests/…/LocalizationTests.swift` ghim hai điều: **hai bảng en/vi trùng tập khoá**
  và **mọi `L.t` literal trong `Sources/` + `App/` + `ShareExtension/` đều có entry đủ hai
  ngôn ngữ** (quét source, không cần build app).
- Công cụ: `Tools/catalog.py` (thêm entry / `check` / `stats`) và
  `Tools/wrap_strings.py` (bọc literal cũ thành `L.t`, **không** đụng literal có `\(…)`).

## Share Extension (Hộp thư đến)

`ShareExtension/` là target app-extension trong `project.yml` (bundle id
`com.warrly.ShareExtension`), nhận ảnh JPEG/PNG/HEIC và PDF từ Mail/Photos/Files.

- **Không upload trong extension.** Extension không có token, không có network: nó chỉ
  kiểm tra magic bytes + giới hạn 5 MB (`AttachmentFileType`) rồi ghi file vào App Group
  `group.com.warrly` qua `SharedInboxStore` (`Sources/WarrlyKit/SharedInbox.swift`).
- App drain queue đó khi mở/foreground (`InboxStore.importSharedFiles()`), upload với
  `deviceId: nil` — tức là vào Hộp thư đến, không chiếm slot của thiết bị nào. Upload lỗi
  thì file **vẫn nằm trong queue** và được thử lại; chỉ xoá sau khi server trả 2xx.
- Hệ quả: hi hữu có thể trùng một dòng nếu app chết giữa lúc upload xong và lúc xoá queue
  (at-least-once). Mất file thì không thể cứu; trùng thì xoá được.
- Cần bật App Groups cho **cả hai** bundle id trong Apple Developer portal, nếu không
  `containerURL(forSecurityApplicationGroupIdentifier:)` trả `nil` và extension báo
  "Warrly chưa sẵn sàng nhận tệp được chia sẻ.".
- Scheme `ShareExtension` được khai báo tường minh trong `project.yml` để build được bằng
  `xcodebuild` (XcodeGen không tự tạo shared scheme cho extension).

## Widget, Spotlight, App Intents

- **Widget `WarrlyWidget`** (WidgetKit, chỉ `systemSmall` + `systemMedium`) hiển thị các
  hạn bảo hành gần nhất. Widget **không có token và không gọi API**: app ghi snapshot vào
  App Group `group.com.warrly` tại `Surface/deadline-snapshot.json`
  (`DeadlineSnapshotStore` trong `Sources/WarrlyKit/DeadlineSnapshot.swift`).
- App ghi lại snapshot khi foreground và sau mọi thao tác có thể đổi hạn (thiết bị, bảo
  hành, ẩn/hoàn tác nhắc nhở, nhập backup, wishlist → PURCHASED). Nguồn deadline là
  `GET /api/v1/reminders?withinDays=90` (cùng cửa sổ với màn Nhắc nhở); danh sách thiết bị
  lấy từ `GET /api/v1/devices`.
- **Tuổi snapshot được hiển thị.** Sau 6 giờ widget hiện "Tính đến …" / "As of …"; sau 48
  giờ thêm dòng "Mở Warrly để cập nhật". Timeline có entry tại nửa đêm (đổi "còn 1 ngày"
  → "hết hạn hôm nay"), tại mốc 6h/48h, và policy `.atEnd` — không wake mỗi giờ vì widget
  không thể lấy dữ liệu mới, chỉ có thể đọc lại đúng file đó.
- **Spotlight** index `name`, `brand`, `model`, `serialNumber` qua `CSSearchableIndex`
  (`App/Core/Surface/DeviceSpotlightIndexer.swift`); không index notes, claim, OCR hay
  giá. Re-index khi foreground và sau mutation; xoá entry của thiết bị đã xoá và xoá sạch
  khi đăng xuất.
- **App Intents** (`App/AppIntents/WarrlyIntents.swift`): `GetWarrantyExpiryIntent` trả lời
  "khi nào X hết hạn" (đọc API, fallback snapshot có ghi rõ "as of"), `OpenDeviceIntent` mở
  app đúng thiết bị, `NextDeadlineIntent` đọc mốc kế tiếp từ snapshot. `WarrlyShortcuts`
  đăng ký App Shortcuts để ba intent xuất hiện trong Shortcuts/Siri.
- **Riêng tư:** extension **không** khai báo family `.accessory*`, nên widget không bao giờ
  render trên Lock Screen — tên thiết bị chỉ hiện sau khi mở khoá. Trong view vẫn có
  `privacySensitive()` và nhánh thay tên bằng "Thiết bị" nếu hệ thống render ở chế độ
  vibrant/luminance-reduced. Đăng xuất xoá snapshot, Spotlight và pending deep link.
- Build extension: `xcodebuild build -project Warrly.xcodeproj -scheme WarrlyWidget ...`.

## Cấu trúc

```
ios/
├── Package.swift                  # SwiftPM library "WarrlyKit"
├── ShareExtension/                # Share Extension target — App Group hand-off, no network/token
│   ├── ShareViewController.swift
│   └── Info.plist                 # generated by XcodeGen
├── WidgetExtension/               # WidgetKit target — reads the App Group snapshot only
│   ├── WarrlyDeadlineWidget.swift
│   ├── Info.plist                 # generated by XcodeGen
│   └── PrivacyInfo.xcprivacy
├── Sources/WarrlyKit/      # API client, models, auth — không phụ thuộc UIKit/SwiftUI
│   ├── APIClient.swift            # URLSession + Bearer token, JSON encode/decode
│   ├── Endpoints.swift            # 1 method/route, mirror openapi.yaml
│   ├── Models.swift               # Codable types
│   ├── Errors.swift               # APIError với fieldErrors
│   └── KeychainStore.swift        # token persistence
└── App/                           # SwiftUI app sources
    ├── WarrlyApp.swift     # @main entry
    ├── RootView.swift             # Login / TabBar switch
    ├── AppIntents/                # Siri / Shortcuts intents + App Shortcuts
    ├── Ads/                       # AdMob: consent order (UMP → ATT → start), adaptive banner
    │   ├── AdsConfig.swift        # per-config ad-unit id, test devices, paid-tier flag
    │   ├── AdsController.swift    # the only file that talks to Google's SDKs
    │   └── AdsBannerView.swift    # UIViewRepresentable banner + the 50 pt slot
    ├── Core/Surface/              # deadline snapshot writer, Spotlight indexer, deep-link router
    ├── DesignSystem/
    │   ├── Theme.swift            # Colors mirror src/app/globals.css
    │   └── Components.swift       # WVCard, WVTextField, button styles
    ├── State/
    │   ├── AuthStore.swift        # @MainActor ObservableObject — login/logout/me
    │   └── DevicesStore.swift     # ObservableObject — load/create/delete
    └── Features/                  # 5-tab shell (Dashboard / Devices / Subscriptions / Wishlist / More)
        ├── Auth/LoginView.swift
        ├── Dashboard/DashboardView.swift
        ├── Devices/DevicesScreen.swift      # list
        ├── Devices/DeviceFormView.swift     # full-screen add/edit (was AddDeviceSheet)
        └── Settings/SettingsView.swift
```

Lib (Sources/) build sạch bằng SwiftPM CLI:

```
cd ios
swift build
```

## Mở trong Xcode

`Warrly.xcodeproj` được **sinh ra** từ `project.yml` bằng [XcodeGen](https://github.com/yonaskolb/XcodeGen)
— đừng sửa tay file project, sửa `project.yml` rồi sinh lại:

```
cd ios
xcodegen generate
open Warrly.xcodeproj
```

**Thêm file mới dưới `App/` thì BẮT BUỘC chạy `xcodegen generate`** — project liệt kê source
theo đường dẫn, file mới không tự xuất hiện. File mới trong `Sources/WarrlyKit/` thì
không cần: SwiftPM tự thấy.

Build kiểm tra không cần Xcode GUI:

```
cd ios
xcodebuild build -project Warrly.xcodeproj -scheme Warrly \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/wv-ios-dd CODE_SIGNING_ALLOWED=NO
rm -rf /tmp/wv-ios-dd
```

CI chỉ build thư viện (`swift build` + `swift test`), **không** build app — nên một lỗi biên
dịch trong `App/` sẽ không làm đỏ CI, phải tự chạy `xcodebuild` ở trên.

## Chạy thử

Bật backend Go (port 4000) trước:
```
cd api && go run ./cmd/server
```

Trong Xcode bấm Run (⌘R). Bản **Debug** lấy `http://localhost:4000` từ
`Config/Debug.xcconfig`; simulator dùng chung loopback với máy host nên chạy được ngay.
Bản **Release** lấy `https://api.warrly.com` từ `Config/Release.xcconfig` — không cần
environment, nên bản TestFlight trỏ đúng production.

Muốn trỏ sang backend khác (staging, máy khác trong LAN) mà không sửa project: đặt biến môi
trường `WV_BASE_URL` trong scheme (Run → Arguments → Environment Variables). Biến này thắng
giá trị trong Info.plist. Nếu đặt mà sai định dạng, app **crash ngay khi khởi động** kèm lý do
— cố ý, để một bản build trỏ nhầm chỗ không âm thầm gửi request đi.

Lưu ý ATS: app chỉ cho phép HTTP không mã hoá tới `localhost` (Debug). Gọi
`http://<LAN-IP>:4000` từ iPhone thật sẽ bị iOS chặn; dùng HTTPS hoặc tunnel, đừng thêm lại
`NSAllowsArbitraryLoads`.

## Quảng cáo (Google AdMob) — chỉ ở gói miễn phí

Banner **adaptive** ở đáy màn Thiết bị. SDK: `Google-Mobile-Ads-SDK` **13.11.0** + UMP
**3.1.0**, khai báo trong `project.yml` bằng `exactVersion` (không phải `from:`) vì nâng SDK
quảng cáo là thay đổi phải review, không phải resolve ngầm.

- **Id cấu hình theo build.** `GADApplicationIdentifier` (dạng `~`) nằm trong `project.yml`;
  ad-unit id (dạng `/`) đi qua `WV_ADMOB_BANNER_UNIT_ID`:
  `Config/Debug.xcconfig` = unit **test** của Google, `Config/Release.xcconfig` = unit thật.
  App đọc qua key `GADBannerUnitID` trong Info.plist (`App/Ads/AdsConfig.swift`).
  Đây là ranh giới **policy**, không phải sở thích: publisher `pub-1055054650162014` dùng
  chung với app khác của chủ sản phẩm — ⛔ **không bao giờ bấm quảng cáo thật**.
- **Thứ tự consent do STATE quyết định, không do số giây** — `WarrlyKit/AdsConsentOrdering.swift`
  (`AdsConsentSession`), có test ghim (`AdsConsentOrderingTests`):
  UMP `requestConsentInfoUpdate` → form nếu bắt buộc, đợi form đóng → ATT → `MobileAds.start`
  → banner mới được request. Ba lần bị từ chối của app trước đến từ đúng thứ tự này:
  ATT nằm sau UMP không timeout (2.1), rồi timeout cứng làm ATT hiện **trước** form GDPR
  (5.1.1(iv)), rồi IDFA explainer của UMP còn trên màn hình khi ATT hiện.
  - Có **budget** 10 s cho pha UMP, nhưng budget chỉ *đóng cửa sổ form* — sau đó không form
    nào được present nữa, nên ATT không thể chạy trước một form sẽ hiện sau. UMP lỗi/treo ⇒
    quảng cáo vẫn khởi tạo ở trạng thái **non-personalised**, không phải không có quảng cáo.
  - ATT được **retry ở mọi lần foreground** (không phải một lần mỗi cài đặt).
  - UMP có message trên màn hình thì ATT đứng yên: không có API công khai cho việc này, nên
    `AdsController` quét view hierarchy tìm class `UMPView`.
- **`npa=1`** khi thiếu một trong hai cơ sở pháp lý: GDPR/TCF (UMP) hoặc ATT. Người chấp nhận
  form GDPR nhưng từ chối ATT ⇒ quảng cáo **non-personalised**, không phải mất banner.
- **Banner**: `App/Ads/AdsBannerView.swift` — `UIViewRepresentable` bọc `BannerView`, size
  `inlineAdaptiveBanner(width:maxHeight:)`, gắn bằng `safeAreaInset(edge: .bottom)` **ngoài**
  scroll view (không bị unmount khi scroll ⇒ không phát sinh request mỗi vòng), slot cao
  **50 pt** giữ chỗ trước khi có ad nên list không nhảy (`ScreenMetrics.adBannerSlotHeight`).
  `updateUIView` chỉ reload khi bề rộng đổi hoặc quyết định cá nhân hoá đổi.
- **Gói trả phí**: banner ẩn hoàn toàn (`AdsController.isAdFree`). Gói trả phí **chưa mở bán**
  nên chưa có gì bật cờ này; Debug có thể ép bằng `WV_ADS_FREE=1` để thử nhánh ẩn.
- **Test device**: simulator luôn là test device; trên máy thật, Debug dùng unit test nên
  không thể hiện quảng cáo thật. Nếu cố tình trỏ Debug vào unit thật để kiểm tra fill, đặt
  `WV_ADS_TEST_DEVICES=<id>` (id SDK in ra console ở request đầu tiên).
- **Đã build, CHƯA xác minh trên máy thật**: chưa ai thấy ATT prompt, form UMP, hay một
  impression thật. Việc cần làm trên thiết bị nằm trong báo cáo bàn giao, không phải TODO
  trong repo này.

## Privacy manifest

Có **bốn** file `PrivacyInfo.xcprivacy`, cả bốn đều phải nằm trong bundle khi build
(`find Warrly.app -name PrivacyInfo.xcprivacy` sau khi build là cách kiểm tra):

- `App/PrivacyInfo.xcprivacy` — app target. **`NSPrivacyTracking = true`** + danh sách
  `NSPrivacyTrackingDomains` không rỗng (googleadservices.com, googleads.g.doubleclick.net,
  doubleclick.net, pagead2.googlesyndication.com) vì app đọc IDFA cho AdMob; khai báo
  `DeviceID` (tracking = true, gộp cả push token) + `AdvertisingData` (tracking = true), cùng
  các loại dữ liệu app thu thập (email, tên, user ID, ảnh/PDF, nội dung người dùng nhập, lịch
  sử mua) và `UserDefaults` (`CA92.1`, `1C8F.1`).
- `ShareExtension/PrivacyInfo.xcprivacy`, `WidgetExtension/PrivacyInfo.xcprivacy`,
  `Sources/WarrlyKit/Resources/PrivacyInfo.xcprivacy` — cùng cờ tracking + domains, nhưng
  **không** khai báo dữ liệu quảng cáo: các bundle này không gọi mạng tới miền quảng cáo và
  không thu thập IDFA. Cờ tracking phải khớp nhau ở mọi bundle trong archive.

⚠️ `NSPrivacyTrackingDomains` **phải** không rỗng khi `NSPrivacyTracking = true`, nếu không
App Store Connect trả **ITMS-91064** ("NSPrivacyTracking must be true if
NSPrivacyTrackingDomains isn't empty" — câu chữ của Apple ngược với thứ họ thực thi). Hệ quả
lúc chạy: iOS **chặn** các miền đó khi người dùng chưa cấp ATT, nên người từ chối ATT có thể
không thấy ad nào; đó là hành vi đúng của key.

Thêm required-reason API mới thì phải cập nhật đúng manifest tương ứng; thiếu file thì app
vẫn build và ship, chỉ bị App Store từ chối một cách âm thầm.

## Phần đã làm vs còn để TODO

| Module | Status |
|---|---|
| API client (toàn bộ endpoints REST) | ✅ |
| Auth: login / register / logout / me | ✅ |
| Devices: list / create / inline warranty | ✅ |
| Devices: detail screen | ✅ — `DeviceDetailView` (header + warranties + attachments) |
| Devices: edit (full fields) | ✅ — `DeviceFormView` (full-screen add/edit; name/category/brand/model/serial/store/date/giá/status/notes) |
| Warranties CRUD | ✅ — `WarrantyFormView` từ DeviceDetailView |
| Subscriptions | ✅ — `SubscriptionsScreen` + `SubscriptionFormView` + `SubscriptionDetailView` (payment log + renew) |
| Wishlist | ✅ — `WishlistScreen` + `WishlistFormView` + `WishlistDetailView` |
| Attachments upload (camera roll + PDF picker) | ✅ — `AttachmentsSection` (PhotosPicker + fileImporter) |
| AI quét hoá đơn (opt-in) | ✅ — gated trên `aiOptIn`; toggle ở `SettingsView`, gọi `client.extractReceipt` |
| Backup export/import + xoá tài khoản | ✅ — `SettingsView` (fileExporter/fileImporter) + `AccountView` |
| Stats screen | ✅ — `StatsView` (devices / bảo hành sắp hết 7-30 ngày / subs monthly / wishlist) |
| Reminders screen | ✅ — `RemindersView` (buckets 30/60/90 + dismiss + undo "Hoàn tác") |
| Settings: đổi mật khẩu | ✅ — `ChangePasswordSheet` qua `POST /api/v1/auth/change-password` |
| Push (APNs token register) | ✅ — `PushRegistrar` + `AppDelegate` wire `UNUserNotificationCenter`, gọi `client.registerPush(.apns)` |
| Catalog autocomplete đầy đủ | ✅ — `CatalogStore` + `AutocompleteChips` (brand/store/warranty provider) |
| Việc cần xử lý (`GET /api/v1/actions`) | ✅ — `ActionQueueScreen` từ card trên Dashboard: section theo mức độ, hoãn 1–365 ngày, tab "Đang hoãn" (`?snoozed=true` chỉ **thêm** dòng) + bỏ hoãn. Badge đọc `counts.total`, không đọc số dòng |
| Soát gói đăng ký (`GET /api/v1/subscriptions/audit`) | ✅ — `SubscriptionAuditScreen` từ màn Đăng ký: chỉ tư vấn, render nguyên văn `title`/`detail`/`note` của server, luật lấy từ `thresholds`, không có nút huỷ/tắt tự gia hạn |
| Hạn đổi/trả (migration 0010) | ✅ GIỮ NGUYÊN, không có UI đặt — `DeviceReturnWindow` + `DeviceFormView`/`DeviceDetailView` gửi lại `returnWindowDays`/`receivedAt` nguyên trạng mỗi lần PATCH (PATCH thay thế toàn bộ thiết bị) |
| Quảng cáo (AdMob) | ⚠️ ĐÃ VIẾT + BUILD, **CHƯA CHẠY TRÊN MÁY THẬT** — `App/Ads/` (`AdsController` + adaptive banner ở đáy màn Thiết bị, slot 50 pt, ẩn với gói trả phí); thứ tự UMP → ATT → `MobileAds.start` ghim bằng test trong `WarrlyKit/AdsConsentOrdering.swift`. Chưa ai thấy ATT prompt / form UMP / impression thật — xem mục "Quảng cáo" ở trên |
| Bán lại (migration 0006) | ✅ CÓ UI — `DeviceResale` (giữ nguyên cặp `soldAt`/`soldPrice` mỗi lần PATCH, kể cả PATCH chỉ đổi trạng thái) + khối "Bán lại" trong `DeviceFormView` (ngày bán, giá bán, lãi/lỗ trực tiếp) và mục chỉ đọc trong `DeviceDetailView`. Giá `0` = cho tặng, không phải "chưa bán"; server bắt buộc đủ cặp, thông báo tiếng Việt lấy nguyên văn từ server |

Code pattern: mỗi module = 1 `Store: ObservableObject` (state) + 1 hoặc N `View` SwiftUI gọi store. Xem `DevicesStore.swift` + `DevicesScreen.swift` làm template.
