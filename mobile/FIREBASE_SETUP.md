# Firebase setup — Android push (FCM)

Mày làm theo các bước này khi sẵn sàng bật Android push. iOS push (APNs) thì dùng Apple Developer Program riêng, không qua Firebase — chỉ cần làm Firebase nếu muốn ship Android.

Toàn bộ free, không cần thẻ tín dụng cho free tier.

## 1. Tạo Firebase project

1. Vào https://console.firebase.google.com → **Add project**
2. Tên project: `warranty-vault` (hoặc gì cũng được — tên chỉ để hiển thị)
3. **Disable Google Analytics** — không cần cho push, đỡ bị xin permission GDPR
4. Đợi 30s → **Continue**

## 2. Đăng ký Android app trong project

Trong Firebase console của project mới tạo:

1. Click icon **Android** (hoặc **Add app → Android**)
2. **Android package name**: `com.warrantyvault.app`
   *(Phải khớp với `applicationId` trong `android/app/build.gradle.kts` — nếu sau này đổi tên app thì update cả 2 chỗ)*
3. **App nickname**: `WarrantyVault`
4. **Debug signing certificate SHA-1**: bỏ trống cũng được, chỉ cần khi dùng Google Sign-In hoặc Dynamic Links
5. **Register app**

Sau khi register:
- Firebase show file **`google-services.json`** → tải về
- Đặt vào `android/app/google-services.json` (ngang hàng với `build.gradle.kts`)
- File này chứa project ID + sender ID, không phải secret — commit thoải mái (theo doc Firebase) nhưng nếu paranoid thì gitignore

Skip 2 bước "Add Firebase SDK" và "Verify installation" — `android/app/build.gradle.kts` đã có sẵn các dep + plugin.

## 3. Lấy server credentials cho backend (FCM v1 API)

Backend (Next.js) gửi push qua FCM HTTP v1 API → cần service-account JSON.

1. Trong Firebase console: **Project settings** (icon bánh răng cạnh tên project) → tab **Service accounts**
2. Section **Firebase Admin SDK** → **Generate new private key** → **Generate key**
3. Browser tải xuống file `<project-id>-firebase-adminsdk-xxxxx.json`

**File này LÀ secret. Đừng commit.**

Đọc nội dung file, paste vào `.env` của backend (1 dòng):

```bash
FCM_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"warranty-vault-xxxx","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"firebase-adminsdk-xxx@warranty-vault-xxxx.iam.gserviceaccount.com",...}'
```

Lưu ý:
- Bao quanh bằng dấu nháy đơn `'...'` — tránh bash interpolate `$`
- `\n` trong `private_key` **giữ nguyên là 2 ký tự `\n`**, đừng thay bằng newline thật

Verify bằng cách gọi cron với 1 sub FCM giả → xem log có FCM send error gì không. Nếu config đúng nhưng token giả → trả 404 (UNREGISTERED) — bình thường.

## 4. Cron sẵn sàng dùng

Tao đã viết sẵn `src/lib/push-fcm.ts` — đọc env, mint OAuth2 token, fan-out qua `src/lib/push-fanout.ts`. Không cần code thêm.

Khi user đầu tiên register Android push, row `PushSubscription` với `platform='fcm'` xuất hiện → cron tự động dispatch qua FCM.

## 5. (Sau này) Đổi sang prod

- Free tier FCM không giới hạn số lượng message hợp lý — không cần upgrade trừ khi mày send hàng triệu push/ngày
- Khi publish Play Store: thêm release SHA-1 vào Firebase project (giống bước 2 nhưng cho release keystore) — chỉ cần nếu dùng Google features khác như Auth/Analytics
