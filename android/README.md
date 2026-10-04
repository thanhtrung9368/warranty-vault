# WarrantyVault Android

Native Android app — Kotlin + Jetpack Compose + Material 3, talks to the Go backend (`../api`) via REST.

## Cấu trúc

```
android/
├── settings.gradle.kts
├── build.gradle.kts
├── gradle/libs.versions.toml      # all dependency versions in one place
├── gradle.properties
├── gradle/wrapper/                # gradle wrapper (committed)
├── gradlew, gradlew.bat
└── app/
    ├── build.gradle.kts
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── res/
        │   ├── values/{strings.xml, themes.xml}
        │   ├── mipmap-anydpi-v26/{ic_launcher,ic_launcher_round}.xml
        │   └── drawable/ic_launcher_{foreground,background}.xml
        └── java/com/warrantyvault/app/
            ├── App.kt              # Application — singletons (TokenStore, Api, AuthStore)
            ├── MainActivity.kt     # @main entry, sets Compose
            ├── BuildConfig         # exposes BASE_URL (set in app/build.gradle.kts)
            ├── network/
            │   ├── ApiClient.kt    # Retrofit + OkHttp setup
            │   ├── ApiService.kt   # Retrofit interface, mirror openapi.yaml
            │   ├── AuthInterceptor.kt
            │   ├── Models.kt       # @Serializable DTOs
            │   └── Errors.kt       # decode ApiErrorEnvelope, fieldErrors
            ├── auth/
            │   ├── TokenStore.kt   # EncryptedSharedPreferences
            │   └── AuthStore.kt    # StateFlow status, login/logout/me
            ├── core/
            │   └── push/
            │       ├── WVMessagingService.kt  # FirebaseMessagingService
            │       └── PushRegistrar.kt       # auto POST token on login
            └── ui/
                ├── theme/Theme.kt          # colors mirror src/app/globals.css
                ├── RootScreen.kt           # Login / Main switch
                ├── MainScreen.kt           # bottom nav 5 tabs + detail route
                └── screens/
                    ├── login/LoginScreen.kt
                    ├── devices/
                    │   ├── DevicesScreen.kt
                    │   ├── AddDeviceSheet.kt
                    │   ├── DeviceDetailScreen.kt
                    │   └── WarrantyEditSheet.kt
                    └── settings/SettingsScreen.kt
```

## Mở trong Android Studio (lần đầu)

1. **Open** Android Studio → **File → Open** → chọn folder `android/`
2. Android Studio detect Gradle project → **Trust** project khi prompt
3. Đợi Gradle sync (lần đầu sẽ download AGP 8.7 + Compose BOM + …; mất vài phút)
4. Khi sync xong, chọn device:
   - **Emulator**: tạo Pixel 8 / API 34 trong AVD Manager. URL backend mặc định là `http://10.0.2.2:4000` (alias loopback đến máy host — Go API chạy ở cổng 4000).
   - **Device thật cùng Wi-Fi**: enable Developer Options + USB debugging, plug vào. Sửa `BASE_URL` trong `app/build.gradle.kts` thành IP LAN máy Mac (vd `http://192.168.1.17:4000`) rồi sync lại.
5. Bấm **Run ▶️** → app build + install → màn login hiện ra

## Chạy backend trước

```
cd ../api
go run ./cmd/server      # Go API ở http://localhost:4000
```

Trên emulator, app gọi `http://10.0.2.2:4000` → tự đến `localhost:4000` của Mac. Trên device thật, chạy Go server bind ra LAN (`HOST=0.0.0.0` hoặc tương đương) rồi trỏ `BASE_URL` về IP LAN của máy.

## Build từ CLI

```
cd android
./gradlew :app:assembleDebug    # output: app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:installDebug     # build + install lên emulator/device đang plug
./gradlew :app:bundleRelease    # AAB cho Play Store (cần keystore)
```

## Phần đã làm vs còn để TODO

| Module | Status |
|---|---|
| Network layer (Retrofit + Bearer interceptor + JSON serialization) | ✅ |
| Auth: register / login / logout / me, EncryptedSharedPreferences token | ✅ |
| Devices: list / create với inline warranty | ✅ |
| Devices: detail screen | ✅ — `DeviceDetailScreen.kt` |
| Warranties CRUD (thêm / sửa / xoá / dismiss reminder) | ✅ |
| FCM service + auto-register on login | ✅ — code hoàn chỉnh, cần `google-services.json` để bật |
| Subscriptions | ✅ — list / detail / edit sheet, billing cycle + custom interval |
| Wishlist | ✅ — list / detail / edit sheet, log price + mark-as-purchased |
| Chia sẻ link → wishlist (share target, #10) | ✅ — `share/ShareTarget.kt` (thuần Kotlin, có unit test) tách URL http(s) + tên sản phẩm từ `ACTION_SEND`/`text/plain`, `MainActivity` đẩy vào `ShareIntake`, `MainScreen` mở form wishlist điền sẵn `buyUrl`/`name`. Share lúc chưa đăng nhập được **giữ lại** và áp dụng ngay sau khi login; share không có link http(s) thì báo Toast tiếng Việt chứ không mở form rỗng. **Không** đọc/parse trang sản phẩm (scraping giá đã bị loại ở roadmap §5) |
| Attachments upload (PhotoPicker + DocumentPicker) | ✅ — image + PDF, multipart upload, FileProvider preview |
| Catalog autocomplete đầy đủ | ✅ — category, brand, store, warranty provider (auto-fill phone+địa chỉ); subscription brand cũng dùng catalog |
| Edit device | ✅ — `AddDeviceSheet` reuse với `existing: Device?`, mở từ `DeviceDetailScreen` action bar |
| Stats screen | ✅ — `StatsScreen.kt` tổng thiết bị / chi phí / sub tháng / wishlist, format VND vi-VN |
| Reminders screen | ✅ — `RemindersScreen.kt` list warranty sắp hết, color-coded, dismiss → `POST /api/v1/warranties/{id}/reminder` |
| Đổi mật khẩu | ✅ — `ChangePasswordSheet.kt` từ Settings, surface fieldErrors qua `Errors.kt` |
| Tìm kiếm xuyên thực thể | ✅ — `ui/screens/search/`, `GET /api/v1/search` một lượt trả cả thiết bị / gói / wishlist, mở từ icon kính lúp ở top bar, debounce 300 ms |
| Quét hoá đơn AI (ảnh + PDF) | ✅ — `ReceiptFiles.kt` sniff magic bytes, PDF gửi nguyên byte (không giải mã thành ảnh), HEIC/GIF transcode JPEG phía client |
| Hàng đợi "Việc cần xử lý" | ✅ — `ui/screens/actions/`, `GET /api/v1/actions` + hoãn/bỏ hoãn theo `itemKey` (`POST`/`DELETE …/snooze`). Badge lấy từ `counts` (luôn là tập đang cần xử lý, không tính việc đang hoãn); mở từ thẻ ở tab Tổng quan |
| Soát gói đăng ký | ✅ — `ui/screens/subscriptions/SubscriptionAuditScreen.kt`, `GET /api/v1/subscriptions/audit`. **Chỉ tư vấn**: hiện nguyên văn `note`/`title`/`detail` của server, nêu `thresholds` đã tạo ra kết luận, `material: false` đọc là thay đổi nhỏ — không có nút huỷ, không câu nào nói gói "không dùng" |
| Danh bạ bảo hành (#15) | ✅ — `ui/screens/devices/ServiceDirectorySection.kt` + `ServiceDirectoryInfo.kt` (thuần Kotlin, có unit test), `GET /api/v1/devices/{id}/service-directory`. Ba tầng tách bạch: link tra cứu **của chính hãng**, thông tin **do người dùng ghi** cho từng gói, và `null` = app không biết (hiện câu tiếng Việt, **không** đoán URL). `phoneSource` được render: `user` → số bấm gọi được kèm nhãn "Số do bạn tự ghi"; `none` → "Chưa có số điện thoại". `disclaimer` của server hiện nguyên văn. `Catalog.brandServiceInfo` đã thêm vào model (additive, có default) |
| Phiếu bàn giao bảo hành (#2) | ✅ — `ui/screens/devices/ShareCertificatesSection.kt` + `ShareLinks.kt` (thuần Kotlin, có unit test), `GET/POST /api/v1/devices/{id}/shares` + `DELETE /api/v1/shares/{id}`. **Token chỉ hiện một lần**: dialog tạo link có tiêu đề "Link chỉ hiện một lần", cảnh báo nằm **trên** link (không cuộn mất, không đọc sau khi lỡ tay), kèm nút Sao chép + Chia sẻ hệ thống; token **không** được ghi vào `TokenStore`/file/`rememberSaveable`. Chia sẻ ra ngoài loại chính app này khỏi chooser (`EXTRA_EXCLUDE_COMPONENTS`) để không đụng luồng share-target #10 |
| Hạn đổi/trả "1 đổi 1" (migration 0010) | ⏸️ **Chỉ giữ nguyên** — `Device`/`DeviceInput` có `returnWindowDays`/`receivedAt` và form gửi lại đúng giá trị đã tải (PATCH thay thế toàn bộ, thiếu là xoá). `returnDeadline` chỉ hiển thị read-only ở chi tiết thiết bị; **chưa có ô nhập** cho tới khi cả ba client cùng ship |

### FCM setup TODO

Code đã sẵn sàng nhưng chưa hoạt động khi chưa có Firebase config:

1. Tạo Firebase project, add Android app `app.warrantyvault`, tải `google-services.json` về.
2. Đặt file vào `android/app/google-services.json` (đã thêm vào `.gitignore` của bạn — đừng commit).
3. Sync Gradle. Plugin `com.google.gms.google-services` sẽ tự apply (xem điều kiện `if (hasGoogleServices)` trong `app/build.gradle.kts`).
4. Set `FCM_SERVICE_ACCOUNT_JSON` env trên backend (xem `website/src/lib/push-fanout.ts`) để cron có thể gửi push qua FCM v1 API.
5. Build + run, login → kiểm log `PushRegistrar` xem token đã POST `/api/v1/push/register` thành công chưa.

Pattern: mỗi module = 1 `ViewModel` (StateFlow) + 1 hoặc N `@Composable`. Xem `DevicesViewModel` + `DevicesScreen.kt` làm template.

## Lưu ý

- Min SDK 26 (Android 8). Adaptive icon dùng vector drawable, không cần PNG fallback.
- Cleartext HTTP cho dev (`android:usesCleartextTraffic="true"` + `BASE_URL=http://10.0.2.2:4000`). Khi deploy production, đổi sang HTTPS-only.
- Manual DI qua `App.instance` — nhỏ vừa đủ, chưa cần Hilt. Nếu app phình lên thì refactor sang Hilt sau.
- `./gradlew :app:assembleDebug` đã verify build xanh (cần `app/google-services.json` — đã có stub trong repo).
