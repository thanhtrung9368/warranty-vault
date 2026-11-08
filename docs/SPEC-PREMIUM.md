# Warrly Premium — spec triển khai (iOS trước)

Trạng thái: **đang làm**. Chủ sản phẩm chốt 2026-11-08.

## Gói đã chốt

- **Giá:** 49.000đ/tháng · 399.000đ/năm (chọn mức gần nhất trong App Store Connect;
  app hiển thị `Product.displayPrice`, không hardcode giá).
- **Free trial:** 7 ngày, introductory offer cho người đăng ký mới.
- **Quyền lợi:** bỏ quảng cáo + nâng giới hạn.
- **Nền tảng mua:** iOS trước. Android/web mua sau; entitlement server-side dùng chung.
- **Entitlement:** server-side, xác minh JWS của StoreKit 2. Không tin client.

## Product IDs (không đổi sau khi tạo)

| Product ID | Chu kỳ | Giá |
|---|---|---|
| `com.warrly.premium.monthly` | 1 tháng | 49.000đ |
| `com.warrly.premium.yearly` | 1 năm | 399.000đ |

Subscription group reference name: `Warrly Premium`.
Cả hai nằm cùng group để Apple xử lý upgrade/downgrade.

## Giới hạn

| Tài nguyên | Free | Premium |
|---|---:|---:|
| Thiết bị chưa bán | 50 | 200 |
| Tổng thiết bị (kể cả đã bán) | 500 | 2.000 |
| Đăng ký theo dõi | 100 | 500 |
| Wishlist | 200 | 1.000 |
| File đính kèm | giữ nguyên | giữ nguyên |

Server là nơi quyết định; client chỉ hiển thị. Giới hạn free hiện có giữ nguyên
cho mọi user chưa mua.

## Backend

### Bảng `PremiumEntitlement`

Một dòng cho **mỗi transaction**, không phải mỗi user: renewal tạo transaction
mới, và giữ lịch sử để một transaction cũ không thể bị đem sang tài khoản khác.

```
transactionId          TEXT PRIMARY KEY
originalTransactionId  TEXT NOT NULL
userId                 TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE
productId              TEXT NOT NULL
expiresAt              TIMESTAMPTZ NOT NULL
revokedAt              TIMESTAMPTZ NULL
environment            TEXT NOT NULL       -- Production | Sandbox
createdAt / updatedAt  TIMESTAMPTZ NOT NULL
```

Index: `(userId, expiresAt DESC)`, `(originalTransactionId)`.
Premium = có ít nhất một dòng `revokedAt IS NULL AND expiresAt > now()`.

### Endpoint

`POST /api/v1/billing/verify` (auth bắt buộc)

```json
{ "jws": "<Transaction.jwsRepresentation>" }
```

Server:

1. Verify chữ ký JWS bằng chuỗi chứng thư trong header `x5c`, neo vào
   **Apple Root CA - G3** (embed trong repo).
2. Kiểm `bundleId == com.warrly`, `productId` thuộc allowlist,
   `type == Auto-Renewable Subscription`, có `expiresDate`.
3. Nếu `revocationDate` có → lưu `revokedAt`, trả `premium: false`.
4. Nếu `expiresDate <= now` → lưu, trả `premium: false`.
5. Nếu `transactionId`/`originalTransactionId` đã thuộc user khác → 409.
6. Upsert theo `transactionId`; trả trạng thái mới nhất của user.

Response:

```json
{
  "premium": true,
  "productId": "com.warrly.premium.monthly",
  "expiresAt": "2026-12-08T07:00:00Z",
  "environment": "Production"
}
```

`GET /api/v1/auth/me` thêm `"premium": true|false` (additive; client cũ bỏ qua).

### Xác minh JWS

- Dùng `github.com/golang-jwt/jwt/v5` (đã có trong go.mod) để verify ES256.
- Header `x5c` chứa chain; verify chain bằng `crypto/x509` với Apple Root CA G3
  embed trong `api/internal/appstore/apple_root_ca_g3.pem`.
- Không gọi App Store Server API ở v1 — không cần thêm API key.
- **Chưa có App Store Server Notifications V2**: renewal/refund được đồng bộ khi
  app mở/foreground qua `Transaction.currentEntitlements` / `Transaction.updates`.
  Server luôn kiểm `expiresAt` nên entitlement tự hết hạn; refund có thể trễ đến
  lần app mở kế tiếp. Đây là giới hạn đã biết của v1, không phải bug.

### Giới hạn

`services.Plan` = `{MaxActiveDevices, MaxTotalDevices, MaxSubscriptions, MaxWishlist}`.
`PlanFor(ctx, db, userID)` trả `FreePlan`/`PremiumPlan`; các write path
(create device, bulk, wishlist→purchased, create subscription, create wishlist)
dùng plan thay vì hằng số free.

## iOS

- `PremiumStore` (`@MainActor ObservableObject`) giữ `products`, `isPremium`,
  trạng thái mua; dùng StoreKit 2.
- `PremiumPaywallView`: lợi ích, 2 gói, trial 7 ngày, mua, **Restore Purchases**,
  Terms/Privacy, điều khoản tự động gia hạn, link quản lý subscription.
- Settings có mục `Warrly Premium`; free → `Nâng cấp`; premium → trạng thái +
  `Quản lý đăng ký`.
- `AdsController.setAdFree(premium.isPremium)` — banner biến mất khi premium.
- Đồng bộ:
  - app launch/foreground: `Transaction.currentEntitlements` → gửi JWS lên server;
  - `Transaction.updates` lắng nghe renewal/refund;
  - sau purchase/restore: verify + refresh.
- Chỉ iOS mua trong v1. Android/web hiển thị entitlement nếu API trả premium;
  chưa có nút mua.

## App Store Connect — chủ sản phẩm làm

1. **Agreements, Tax, and Banking**: Paid Applications Agreement đã bật (đã xác nhận).
2. Vào app Warrly → **Monetization → Subscriptions → Create Subscription Group**,
   reference name `Warrly Premium`.
3. Tạo 2 sản phẩm đúng ID ở trên:
   - duration 1 month / 1 year;
   - giá 49.000đ / 399.000đ (chọn price point gần nhất);
   - localization en + vi (tên + mô tả);
   - **Introductory Offer: 7 days free**, new subscribers;
   - review screenshot: paywall.
4. Cả hai sản phẩm phải ở trạng thái **Ready to Submit** và được chọn cùng app
   version khi submit.
5. Tạo **Sandbox Tester** (Users and Access → Sandbox) để test trên máy thật.

## Thứ tự triển khai

1. Migration + backend verify/entitlement/limits (đang làm).
2. iOS `PremiumStore` + paywall + Settings + ads gating.
3. Test: backend build, iOS build simulator; product thật test bằng sandbox sau
   khi mày tạo product trong ASC.
4. Build mới, App Review Notes mô tả paywall + sandbox; submit.

## Không làm trong v1

- Mua trên Android/web (chỉ đọc entitlement).
- App Store Server Notifications V2 / refund realtime.
- Family Sharing (chưa bật cho product).
- Paywall cho AI OCR (AI vẫn opt-in free).
