# WarrantyVault iOS

Native iOS app — SwiftUI + async/await, talks to the Next.js backend via REST.

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
    └── Features/
        ├── Auth/LoginView.swift
        ├── Devices/DevicesListView.swift
        ├── Devices/AddDeviceSheet.swift
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
| Devices: edit (full fields) | ✅ — `AddDeviceSheet(editing:)` (name/category/brand/model/serial/store/date/giá/status/notes) |
| Warranties CRUD | ✅ — `WarrantyEditorSheet` từ DeviceDetailView |
| Subscriptions | ✅ — `SubscriptionsListView` + `SubscriptionEditorSheet` + detail |
| Wishlist | ✅ — `WishlistListView` + `WishlistEditorSheet` + detail |
| Attachments upload (camera roll + PDF picker) | ✅ — `AttachmentsSection` (PhotosPicker + fileImporter) |
| Stats screen | ✅ — `StatsView` (devices / bảo hành sắp hết 7-30 ngày / subs monthly / wishlist) |
| Reminders screen | ✅ — `RemindersView` (List + swipe-to-dismiss + nút "Đã xem") |
| Settings: đổi mật khẩu | ✅ — `ChangePasswordSheet` qua `POST /api/v1/auth/change-password` |
| Push (APNs token register) | ✅ — `PushRegistrar` + `AppDelegate` wire `UNUserNotificationCenter`, gọi `client.registerPush(.apns)` |
| Catalog autocomplete đầy đủ | ✅ — `CatalogStore` + `AutocompleteChips` (brand/store/warranty provider) |

Code pattern: mỗi module = 1 `Store: ObservableObject` (state) + 1 hoặc N `View` SwiftUI gọi store. Xem `DevicesStore.swift` + `DevicesListView.swift` làm template.
