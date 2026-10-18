-- Warrly — người dùng tự chọn số ngày nhắc trước khi hết hạn.
--
-- Vì sao có migration này
--   Cron bảo hành trước đây chỉ có đúng hai mốc cứng: 7 và 30 ngày trước
--   "Warranty"."endDate". Hai mốc đó đúng cho một chiếc điện thoại bảo hành 12
--   tháng, nhưng sai cho phần lớn thứ khác: cửa sổ đổi trả 14 ngày, bảo hành phụ
--   kiện 3 tháng, hay một thiết bị gia dụng bảo hành 10 năm. Một lịch chung không
--   thể phục vụ cả ba. "leadDays" biến lịch đó thành dữ liệu của từng đối tượng.
--
--   Trường này nằm trên CẢ "Device" và "Subscription" vì hai cron sweep khác
--   nhau đều dùng cùng một khái niệm: warranty expiry (Device → Warranty.endDate)
--   và renewal date (Subscription.renewalDate). Cùng một tên, cùng một luật.
--
-- ── Hình dạng và luật của "leadDays" ────────────────────────────────────
--
--   * `integer[] NOT NULL DEFAULT ARRAY[30, 7]`.
--   * 1..5 phần tử. Mảng rỗng là LỖI 400, không phải "không nhắc". Người muốn
--     ít nhắc hơn thì chọn ít ngày hơn — im lặng biến "không có mốc nào" thành
--     "không bao giờ nhắc" là một cách rất dễ để người dùng tưởng app đã hỏng.
--   * Mỗi phần tử 0..365.
--   * Không trùng nhau.
--   * Server sắp xếp GIẢM DẦN trước khi lưu. Thứ tự không mang nghĩa nghiệp vụ,
--     nhưng cố định nó làm payload ổn định và làm thứ tự push trong một lần chạy
--     cron có thể đoán được.
--
--   Default [30, 7] là có chủ ý: nó tái tạo ĐÚNG lịch cũ cho mọi người dùng chưa
--   bao giờ đặt leadDays, nên việc thêm cột không đổi hành vi của họ. Với
--   Subscription, lịch cũ là 3/1/0 ngày; default [30,7] là lịch MỚI do hợp đồng
--   quy định, không phải lịch cũ được bảo toàn — xem ghi chú trong báo cáo.
--
--   Không có CHECK constraint ở DB cho các luật trên. Chúng được kiểm ở
--   services (ValidateDeviceInput / validateSubscriptionInput) để trả về đúng
--   400 + `fieldErrors.leadDays`; một CHECK ở DB sẽ biến cùng một payload xấu
--   thành 500 ở lớp handler. Đây cũng là cách các luật app-level khác của repo
--   đang làm (soldAt/soldPrice, serial trùng, quota thiết bị).
--
-- ── Idempotency của cron: key cũ và key mới ─────────────────────────────
--
--   Migration 0002 đặt ra key "mỗi Reminder một lần mỗi ngày": cron chỉ gửi khi
--   chưa có Reminder row nào của warranty được stamp `lastNotifiedAt` trong ngày.
--   Với một mốc cứng 7 ngày, "mỗi warranty mỗi ngày" là đủ. Với một MẢNG mốc,
--   nó không còn đủ: cùng một warranty có thể cần một push cho mốc 30 và một push
--   khác cho mốc 7, và key cũ sẽ coi push thứ hai là trùng.
--
--   Vì vậy key mới là `(warrantyId, leadDay, ngày)` — được biểu diễn bằng cặp
--   `(Reminder.lastNotifiedAt::date, Reminder.lastNotifiedLeadDay)`. Query cron
--   chỉ bỏ qua một dòng khi CẢ ngày VÀ leadDay đã khớp; một leadDay khác trong
--   cùng ngày vẫn được phép. Cột `lastNotifiedLeadDay` để NULL cho các dòng cũ
--   (trước migration này); query coi NULL là "đã stamp theo cách cũ" nên một lần
--   chạy lại trong ngày triển khai không bắn trùng, và lần stamp kế tiếp ghi giá
--   trị thật.
--
--   Subscription dùng đúng cùng key: `(subscriptionId, leadDay, ngày)`, lưu ở
--   `(Subscription.lastNotifiedRenewalAt::date,
--   Subscription.lastNotifiedRenewalLeadDay)`. `AdvanceSubscriptionRenewal` đặt
--   lead-day marker về NULL khi đã tự gia hạn, nghĩa là "đã xử lý hôm nay" —
--   giữ nguyên hành vi cũ (một subscription không bị nhắc lại trong cùng ngày
--   sau khi gia hạn).
--
--   Không có index mới. Mọi truy vấn cron đều đi qua "Warranty"."warrantyId"
--   hoặc "Subscription".id (đã có index/PK) rồi mới xét leadDay trên vài dòng
--   ứng viên; một index riêng cho `lastNotifiedLeadDay` hay `leadDays` sẽ không
--   được planner dùng vì tập dòng đã bị lọc bởi ngày. `leadDays` tối đa 5 phần
--   tử nên unnest/ANY cũng không cần chỉ mục.
--
-- ── Vì sao dùng chung file với leadDays thay vì migration riêng ─────────
--
--   Hai cột marker chỉ tồn tại để phục vụ leadDays; tách chúng ra sẽ khiến một
--   tính năng nằm ở hai migration và dễ bị bỏ quên khi rollback. Xuống
--   (Down) xoá cả bốn cột, theo đúng thứ tự ngược.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE public."Device"
    ADD COLUMN IF NOT EXISTS "leadDays" integer[] NOT NULL DEFAULT ARRAY[30, 7];

ALTER TABLE public."Subscription"
    ADD COLUMN IF NOT EXISTS "leadDays" integer[] NOT NULL DEFAULT ARRAY[3, 1, 0];

ALTER TABLE public."Reminder"
    ADD COLUMN IF NOT EXISTS "lastNotifiedLeadDay" integer;

ALTER TABLE public."Subscription"
    ADD COLUMN IF NOT EXISTS "lastNotifiedRenewalLeadDay" integer;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE public."Subscription"
    DROP COLUMN IF EXISTS "lastNotifiedRenewalLeadDay";

ALTER TABLE public."Reminder"
    DROP COLUMN IF EXISTS "lastNotifiedLeadDay";

ALTER TABLE public."Subscription"
    DROP COLUMN IF EXISTS "leadDays";

ALTER TABLE public."Device"
    DROP COLUMN IF EXISTS "leadDays";

-- +goose StatementEnd
