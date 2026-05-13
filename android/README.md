# WarrantyVault Android

Native Android app — Kotlin + Jetpack Compose + Material 3, talks to the Next.js backend (`../website`) via REST.

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
   - **Emulator**: tạo Pixel 8 / API 34 trong AVD Manager. URL backend mặc định là `http://10.0.2.2:3000` (alias loopback đến máy host).
   - **Device thật cùng Wi-Fi**: enable Developer Options + USB debugging, plug vào. Sửa `BASE_URL` trong `app/build.gradle.kts` thành IP LAN máy Mac (vd `http://192.168.1.17:3000`) rồi sync lại.
5. Bấm **Run ▶️** → app build + install → màn login hiện ra

## Chạy backend trước

```
cd ../website
npm run dev
```

Trên emulator, app gọi `http://10.0.2.2:3000` → tự đến `localhost:3000` của Mac. Trên device thật phải `npm run dev -- -H 0.0.0.0` để Next bind ra LAN.

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
| Attachments upload (PhotoPicker + DocumentPicker) | ✅ — image + PDF, multipart upload, FileProvider preview |
| Catalog autocomplete đầy đủ | ✅ — category, brand, store, warranty provider (auto-fill phone+địa chỉ); subscription brand cũng dùng catalog |
| Edit device | ✅ — `AddDeviceSheet` reuse với `existing: Device?`, mở từ `DeviceDetailScreen` action bar |
| Stats screen | ✅ — `StatsScreen.kt` tổng thiết bị / chi phí / sub tháng / wishlist, format VND vi-VN |
| Reminders screen | ✅ — `RemindersScreen.kt` list warranty sắp hết, color-coded, dismiss → `POST /api/v1/warranties/{id}/reminder` |
| Đổi mật khẩu | ✅ — `ChangePasswordSheet.kt` từ Settings, surface fieldErrors qua `Errors.kt` |

### FCM setup TODO

Code đã sẵn sàng nhưng chưa hoạt động khi chưa có Firebase config:

1. Tạo Firebase project, add Android app `com.warrantyvault.app`, tải `google-services.json` về.
2. Đặt file vào `android/app/google-services.json` (đã thêm vào `.gitignore` của bạn — đừng commit).
3. Sync Gradle. Plugin `com.google.gms.google-services` sẽ tự apply (xem điều kiện `if (hasGoogleServices)` trong `app/build.gradle.kts`).
4. Set `FCM_SERVICE_ACCOUNT_JSON` env trên backend (xem `website/src/lib/push-fanout.ts`) để cron có thể gửi push qua FCM v1 API.
5. Build + run, login → kiểm log `PushRegistrar` xem token đã POST `/api/v1/push/register` thành công chưa.

Pattern: mỗi module = 1 `ViewModel` (StateFlow) + 1 hoặc N `@Composable`. Xem `DevicesViewModel` + `DevicesScreen.kt` làm template.

## Lưu ý

- Min SDK 26 (Android 8). Adaptive icon dùng vector drawable, không cần PNG fallback.
- Cleartext HTTP cho dev (`android:usesCleartextTraffic="true"` + `BASE_URL=http://10.0.2.2:3000`). Khi deploy production, đổi sang HTTPS-only.
- Manual DI qua `App.instance` — nhỏ vừa đủ, chưa cần Hilt. Nếu app phình lên thì refactor sang Hilt sau.
- Tao chưa verify gradle build chạy được trên máy này (đĩa hết dung lượng — 99% full khi tao tạo wrapper xong). Khi mày dọn ổ rồi mở Android Studio, sync sẽ hiện error nếu có thiếu/sai gì — báo tao fix.
