# AssetVault (WarrantyVault) — Đặc tả chức năng UI để redesign

> **Mục đích:** đặc tả đầy đủ mọi trang, mọi component, mọi state của web app để hand-off cho AI design re-design lại toàn bộ giao diện.
> **Đối tượng:** cá nhân (multi-user) Việt Nam, theo dõi **thiết bị + bảo hành + gói đăng ký + wishlist**.
> **Ngôn ngữ UI:** 100% Tiếng Việt, tông casual `tao/mày` ở một số chỗ (giữ nguyên khi redesign).
> **Stack hiện tại:** Next.js 16 (App Router) + React 19 + Tailwind + shadcn/ui + recharts + lucide icons. Backend Go REST. Có dark mode.

---

## 0. KIẾN TRÚC ROUTE

```
(public)/          - landing & legal, không cần đăng nhập
  /                - landing page
  /privacy
  /terms
  /cookies

(auth)/            - public auth flows
  /login
  /register
  /forgot
  /reset/[token]

(app)/             - protected, cần đăng nhập (requireUser)
  /dashboard       - tổng quan
  /devices         - list thiết bị
  /devices/new
  /devices/[id]
  /devices/[id]/edit
  /subscriptions   - list gói đăng ký
  /subscriptions/new
  /subscriptions/[id]
  /subscriptions/[id]/edit
  /wishlist        - list "đang thèm"
  /wishlist/new
  /wishlist/[id]
  /wishlist/[id]/edit
  /reminders       - nhắc bảo hành sắp hết
  /stats           - thống kê chi tiêu
  /settings        - cài đặt tài khoản
```

App shell `(app)/layout.tsx` có sidebar/topbar điều hướng tới 7 mục trên + nút avatar/đăng xuất + theme toggle.

---

## 1. LANDING PAGE `/`

Public marketing.

### Header
- Logo **AssetVault** (icon `Shield`).
- Theme toggle.
- Nếu đã đăng nhập: nút **"Vào app"** → `/dashboard`.
- Nếu chưa: link **"Đăng nhập"** + nút **"Bắt đầu miễn phí"** → `/register`.

### Hero
- Headline (có gradient): **"Đừng quên ngày hết bảo hành thiết bị của bạn"**.
- Sub: mô tả lợi ích.
- Badge: **"Miễn phí • Local-first • Tiếng Việt"**.
- CTA chính:
  - Đã login: **"Mở Dashboard"** → `/dashboard`.
  - Chưa: **"Tạo tài khoản miễn phí"** + sub link **"Đã có tài khoản → Đăng nhập"**.
- Bullet với check icon: "Không cần thẻ tín dụng", "Không quảng cáo", "Backup xuất/nhập JSON".
- Mock preview dashboard (card tĩnh có dữ liệu giả).

### 6 Feature Cards (grid)
1. **Theo dõi bảo hành** — icon `ShieldCheck`.
2. **Cảnh báo sắp hết** — icon `Bell`.
3. **Lưu hoá đơn & phiếu BH** — icon `Receipt`.
4. **Gọi & tìm trung tâm BH** — icon `Phone`.
5. **Thống kê chi tiêu** — icon `BarChart3`.
6. **Riêng tư** — icon `Lock`.

Mỗi card: title + mô tả ngắn + icon trên nền màu nhẹ.

### "3 bước để bắt đầu"
1. Đăng ký miễn phí
2. Thêm thiết bị
3. Theo dõi tự động

### CTA cuối
Heading **"Sẵn sàng quản lý thiết bị?"** + nút giống hero.

### Footer
Logo + copyright + link `Đăng nhập` / `Đăng ký`.

---

## 2. LEGAL PAGES `/privacy`, `/terms`, `/cookies`

Trang tĩnh, layout giống nhau:
- Heading: "Chính sách bảo mật" / "Điều khoản sử dụng" / "Chính sách Cookie".
- "Cập nhật: [date]".
- Nội dung prose (hiện tại là placeholder "Nội dung … sẽ được cập nhật.").

---

## 3. AUTH FLOWS

Mỗi trang là 1 card căn giữa, có icon vault/key tròn ở trên.

### `/login`
- Heading **"Chào mừng quay lại 👋"** + sub **"Đăng nhập để xem thiết bị, gói đăng ký và wishlist của bạn."**.
- Form:
  - **Email** (required, placeholder `ban@example.com`).
  - **Mật khẩu** (required, có link **"Quên mật khẩu?"** → `/forgot`).
- Submit **"Đăng nhập"** (icon `LogIn`, loading spinner).
- Footer: **"Chưa có tài khoản? Đăng ký"** → `/register`.
- Dev only: card hint hiển thị `test@local.test / test1234` (component `DevCredentialsHint`, ẩn ở production).

### `/register`
- Heading **"Tạo tài khoản miễn phí"** + sub **"Đăng ký mất 30 giây. Không thẻ tín dụng, không quảng cáo."**.
- Form:
  - **Tên hiển thị** (optional, placeholder `vd: Trung`, max 80).
  - **Email** (required).
  - **Mật khẩu** (required, min 8, placeholder `Tối thiểu 8 ký tự`).
- Submit **"Tạo tài khoản"** (icon `UserPlus`).
- Footer: **"Đã có tài khoản? Đăng nhập"** → `/login`.

### `/forgot`
- Heading **"Lỡ tay quên mật khẩu hả?"** + sub **"Nhập email tài khoản, bọn tao gửi link đặt lại trong vài giây."**.
- Icon `KeyRound` (amber tint).
- Pre-submit: input **Email** + nút **"Gửi link đặt lại"** (icon `Mail`).
- Post-submit (state.ok): box emerald với icon `CheckCircle2`, text **"Gửi link đặt lại về email của bạn rồi. Kiểm tra email, bấm link để đặt lại mật khẩu."** + nút outline **"Quay lại đăng nhập"** (icon `ArrowLeft`).
- Footer link: **"← Quay lại đăng nhập"**.

### `/reset/[token]`
- Heading **"Đặt lại mật khẩu"** + sub **"Chọn mật khẩu mới mạnh hơn nha — tối thiểu 8 ký tự."**.
- Hidden field `token`.
- Form:
  - **Mật khẩu mới** (required, min 8).
  - **Nhập lại mật khẩu mới** (required, min 8).
- Submit **"Đổi mật khẩu"**.
- Post-submit: box emerald **"Đặt lại mật khẩu thành công! Đăng nhập lại với mật khẩu mới."** + nút **"Đăng nhập ngay"**.

**Error UX cho tất cả form auth:** thông báo Vietnamese theo field (inline đỏ dưới input) hoặc message tổng ở trên cùng (alert box).

---

## 4. APP SHELL (mọi trang `(app)/`)

- Sidebar (hoặc topbar trên mobile) với navigation: Dashboard / Thiết bị / Gói đăng ký / Wishlist / Nhắc nhở / Thống kê / Cài đặt.
- Header: tên + avatar user, theme toggle, nút đăng xuất.
- Tất cả trang protected — chưa login bị redirect `/login`.

---

## 5. DASHBOARD `/dashboard`

### Greeting
- **"Chào, [tên user] 👋"** + sub **"Đây là tổng quan tình trạng bảo hành & chi phí của bạn hôm nay."**.

### 4 Stat Cards (grid 4 cột desktop / 2x2 mobile)
Mỗi card: label uppercase nhỏ + giá trị số to + sub-label + icon trên badge tròn.

| # | Label | Icon | Tint | Sub |
|---|-------|------|------|-----|
| 1 | **Tổng thiết bị** | `Package` | primary | — |
| 2 | **Còn bảo hành** | `ShieldCheck` | emerald | "Còn được bảo vệ" |
| 3 | **Sắp hết (≤30 ngày)** | `AlertTriangle` | amber | "Cần để ý nha" |
| 4 | **Đã hết bảo hành** | `ShieldX` | zinc | "Hết kèo rồi" |

### Card "Sắp hết bảo hành"
- Header: icon `AlertTriangle` + title + link **"Xem tất cả"** → `/reminders`.
- Empty: **"Tất cả đều ngon, không có gì sắp hết trong 30 ngày tới đâu."**.
- Filled: list device (mỗi dòng) — icon category, tên thiết bị, sub `loại • brand • ngày mua • giá`, badge ngày còn lại bên phải. Click → `/devices/[id]`.

### Card "Gói đăng ký" (chỉ hiện nếu có subscriptions)
Header `RefreshCw` + link **"Xem tất cả"** → `/subscriptions`.
- **Trái:** label `Mỗi tháng` + giá trị VND to + sub `[yearly] ~ / năm • [count] gói đang hoạt động`.
- **Phải:** label `Sắp gia hạn` + empty `"Không có gói nào sắp charge"` HOẶC list tối đa 4 mục: icon `RefreshCw` + ngày gia hạn + tên gói (link) + giá phải.

### Card "Đang thèm" (chỉ hiện nếu có wishlist items)
Header `Heart` (rose) + link **"Xem tất cả"** → `/wishlist`.
- **Trái:** label `Tổng tiền (giá hiện tại)` + giá trị VND + sub `[count] món đang theo dõi`.
- **Phải:** label `Sắp tới ngày mua` + empty `"Chưa có món nào đặt ngày dự kiến"` HOẶC list tối đa 3: icon `Calendar` + target date + tên (link).

### Empty state khi chưa có thiết bị nào
Component `EmptyState`:
- Title **"Chưa có thiết bị nào, bắt đầu nào"**.
- Description **"Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... để theo dõi bảo hành tự động."**.

---

## 6. DEVICES — `/devices` (list)

### Header
- Heading **"Thiết bị"** + sub **"Tổng [n] thiết bị{đã lọc}. Bấm vào từng cái để xem chi tiết."**.
- Nút **"Thêm thiết bị"** (icon `Plus`) → `/devices/new`.

### Filter Bar (sticky, query params trong URL)
- **Search** (debounce 300ms, icon `Search`, placeholder `Tìm theo tên, hãng, model, serial...`) → `q`.
- **Loại** dropdown (default `Tất cả loại`) → `category`.
- **Trạng thái** dropdown (default `Tất cả trạng thái`, options ACTIVE/INACTIVE/ARCHIVED) → `status`.
- **Sắp xếp + chiều** dropdown → `sort`, `dir`:
  - Ngày mua mới nhất / cũ nhất
  - BH sắp hết trước / lâu hết trước
  - Giá cao nhất / thấp nhất
  - Tên A-Z

### Empty state
- Có filter: **"Không có gì khớp bộ lọc"** + **"Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao."**.
- Chưa có thiết bị nào: **"Chưa có thiết bị nào, mày"** + **"Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... gì cũng được."**.

### Table (responsive — ẩn cột theo breakpoint)
| Cột | Mobile | Tablet | Desktop | Nội dung |
|------|--------|--------|---------|----------|
| Tên | ✓ | ✓ | ✓ | Icon category + tên + sub `brand • model` + badge số file đính kèm (icon `Paperclip` + số) |
| Loại | – | ✓ | ✓ | Label category |
| Giá | – | – | ✓ | VND |
| Ngày mua | – | ✓ | ✓ | Định dạng VN |
| Bảo hành | ✓ | ✓ | ✓ | `WarrantyPill` (badge có màu theo số ngày còn) hoặc "Không có" |
| Trạng thái | – | ✓ | ✓ | Badge màu |

Row hover đổi nền, click → `/devices/[id]`. Card rounded-2xl, shadow nhẹ.

---

## 7. ADD / EDIT DEVICE

### `/devices/new`
- Back **"← Danh sách thiết bị"** (hoặc `← Quay lại wishlist` nếu vào từ wishlist với query `?fromWishlist=...`).
- Heading **"Thêm thiết bị"** + sub **"Nhập thông tin thiết bị, bảo hành và mua hàng."**.
- Banner rose (nếu fromWishlist): icon `Heart` + **"Tạo từ wishlist: [item.name]"**.
- Form (xem dưới).

### `/devices/[id]/edit`
- Back **"← Quay lại chi tiết"**.
- Heading **"Sửa thiết bị"** + sub `[device.name]`.
- Form prefilled.

### Device Form (chia section)
**Thông tin chung:**
- **Tên thiết bị** (required, `e.g., MacBook Pro M3`).
- **Loại thiết bị** (required, combobox autocomplete từ catalog).
- **Hãng** (optional combobox).
- **Model** (optional, `e.g., 16-inch`).
- **Serial / IMEI** (optional, `e.g., ABC123XYZ789`).

**Mua hàng:**
- **Ngày mua** (required, date).
- **Giá mua** (required, money input VND, suffix `₫`).
- **Nơi mua** (optional combobox).

**Bảo hành mặc định:**
- **Số tháng bảo hành** (required, number, default 12).
- **Nhà cung cấp** (optional combobox).
- **Địa chỉ trung tâm BH** (optional, `Quận 1, TP.HCM`).
- **SĐT trung tâm BH** (optional tel, `0912345678`).

**Khác:**
- **Trạng thái** (chỉ ở Edit, select ACTIVE/INACTIVE/ARCHIVED).
- **Ghi chú** (textarea optional).

**Actions:** **"Lưu thiết bị"** (icon `Save`, loading) + **"Đặt lại"** (icon `RotateCcw`).

Validation: error đỏ inline dưới field + auto focus/scroll tới field lỗi + toast.

---

## 8. DEVICE DETAIL `/devices/[id]`

### Header
- Back **"← Danh sách thiết bị"**.
- Icon thiết bị to + tên (h1) + badge status + sub `loại • brand • model`.
- Action buttons: **"Sửa"** (outline) / **"Xoá"** (destructive, confirm dialog).

### Card "Mua hàng"
InfoRow grid:
- `Calendar` → Ngày mua
- `Wallet` → Giá mua (VND)
- `Store` → Nơi mua
- `Hash` → Serial / IMEI
- `Tag` → Loại

### Card "Tổng quan bảo hành"
- Title + icon `ShieldCheck`.
- Có warranty: **"Có [n] gói bảo hành. Gói xa nhất hết [date]."** + sub **"Quản lý chi tiết từng gói ở mục bên dưới."** + `WarrantyPill` góc phải.
- Không có: **"Thiết bị chưa có gói bảo hành nào."**.

### Card "Gói bảo hành ([n]/5)"
Danh sách các `WarrantyCard` (tối đa 5):

**Mỗi card warranty hiển thị:**
- Header: badge type warranty (`STANDARD | EXTENDED | THIRD_PARTY` v.v.) + provider name + `WarrantyPill` + nút bút sửa + nút thùng rác xoá.
- Visual timeline: `WarrantyTimeline` từ ngày mua → ngày hết BH.
- Sub-text: **"[months] tháng • [start] → [end]"**.
- Grid info:
  - `Wallet` → Giá gói
  - `Phone` → SĐT (clickable `tel:`)
  - `MapPin` → Địa chỉ (clickable Google Maps)
  - `StickyNote` → Ghi chú (spans 2 cols)

**Edit inline:** click bút sửa → card biến thành form `Sửa gói bảo hành`.

**Add inline:** ở dưới cùng nếu < 5 warranty: form `Thêm gói bảo hành`.

**WarrantyForm fields:**
- Loại (required select), Nhà cung cấp (optional), Ngày bắt đầu (required date, auto fill từ purchaseDate), Số tháng (required), Giá gói (money), Địa chỉ, SĐT, Ghi chú.
- Actions: **"Lưu gói bảo hành"** / **"Huỷ"**.

### Card "Ghi chú" (nếu có)
Whitespace-preserve text.

### Card "File đính kèm ([n]/5)"
- `AttachmentGallery`: grid thumbnail (ảnh) hoặc icon PDF, mỗi item có nút xoá + tải xuống.
- `AttachmentUploader`:
  - Drop zone rounded dashed: **"Kéo thả hoặc bấm để chọn file"** + sub **"Ảnh hoặc PDF, tối đa 5MB. Còn lại: [n] file."**.
  - Đổi nền primary khi drag over.
  - Validation: max 5MB, chỉ ảnh / PDF, toast lỗi:
    - **"[file] vượt quá 5MB"**.
    - **"[file]: chỉ chấp nhận ảnh hoặc PDF"**.
  - Sau khi chọn: list file + nút X mỗi file + input **"Mô tả chung (vd: Hóa đơn VAT, Phiếu bảo hành)"** + nút **"Tải lên [n] file"** (icon `Upload`).
  - Nếu đã đủ 5 file: **"Đã đạt tối đa 5 file cho thiết bị này. Xóa file cũ để tải file mới."**.

---

## 9. SUBSCRIPTIONS — `/subscriptions` (list)

### Header
- Heading **"Gói đăng ký"** + sub **"Hiển thị [n] gói{đã lọc}. Theo dõi chi phí định kỳ — biết tiền chảy đi đâu mỗi tháng."**.
- Nút **"Thêm gói"** → `/subscriptions/new`.

### Summary Cards (3 cột, chỉ hiện khi có ít nhất 1 active)
1. **Mỗi tháng** — VND + sub `[yearly] ~ / năm`.
2. **Đang hoạt động** — count + sub `gói đang chạy`.
3. **Sắp gia hạn** — list tối đa 3 (link tên + ngày, màu đỏ nếu quá hạn).

### Filter Bar
- **Search** (debounce 300ms, `Tìm tên, hãng, plan...`) → `q`.
- **Trạng thái** (default `Đang dùng + tạm dừng`, có `Tất cả trạng thái` + ACTIVE/PAUSED/CANCELLED/EXPIRED) → `status`.
- **Chu kỳ** (default `Tất cả chu kỳ`, options MONTHLY / YEARLY / QUARTERLY / WEEKLY / CUSTOM / LIFETIME) → `billingCycle`.
- **Loại** (default `Tất cả loại`) → `category`.
- **Sắp xếp**: Sắp gia hạn trước / Lâu gia hạn nhất / Tốn nhiều/tháng / Ít nhất/tháng / Giá cao / Mới thêm / Tên A-Z.

### Empty state
Icon `RefreshCw` (sky).
- Có filter: **"Không có gì khớp bộ lọc"** + giống devices.
- Chưa có gì: **"Chưa có gói đăng ký nào"** + **"Note lại các gói phần mềm/dịch vụ — Apple One, ChatGPT, Spotify, hosting..."** + CTA **"Thêm gói đầu tiên"**.

### Table
| Cột | Nội dung |
|------|----------|
| Gói | icon category + tên + sub `brand • category` + icon link nếu có `cancelUrl` |
| Plan | tên plan hoặc — |
| Giá / chu kỳ | VND + label chu kỳ nhỏ |
| ~ /tháng | VND quy đổi hoặc — |
| Gia hạn | label ngày + icon `RefreshCw` hoặc `AlertTriangle` (đỏ) nếu quá hạn |
| Trạng thái | badge màu |

Click row → `/subscriptions/[id]`.

---

## 10. ADD / EDIT SUBSCRIPTION

### `/subscriptions/new`
- Back **"← Đăng ký"** (hoặc `← Quay lại wishlist` từ wishlist).
- Heading **"Thêm gói đăng ký"** + sub **"Apple One, ChatGPT Plus, hosting, domain, streaming..."**.
- Banner from-wishlist như device.

### `/subscriptions/[id]/edit`
- Back **"← Quay lại chi tiết"**.
- Heading **"Sửa gói"** + sub `[name]`.

### Subscription Form (sections)
**Thông tin gói:** Tên (req), Loại, Hãng, Plan.

**Chu kỳ & giá:** Chu kỳ thanh toán (req select MONTHLY/YEARLY/QUARTERLY/WEEKLY/CUSTOM/LIFETIME), Số ngày/kỳ (chỉ hiện nếu CUSTOM), Giá (req, VND), Ngày bắt đầu (req date), Ngày gia hạn tới (req date, auto theo cycle), checkbox Tự gia hạn.

**Trạng thái (edit only):** ACTIVE / PAUSED / CANCELLED / EXPIRED.

**Tài khoản:** Email tài khoản, Phương thức thanh toán, URL quản lý, URL huỷ.

**Khác:** Ghi chú.

Actions: **"Lưu gói"** + **"Đặt lại"**.

---

## 11. SUBSCRIPTION DETAIL `/subscriptions/[id]`

### Header
- Back **"← Đăng ký"**.
- Icon + tên (h1) + status badge + sub `brand • plan • category`.
- Actions: **"Sửa"** / **"Log payment"** (dialog) / **"Renew Now"** (nếu không phải LIFETIME) / **"Xoá"** (destructive).

### Overdue Alert (nếu quá hạn)
Box amber + `AlertTriangle` + **"Đã quá hạn [n] ngày — cron sẽ tự log payment kỳ này."**.

### 4 Key Metric Cards
1. **Giá / chu kỳ** — VND + label cycle (+ số ngày nếu CUSTOM).
2. **Quy đổi mỗi tháng** — VND hoặc —.
3. **Gia hạn tới** — icon `Calendar` + ngày (hoặc `Lifetime`) + sub `[n] ngày nữa` (đỏ nếu quá hạn).
4. **Đã chi tổng cộng** — VND + sub `[n] kỳ`.

### External Links
- **"Quản lý gói"** (outline + `ExternalLink`) nếu có manageUrl.
- **"Huỷ gói"** (outline + `ExternalLink`, text rose) nếu có cancelUrl.

### Account info (inline, nếu có)
- `Mail` + accountEmail.
- `CreditCard` + paymentMethod.
- `RefreshCw` + "Tự gia hạn" / "Không tự gia hạn".

### Card "Lịch sử thanh toán"
- Title + badge count.
- `PriceHistoryChart` (recharts line chart) hiển thị payment amounts theo thời gian.
- List 12 payments gần nhất: ngày (tooltip full) + relative time (`2 ngày trước`) + note + số tiền VND bold.

### Card "Ghi chú" (nếu có).

### Card "Đổi trạng thái nhanh"
Button group: ACTIVE / PAUSED / CANCELLED — highlight current.

### Dialog "Log một lần thanh toán"
- Field **Số tiền** (req money, default = price).
- Field **Ngày trả** (req date, default today).
- Field **Ghi chú** (optional, `vd: Thanh toán tháng 1/2024`).
- Actions: **"Log"** + Cancel.

---

## 12. WISHLIST — `/wishlist` (list)

### Header
- Heading **"Đang thèm"** + sub **"Hiển thị [n] món{đã lọc}. Note lại đồ mày đang để mắt — đợi sale là nhào vô."**.
- Nút **"Thêm món"** → `/wishlist/new`.

### Summary Cards (3 cột)
1. **Đang theo dõi** — count + sub `món trong list` (rose tint).
2. **Tổng tiền** — VND + sub `theo giá hiện tại` (violet tint).
3. **Sắp tới** — list tối đa 3 (amber tint).

### Filter Bar
- **Search** → `q`.
- **Trạng thái** (default `Đang theo dõi + quyết mua`, options WATCHING/DECIDED/PURCHASED/SUBSCRIBED/REFUNDED/REJECTED) → `status`.
- **Mức** (priority): CRITICAL / HIGH / MEDIUM / LOW → `priority`.
- **Loại** → `category`.
- **Sắp xếp**: Mức độ thèm cao trước / Target gần nhất / Target xa nhất / Mới thêm / Giá cao / Giá thấp.

### Empty state
Icon `Heart` (rose).
- Có filter: như trên.
- Chưa có: **"Wishlist trống — thêm cái mày thèm đi"** + **"Note lại những món mày đang để mắt — giá, link, deadline..."** + CTA **"Thêm món đầu tiên"**.

### Table
| Cột | Nội dung |
|------|----------|
| # | row index |
| Sản phẩm | icon category + tên + sub `brand • category` + icon link nếu có buyUrl |
| Giá ban đầu | VND hoặc — |
| Giá hiện tại | VND hoặc — |
| Δ | % chênh lệch với mũi tên (xanh = giảm, đỏ = tăng) hoặc — |
| Target | ngày dự kiến mua hoặc — |
| Mức | badge priority |
| Trạng thái | badge status |

Click → `/wishlist/[id]`.

---

## 13. ADD / EDIT WISHLIST

### `/wishlist/new`
- Back **"← Wishlist"**.
- Heading **"Thêm món đang thèm"** + sub **"Note lại sản phẩm đang để ý — giá, link, ngày dự kiến mua, lý do."**.

### `/wishlist/[id]/edit`
- Back **"← Quay lại chi tiết"** + heading **"Sửa món thèm"** + sub `[name]`.

### Wishlist Form
- Tên (req), Loại, Hãng.
- Giá ban đầu (money), Giá hiện tại (money).
- URL mua, URL ảnh.
- Ngày dự kiến mua (target date).
- Mức (priority, req select CRITICAL/HIGH/MEDIUM/LOW, default MEDIUM).
- Trạng thái (edit only: WATCHING/DECIDED/PURCHASED/SUBSCRIBED/REFUNDED/REJECTED).
- Chu kỳ nhắc lại (số ngày).
- Ghi chú.

Actions: **"Lưu món"** (icon `Save`).

---

## 14. WISHLIST DETAIL `/wishlist/[id]`

### Header
- Back **"← Wishlist"**.
- Icon + tên (h1) + status badge + priority badge + sub `brand • category`.
- Actions: **"Sửa"** / **"Cập nhật giá"** (dialog) / **"Đánh dấu đã mua"** / **"Đánh dấu đã subscribe"** / **"Xoá"** (destructive).

### Link "Đã mua" (nếu purchasedDeviceId)
Box muted + icon `ShoppingBag` + **"Đã mua → [device name]"** (link).

### 4 Metric Cards
1. **Giá ban đầu** — VND hoặc —.
2. **Giá hiện tại** — VND + % delta (mũi tên xanh/đỏ) + sub last updated relative.
3. **Min / Max đã ghi** — `min / max` VND.
4. **Ngày dự kiến mua** — icon `Calendar` + ngày hoặc **"Chưa đặt"**.

### External Links
**"Mở link mua"** (icon `ExternalLink`) nếu có buyUrl.

### Inline (nếu có)
Icon `Bell` + **"Nhắc lại mỗi [n] ngày"**.

### Image (nếu có imageUrl)
Ảnh responsive, max-h 480px, centered, `referrerPolicy=no-referrer`.

### Card "Lịch sử giá"
- Title + badge count.
- `PriceHistoryChart` (line chart).
- List 8 price points gần nhất: ngày + note + VND bold.

### Card "Ghi chú" (nếu có).

### Card "Đổi trạng thái nhanh"
Button group cho mọi status.

### Dialog "Cập nhật giá hiện tại"
- **Giá** (req money, default = currentPrice).
- **Ghi chú** (optional, `vd: deal Black Friday, ưu đãi student...`).
- Actions: **"Lưu"** + Cancel.

---

## 15. REMINDERS `/reminders`

### Header
**"Nhắc nhở"** + sub **"Gói bảo hành sắp hết hoặc vừa hết. Bấm 'Đã xem, ẩn đi' để bỏ qua từng gói."**.

### Empty state
Icon `Bell` (emerald) + **"Không có nhắc nhở nào, ngon!"** + **"Tất cả gói bảo hành đều an toàn. Mày khỏi lo gì hết."**.

### 3 sections (theo thời gian sắp hết)
1. **"Sắp hết trong 30 ngày"** — text đỏ.
2. **"Sắp hết trong 60 ngày"** — text amber.
3. **"Sắp hết trong 90 ngày"** — text emerald.

Mỗi section là card với icon `Bell` + tiêu đề + badge count. Trong card là list divided:
- Mỗi row: icon device + icon category (badge) + tên thiết bị + badge type warranty + sub `category • provider • Hết [date]` + `WarrantyPill` bên phải + nút **"Đã xem, ẩn đi"** (`DismissButton`).
- Click row → `/devices/[id]`.

DismissButton: optimistic remove khỏi list, đánh dấu warranty là dismissed.

---

## 16. STATS `/stats`

### Empty state (chưa có device)
Heading + sub **"Chưa có gì để thống kê đâu — thêm thiết bị xong quay lại nhé."** + `EmptyState` (icon `BarChart3`, violet).

### Có data:

**Header:** **"Thống kê"** + sub **"Tổng quan chi phí mua sắm và giá trị tài sản còn bảo hành."**.

### 3 Summary Cards
1. **Tổng chi [year]** — VND + sub `[n] thiết bị` + icon `TrendingUp` (amber).
2. **Tài sản còn bảo hành** — VND + sub `[n] thiết bị` + icon `ShieldCheck` (emerald).
3. **Tổng số thiết bị** — count + sub `đang theo dõi` + icon `BarChart3` (primary).

### Charts Grid (2 cột)
**Trái — "Chi phí 12 tháng gần nhất"** — `MonthlyBar` (recharts bar chart): X = `MM/yy`, Y = số tiền.

**Phải — "Phân bổ theo loại"** — `CategoryPie` (recharts pie): theo category.

### Year Analysis (2 cột)
**Trái — "Tổng chi theo năm"** + `YearPicker` dropdown phải.
- Giá trị tổng VND + sub `([n] thiết bị mua trong [year])`.
- Grid categories sorted desc: icon + label + VND.

**Phải — "Top 5 thiết bị đắt nhất"** + icon `Trophy`.
- Numbered list (gold/silver/bronze 1-3, rồi 4-5):
  - Icon category + tên + sub `category • brand • ngày mua` + giá VND.
- Click → `/devices/[id]`.
- Empty: **"Chưa có dữ liệu."**.

---

## 17. SETTINGS `/settings`

### Header
**"Cài đặt"** + sub **"[user.email] · Quản lý tài khoản và dữ liệu cá nhân."**.

### Card "Thông báo" (icon `Bell`, primary)
**PushSettings:**
- **Browser không hỗ trợ:** amber alert **"Trình duyệt này chưa hỗ trợ push notification. Thử Chrome, Edge, Firefox hoặc Safari phiên bản mới."**.
- **User chặn:** red alert **"Bạn đã chặn thông báo từ site này. Mở cài đặt trình duyệt → quyền thông báo → cho phép rồi tải lại trang."**.
- **Subscribed:** box emerald **"✓ Thiết bị này đã bật thông báo"** + nút **"Gửi thử"** (`Send`) + nút **"Tắt"** (`BellOff`).
- **Unsubscribed:** nút **"Bật thông báo"** (`Bell`).
- Description: **"Nhận thông báo khi thiết bị sắp hết bảo hành, ngay cả khi không mở web."**.

### Card "Đổi mật khẩu" (icon `Lock`, primary)
- **Mật khẩu hiện tại** (req).
- **Mật khẩu mới** (req, min 8).
- **Nhập lại mật khẩu mới** (req, min 8).
- Submit **"Đổi mật khẩu"** (icon `KeyRound`).
- Success box emerald (dismissible).
- Form auto reset.

### Card "Sao lưu & khôi phục" (icon `Database`, primary)

**Xuất dữ liệu:**
- Description **"Tải toàn bộ thiết bị, file đính kèm (tên/đường dẫn) và nhắc nhở ra 1 file JSON. File ảnh thật vẫn nằm trong thư mục `public/uploads`."**.
- Amber alert: **"File backup chứa dữ liệu nhạy cảm: số seri, địa chỉ & SĐT trung tâm bảo hành, giá mua. Lưu ở nơi an toàn — nếu upload cloud thì nên đặt mật khẩu zip trước."**.
- Nút **"Xuất JSON"** (icon `Download`) → file `assetvault-backup-YYYYMMDD-HHmm.json`.
- Toast **"Đã xuất [n] thiết bị"**.

**Nhập dữ liệu:**
- Mode selector:
  - **Merge** (default) — gộp.
  - **Replace** — XOÁ TOÀN BỘ + load backup (cảnh báo đỏ).
- File picker **"Chọn file JSON..."** (accept `.json`).
- Nút **"Nhập"** (icon `Upload`).
- Toast **"Import thành công"**.

### Card "Xoá tài khoản" (destructive border, icon `Trash2` đỏ)

**Initial state:**
- Description: **"Xoá tài khoản sẽ xoá toàn bộ thiết bị, hoá đơn, ảnh BH và cài đặt push. Không thể hoàn tác."**.
- Nút outline đỏ **"Tao muốn xoá tài khoản"**.

**Confirmation state:**
- Red alert + icon `AlertTriangle` + **"Sau khi bấm xoá, toàn bộ dữ liệu của mày bị xoá vĩnh viễn. Tao khuyên mày xuất backup JSON trước."**.
- Field **Mật khẩu hiện tại** (req).
- Field **"Gõ `XOA TAI KHOAN` để xác nhận"** (req, phải khớp chính xác).
- Nút **"Xoá vĩnh viễn tài khoản"** (destructive) + **"Huỷ"**.

### Card "Về AssetVault" (icon `Info`, muted)
Description + tech stack credit: "Next.js 16, React 19, Go backend, Tailwind, shadcn/ui, recharts."

---

## 18. COMMON UX PATTERNS (dùng xuyên suốt)

### Empty States — component `EmptyState`
Props: `icon` (lucide), `tone` (emerald/sky/rose/violet/amber/zinc), `title`, `description`, `ctaLabel` & `ctaHref` (optional).

### Loading
- Button: `Loader2` spinning + disabled.
- Form pending: submit disabled, spinner thay icon.
- Page-level: skeleton card / shimmer.

### Error / Success
- Field error: `text-xs text-destructive` dưới input.
- Form-level error: box rounded `bg-destructive/10 border-destructive/30`.
- Success box: `bg-emerald-50` + icon `CheckCircle2`.
- Toast: sonner (xanh / đỏ / vàng).

### Money Input
Format `formatNumber` realtime, suffix `₫`. Validate `> 0`.

### Date Input
HTML `<input type="date">` (`yyyy-MM-dd`). Hiển thị locale-aware ở list/detail.

### Combobox Autocomplete
shadcn Combobox, search-as-you-type, cho phép custom value.

### Search + Filter URL
Tất cả filter ghi vào query string. Default value → xoá khỏi URL.

### Confirmation
- Destructive nhỏ: native `confirm()` hoặc modal đơn giản.
- Destructive lớn (xoá account): full form xác nhận với mật khẩu + phrase.

### Badges & Pills
- **WarrantyPill**: badge tròn màu theo số ngày còn (xanh > vàng > đỏ).
- Status badges: ACTIVE (xanh), PAUSED (vàng), CANCELLED (đỏ), v.v.
- Priority badges: CRITICAL (đỏ), HIGH (cam), MEDIUM (vàng), LOW (xám).
- Warranty type badges: STANDARD, EXTENDED, THIRD_PARTY.

### Tables Responsive
- Mobile: ẩn cột phụ, giữ tên + 1-2 cột chính.
- Hover row: đổi nền `accent/50`, cursor pointer.

### Modals (Dialog)
shadcn Dialog, centered, ESC để đóng, click outside để đóng.

### Charts
recharts: bar, pie, line. Tooltip Vietnamese, hover highlight.

---

## 19. THEME & VISUAL TOKENS HIỆN TẠI

- **Dark mode** sẵn (`ThemeToggle` ở topbar + landing header).
- Palette tints: `primary`, `emerald`, `amber`, `rose`, `violet`, `sky`, `zinc`, `destructive`.
- Border radius: chủ yếu `rounded-2xl` cho card, `rounded-md` cho input/button.
- Shadow: `shadow-sm` cho card, transition khi hover.
- Icon library: **lucide-react** xuyên suốt.
- Typography: prose / sans default Tailwind, không có font đặc biệt.

→ Khi redesign, giữ palette token name (primary/destructive/emerald…) để code logic không phải sửa, nhưng hex value có thể đổi tuỳ ý.

---

## 20. YÊU CẦU REDESIGN (gợi ý cho AI design)

1. **Giữ nguyên 100% Vietnamese copy** (kể cả tone `tao/mày` ở một số chỗ — đặc trưng app).
2. **Giữ nguyên cấu trúc route + tên field form** — backend Go contract, không đổi.
3. **Mobile-first**, tất cả table phải có behavior responsive (ẩn cột / chuyển card layout).
4. **Dark mode bắt buộc**.
5. **Visual nhấn vào "trạng thái thời gian"** — số ngày còn lại của bảo hành là thông tin quan trọng nhất, cần làm nổi bật bằng màu/animation/progress.
6. **Empty states phải có cá tính** — đây là app cá nhân, tông casual, không "enterprise".
7. **Form dài (device, subscription) cần chia section rõ + visual progress** — đừng để 20 field trên 1 cột thẳng đứng.
8. **Detail page** nên có hierarchy: header → metrics → content → actions secondary cuối — không trộn lung tung.
9. **Chart** trên trang Stats cần đẹp + có tooltip rõ ràng — đây là điểm "show off".
10. **Icon system**: vẫn dùng lucide nhưng có thể đề xuất minor illustration cho empty states + landing.
