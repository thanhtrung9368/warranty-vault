# WarrantyVault iOS

Native iOS app — SwiftUI + async/await, talks to the Go backend (`../api`) via REST.

## Cấu trúc

```
ios/
├── Package.swift                  # SwiftPM library "WarrantyVaultKit"
├── Sources/WarrantyVaultKit/      # API client, models, auth — không phụ thuộc UIKit/SwiftUI
│   ├── APIClient.swift            # URLSession + Bearer token, JSON encode/decode
│   ├── Endpoints.swift            # 1 method/route, mirror openapi.yaml
│   ├── Models.swift               # Codable types
│   ├── Errors.swift               # APIError với fieldErrors
│   └── KeychainStore.swift        # token persistence
└── App/                           # SwiftUI app sources
    ├── WarrantyVaultApp.swift     # @main entry
    ├── RootView.swift             # Login / TabBar switch
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

## Mở trong Xcode (lần đầu)

Chưa có file `.xcodeproj` — tự tạo trong Xcode để tránh commit project format mỗi lần Xcode bump version. Một lần thôi:

1. Mở Xcode → **File → New → Project**
2. Chọn **iOS → App** → **Next**
3. Product Name: **WarrantyVault**
4. Organization Identifier: **com.warrantyvault** (matches `applicationId` của Android + APNs bundle ID sau này)
5. Interface: **SwiftUI**, Language: **Swift**, Storage: **None**
6. Save vào `ios/` (cùng folder với `Package.swift` này)
7. Khi Xcode hỏi git, chọn **không tạo git repo riêng** — repo này đã là git
8. Xcode tự tạo `WarrantyVault.xcodeproj` + thư mục `WarrantyVault/` chứa `WarrantyVaultApp.swift` mặc định
9. **Xoá** thư mục `WarrantyVault/` mà Xcode vừa tạo (cùng `ContentView.swift`, `Assets.xcassets`, …) — mình dùng sources trong `App/` thay
10. **Drag** thư mục `App/` vào Xcode project navigator → chọn **"Create folder references"** (KHÔNG phải groups) → **Finish**
11. **File → Add Package Dependencies** → click **Add Local…** → chọn folder `ios/` (cái có `Package.swift`) → **Add Package** → tick library `WarrantyVaultKit` cho target `WarrantyVault` → **Add Package**
12. Click target **WarrantyVault** → **Info** tab → thêm key **App Transport Security Settings** → **Allow Arbitrary Loads** = **YES** *(chỉ để dev — gọi `http://localhost:3000`. Khi deploy prod thì gỡ ra)*
13. Run trên Simulator → đăng nhập / đăng ký bằng tài khoản backend dev đang chạy

## Chạy thử

Bật backend trước:
```
npm run dev   # cùng repo, ở root
```

Trong Xcode bấm Run (⌘R). Simulator load `http://localhost:3000` qua loopback chung với máy host.

**Test trên iPhone thật cùng Wi-Fi**:
1. Sửa `AppConfig.baseURL` trong `App/WarrantyVaultApp.swift` thành IP LAN, ví dụ `http://192.168.1.17:3000`
2. Trên Mac chạy: `npm run dev -- -H 0.0.0.0` để Next bind ra ngoài loopback
3. Plug iPhone, chọn target device, Run

Hoặc set env var khi build (không cần sửa code): trong Xcode scheme → Run → Arguments → Environment Variables → `WV_BASE_URL=http://192.168.1.17:3000`.

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
| Bán lại (migration 0006) | ✅ CÓ UI — `DeviceResale` (giữ nguyên cặp `soldAt`/`soldPrice` mỗi lần PATCH, kể cả PATCH chỉ đổi trạng thái) + khối "Bán lại" trong `DeviceFormView` (ngày bán, giá bán, lãi/lỗ trực tiếp) và mục chỉ đọc trong `DeviceDetailView`. Giá `0` = cho tặng, không phải "chưa bán"; server bắt buộc đủ cặp, thông báo tiếng Việt lấy nguyên văn từ server |

Code pattern: mỗi module = 1 `Store: ObservableObject` (state) + 1 hoặc N `View` SwiftUI gọi store. Xem `DevicesStore.swift` + `DevicesScreen.swift` làm template.
