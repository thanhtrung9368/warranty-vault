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
-- migration 0029 (additive, App Store lifecycle - §6.4 Phase 0)
gracePeriodExpiresAt   TIMESTAMPTZ NULL
inBillingRetryPeriod   BOOLEAN NOT NULL DEFAULT false
autoRenewStatus        TEXT NULL
expirationIntent       INTEGER NULL
revocationReason       INTEGER NULL
lastEventType          TEXT NULL
lastEventAt            TIMESTAMPTZ NULL
createdAt / updatedAt  TIMESTAMPTZ NOT NULL
```

Index: `(userId, expiresAt DESC)`, `(originalTransactionId)`.
Premium = có ít nhất một dòng còn hiệu lực, predicate **grace-aware** (migration
0029):

```
revokedAt IS NULL
AND (expiresAt > now() OR (gracePeriodExpiresAt IS NOT NULL AND gracePeriodExpiresAt > now()))
```

Row của 0027 có `gracePeriodExpiresAt IS NULL` nên hành xử y như trước. Refund
(`revokedAt`) thắng cả hai mốc thời gian. So sánh dùng `now() AT TIME ZONE 'UTC'`
của database, không cache, không dùng đồng hồ Go.

`EntitlementEvent` (append-only) và `PremiumNotice` cũng được tạo trong 0029 để
ASN V2/email sau này không phải thêm migration thứ hai; Phase 0 chưa ghi hai bảng
này.

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
Trong **Billing Grace Period**, `premium` vẫn là `true`: Apple còn coi subscription
là đang hoạt động, nên khoảng thời gian grace không được làm mất quyền lợi.

### `GET /api/v1/billing/status` (Phase 0)

Trả trạng thái vòng đời + mức sử dụng so với giới hạn đang áp dụng, để client
hiển thị banner thay vì suy đoán từ boolean của `/auth/me`:

```json
{
  "state": "GRACE_PERIOD",
  "usage": { "devicesActive": 61, "devicesTotal": 61, "subscriptions": 3, "wishlist": 10 },
  "limits": { "devicesActive": 200, "devicesTotal": 2000, "subscriptions": 500, "wishlist": 1000 },
  "overCap": false,
  "addsBlocked": false,
  "canExport": true
}
```

`state` ∈ `NEVER | PREMIUM | GRACE_PERIOD | REVOKED | BILLING_RETRY | EXPIRED`.
`NEVER` chỉ xảy ra khi không có dòng entitlement nào; `REVOKED` thắng
`BILLING_RETRY` nếu entitlement mới nhất vừa bị thu hồi vừa ở trạng thái retry.
`GRACE_PERIOD` vẫn dùng giới hạn Premium.
`overCap` = usage đã **vượt** một giới hạn; `addsBlocked` = một lần thêm mới sẽ
bị từ chối **ngay bây giờ** (đúng cả khi usage **bằng** giới hạn). `canExport`
luôn `true` — mất Premium không bao giờ chặn export.

Câu 409 khi một tài khoản **từng** Premium (nay `EXPIRED`/`REVOKED`/
`BILLING_RETRY`) vượt trần miễn phí cũng đổi theo: nói Premium không còn hiệu
lực, nêu giới hạn miễn phí đang áp dụng, và nhắc dữ liệu cũ vẫn đọc/sửa/xuất
được. Tài khoản **chưa từng** mua Premium giữ nguyên câu cũ từng byte.

### Xác minh JWS

- Dùng `github.com/golang-jwt/jwt/v5` (đã có trong go.mod) để verify ES256.
- Header `x5c` chứa chain; verify chain bằng `crypto/x509` với Apple Root CA G3
  embed trong `api/internal/appstore/apple_root_ca_g3.pem`.
- Không gọi App Store Server API ở v1 — không cần thêm API key.
- **Chưa có App Store Server Notifications V2**: renewal/refund/grace được đồng bộ
  khi app mở/foreground qua `Transaction.currentEntitlements` /
  `Transaction.updates`. Server luôn kiểm predicate grace-aware nên entitlement
  tự hết hạn (hoặc tự vào grace nếu `gracePeriodExpiresAt` đã được ghi); refund
  có thể trễ đến lần app mở kế tiếp. Phase 0 của §6.4 mới thêm schema + predicate
  + `GET /billing/status`; ASN V2 (endpoint notification, ledger replay) vẫn là
  việc của phase sau. Đây là giới hạn đã biết, không phải bug.

### Giới hạn

`services.Plan` = `{MaxActiveDevices, MaxTotalDevices, MaxSubscriptions, MaxWishlist, Premium, Lapsed}`.
`PlanFor(ctx, db, userID)` trả `FreePlan`/`PremiumPlan`; các write path
(create device, bulk, wishlist→purchased, create subscription, create wishlist,
backup import) dùng plan thay vì hằng số free. `Lapsed` **không** đổi con số —
tài khoản từng Premium vẫn ở `FreePlan` khi hết hạn — nó chỉ chọn câu từ chối
đúng sự thật (xem §6.4 Phase 0 ở trên).

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
