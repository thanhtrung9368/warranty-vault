# Warrly Premium — Subscription Group Localization

Lỗi ASC: **“You must add at least one subscription group localization.”**
Đây là localization của **subscription group**, không phải localization của app/version.
Group ID: `22560559` · Reference name: `Warrly Premium`.

## Cách sửa (1 phút)

1. Trong group **Warrly Premium** → mục **Display Name and Description** → bấm **Create**.
2. Chọn language, nhập **Display Name** + **Description**, chọn **App Name Display** = **Use app name** (hoặc nhập app name), bấm **Save**.
3. Làm lại **Create** cho ngôn ngữ thứ hai nếu muốn.
4. Lỗi “Unable to Add for Review” biến mất. Sau đó bấm **Add for Review**.
5. Lưu ý ASC: subscription group đầu tiên phải submit cùng **app version mới** — version **1.0.0** phải có build **23** đã upload/chọn.

## English (U.S.) — modal “Add Localization”

- **Localization**: English (U.S.)
- **Subscription Group Display Name**: `Warrly Premium`
- **App Name Display Options**: **Use App Name** → `Warrly: Warranty Tracker`

Modal này **không có ô Description**; chỉ cần 3 mục trên rồi bấm **Save**.

## Tiếng Việt — bấm Create lần nữa

- **Localization**: Vietnamese
- **Subscription Group Display Name**: `Warrly Premium`
- **App Name Display Options**: **Use App Name** → `Warrly: Theo dõi bảo hành`
  (nếu “Use App Name” vẫn hiện tên tiếng Anh, chọn **Use Custom Name** và nhập
  `Warrly: Theo dõi bảo hành`)

## Sau khi lưu

- [ ] Cả 2 product `com.warrly.premium.monthly` / `.yearly` vẫn **Ready for Review**
- [ ] Group chuyển khỏi “Prepare for Submission”
- [ ] App version 1.0.0 có build 23
- [ ] Bấm **Add for Review** cho group
- [ ] Sau đó submit app version như bình thường

> Nếu ASC không cho chọn “Use app name”, nhập app name tương ứng ở ô custom.
> Display Name/Description của group chỉ hiện trong phần quản lý subscription của
> người dùng; nội dung chi tiết vẫn nằm ở paywall và App Store description.
