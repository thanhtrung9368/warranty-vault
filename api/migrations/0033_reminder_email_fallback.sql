-- Warrly — nhắc hạn qua email khi push chết im lặng (FEATURE_RESEARCH_2026-11 §5 #8).
--
-- ── Vì sao có migration này ─────────────────────────────────────────────────
--
-- Push là kênh DUY NHẤT báo "sắp hết hạn" cho tới bản này. Nó im lặng chết vì
-- nhiều lý do không ai thấy: APNs trả 410 (token chết sau khi cài lại máy), FCM
-- vô hiệu hoá token, web push hết hạn subscription, hoặc đơn giản là người dùng
-- chưa từng bật thông báo (batch 56% người dùng iOS không opt in). Cron vẫn chạy,
-- log vẫn ghi "pushes_failed = 1", và người dùng không bao giờ biết hạn đã tới.
--
-- Migration này thêm ba thứ, tất cả đều ADDITIVE:
--
--   1. "User"."reminderEmailFallback" — opt-in, mặc định FALSE. Đây là lựa chọn
--      rõ ràng của người dùng, không phải hành vi mặc định: email transactional
--      chỉ gửi khi người dùng đã bật, và địa chỉ nhận là email tài khoản.
--   2. Sức khoẻ giao push trên "PushSubscription": lần lỗi cuối, số lần lỗi, nội
--      dung lỗi cuối. Trước đây lỗi chỉ tồn tại trong một dòng log; giờ nó là dữ
--      liệu đọc được để biết một subscription có còn sống hay không.
--   3. Bảng "ReminderEmailNotice" — khoá chống gửi trùng, xem dưới.
--
-- ── "reminderEmailFallback" là gì và KHÔNG là gì ──────────────────────────
--
--   * KHÔNG phải marketing opt-in. Chỉ email giao dịch cho đúng deadline người
--     dùng tự tạo trong ứng dụng (bảo hành, ngày mua wishlist, gia hạn gói).
--   * KHÔNG phải "gửi mọi nhắc nhở mỗi ngày". Chỉ gửi khi push không tới được
--     ai (không có PushSubscription nào, hoặc mọi lần gửi đều lỗi) và chỉ MỘT
--     lần cho mỗi (kind, entity+deadline, leadDay) — xem bảng bên dưới.
--   * KHÔNG có UI riêng trong migration này; bật/tắt đi qua PATCH /auth/me.
--
-- Default FALSE là có chủ ý. Bật email cho toàn bộ tài khoản hiện có sẽ biến một
-- tính năng cứu hộ thành spam gửi tới những người chưa từng đồng ý.
--
-- ── "ReminderEmailNotice": khoá gửi-một-lần ───────────────────────────────
--
-- UNIQUE ("userId", kind, "entityId", "leadDay") là toàn bộ cơ chế. Cron CHIẾM
-- dòng trước (INSERT ... ON CONFLICT DO NOTHING RETURNING id), gửi mail, và nếu
-- nhà cung cấp email lỗi thì XOÁ dòng đó để không đánh dấu "đã gửi" một mail
-- chưa gửi, và để lượt cron còn chọn lại notice đó (chạy chồng, hoặc chết trước
-- khi kịp stamp push) có thể thử lại. Thứ tự "chiếm trước, gửi sau" là thứ bảo
-- đảm at-most-once khi hai lượt cron chồng nhau; gửi trước rồi mới ghi sẽ cho
-- phép hai lần gửi nếu tiến trình chết giữa hai bước. Đánh đổi được nêu rõ:
-- "sentAt" là thời điểm ĐẶT CHỖ, không phải thời điểm Resend xác nhận, và một
-- lần gửi thất bại sẽ xoá đặt chỗ.
--
--   kind     — "warranty" | "wishlist_target" | "wishlist_checkin" |
--              "subscription_renewal". Text tự do, KHÔNG có CHECK: thêm một loại
--              nhắc mới không nên cần migration thứ hai, và kind chỉ dùng nội bộ.
--   entityId — id của Warranty / WishlistItem / Subscription tương ứng, hoặc
--              "<id>@<YYYY-MM-DD>" (ngày deadline) cho ba loại có hạn. Phần ngày
--              là bắt buộc: một Subscription gia hạn lại mỗi chu kỳ và cùng một
--              (subscription, mốc 3 ngày) quay lại vào tháng sau — nếu khoá chỉ
--              có id thì email chu kỳ đầu sẽ chặn mọi chu kỳ sau, đúng cái lỗi
--              tính năng này sinh ra để tránh. Người dùng dời ngày mua wishlist
--              hay ngày hết hạn bảo hành cũng là một deadline MỚI, cần khoá mới.
--              Cùng lý do "PremiumNotice" dùng (userId, periodEnd, kind) chứ
--              không phải (userId, kind). Không có FK vì ba bảng đích khác nhau;
--              dòng này là log gửi, không phải dữ liệu nghiệp vụ, và user
--              cascade đã dọn theo "userId".
--   leadDay  — mốc nhắc (0/7/30…) với ba loại đầu. "wishlist_checkin" KHÔNG có
--              mốc: nhắc định kỳ theo "reminderIntervalDays", nên dùng số ngày
--              kể từ 1970-01-01 của lượt chạy làm khoá. Mỗi chu kỳ check-in rơi
--              vào một ngày khác nhau ⇒ một email mỗi chu kỳ, không phải một
--              email mỗi đời của món hàng.
--
-- Bảng này KHÔNG đi theo bản sao lưu (giống "User".locale và "PushSubscription"):
-- nó là trạng thái kênh gửi của MỘT deployment, không phải dữ liệu người dùng.
-- Khôi phục nó sang máy khác sẽ chặn đúng những email mà bản sao lưu không hề
-- gửi. Vì vậy backup format version không đổi.
--
-- ── "PushSubscription" health: reset khi nào? ─────────────────────────────
--
-- "failureCount" là số lần lỗi TÍCH LUỸ, không reset khi gửi thành công. Cột
-- "lastFailureAt" cho biết lần lỗi gần nhất; không có "lastSuccessAt" nên
-- "failureCount" không thể diễn giải thành "lỗi liên tiếp". Đó là lựa chọn có
-- chủ ý: bảng này KHÔNG phải health-check dashboard, nó chỉ trả lời "subscription
-- này đã từng trả lỗi, lỗi gì, lần cuối khi nào" để điều tra. 404/410 vẫn xoá
-- hàng như trước — một hàng đã xoá không cần health.
--
-- ── Không đụng tới ─────────────────────────────────────────────────────────
--
-- Không đổi "Reminder"."isDismissed" (vẫn là cổng push bảo hành), không đổi
-- lịch leadDays, không đổi payload push của build 23. Mail fallback đọc lại
-- đúng những hàng cron đã chọn, nên "nhắc đã bị ẩn", "máy đã bán" và "máy đã
-- xoá" đều không thể nhận email: chúng không bao giờ tới được vòng lặp.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE public."User"
    ADD COLUMN IF NOT EXISTS "reminderEmailFallback" boolean NOT NULL DEFAULT false;

ALTER TABLE public."PushSubscription"
    ADD COLUMN IF NOT EXISTS "lastFailureAt" timestamp(3) without time zone;
ALTER TABLE public."PushSubscription"
    ADD COLUMN IF NOT EXISTS "failureCount" integer NOT NULL DEFAULT 0;
ALTER TABLE public."PushSubscription"
    ADD COLUMN IF NOT EXISTS "lastError" text;

CREATE TABLE IF NOT EXISTS public."ReminderEmailNotice" (
    id          text        NOT NULL,
    "userId"    text        NOT NULL,
    kind        text        NOT NULL,
    "entityId"  text        NOT NULL,
    "leadDay"   integer     NOT NULL,
    "sentAt"    timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    CONSTRAINT "ReminderEmailNotice_pkey" PRIMARY KEY (id),
    CONSTRAINT "ReminderEmailNotice_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Khoá gửi-một-lần. UNIQUE INDEX thay vì PRIMARY KEY vì id là surrogate: cron
-- cần một id để xoá đặt chỗ khi Resend lỗi, còn tính duy nhất thuộc về nghiệp vụ
-- (userId, kind, entityId, leadDay).
CREATE UNIQUE INDEX IF NOT EXISTS "ReminderEmailNotice_userId_kind_entityId_leadDay_key"
    ON public."ReminderEmailNotice" USING btree ("userId", kind, "entityId", "leadDay");

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS public."ReminderEmailNotice";

ALTER TABLE public."PushSubscription" DROP COLUMN IF EXISTS "lastError";
ALTER TABLE public."PushSubscription" DROP COLUMN IF EXISTS "failureCount";
ALTER TABLE public."PushSubscription" DROP COLUMN IF EXISTS "lastFailureAt";

ALTER TABLE public."User" DROP COLUMN IF EXISTS "reminderEmailFallback";

-- +goose StatementEnd
