# Warrly — Kế hoạch nghiên cứu & triển khai 2026–2027

**Ngày:** 16/11/2026 · **Trạng thái:** 1.0.0 (build 23) đang Waiting for Review · **Người đọc:** founder · **Phạm vi:** 90 ngày tới, 3 release

## 1. Tóm tắt điều hành

Ba mươi vòng nghiên cứu, năm vòng gom cụm, một shortlist tám tính năng, sáu deep dive và một red team cho ra một kết luận không dễ chịu: nút thắt của Warrly trong 90 ngày tới không phải thiếu tính năng, mà là **dữ liệu đang sai và thông báo đang nói dối**. App đang hiển thị ngày hết hạn bảo hành sớm hơn thực tế sau mỗi lần sửa chữa (Điều 30.2.c Luật 19/2023 nói thời gian sửa không tính vào hạn bảo hành), đang push nhắc theo ngày trên giấy, đang trả lời một tài khoản vừa mất Premium bằng câu “đã đạt giới hạn 50 thiết bị, hãy đánh dấu đã bán”, và đang có một bề mặt AI bị ẩn khỏi Settings trong khi `NSCameraUsageDescription` khẳng định ảnh không rời thiết bị. Sửa bốn chỗ đó rẻ hơn mọi tính năng mới trong shortlist, và mỗi chỗ là một lời hứa cốt lõi của sản phẩm.

Shortlist ban đầu dán nhãn “zero L/XL” cho tám tính năng. **Nhãn đó sai.** Theo thang của chính repo (`docs/FEATURE_IDEAS.md:94`: S ≈ một session, M ≈ 1–3 ngày, L ≈ từ một tuần), cả sáu deep dive đều là L, tổng ~14–16 person-week trước review và QA. Kế hoạch này vì vậy không cam kết “hai release tám slice”; nó cam kết **một release 1.1 gọn trong ~4–5 person-week** với ba việc chắc chắn có giá trị, rồi mới mở các nhánh lớn hơn khi có dữ liệu.

Ba khuyến nghị dứt khoát:

1. **Sửa đồng hồ bảo hành ở server theo lịch Việt Nam** (repair extension + return window), hiển thị cho cả ba client, rồi mới bật cron theo ngày đã cộng bù. Đây là việc duy nhất vừa sửa lỗi đúng, vừa chạm được 1.0.0 mà không cần build mới.
2. **Lock Screen accessory widgets + một Control Center mở camera hoá đơn** — một ngày cho phần widget, một tuần cho phần control; bề mặt rẻ nhất còn lại, không thể lộ tên thiết bị, không cần schema.
3. **Premium lapse Phase 0** — predicate biết grace period, câu từ chối đúng sự thật, `GET /billing/status`, và một test chứng minh export không bao giờ bị chặn. Đây là “rail” thật của Premium; ASN V2 để sau.

Đọc thẻ bảo hành là upside lớn nhất (impact 5) nhưng đứng #4 vì hai điều kiện chưa đạt: bề mặt opt-in AI đang bị ẩn và độ chính xác trên thẻ giấy Việt Nam chưa từng được đo. Trả góp đứng #5 với scope thu hẹp. E-invoice XML, digest thông báo và Play Billing bị đẩy khỏi 90 ngày.

## 2. Phương pháp

Chuỗi sản xuất: 30 agent nghiên cứu độc lập theo 30 domain (vòng đời thiết bị, bảo hiểm, subscription, wishlist, AI agent, iOS surfaces, Android surfaces, hệ sinh thái VN, chia sẻ gia đình, mua bán second-hand, claim/repair, bảo hiểm & protection, du lịch, smart home, gaming, xe, creator/SMB, onboarding, tích hợp, thông báo, SEO/growth, monetization, trust/privacy, accessibility, analytics, store policy, review mining, emerging tech, community, TCO) → 5 agent gom cụm → 1 shortlist → 6 deep dive → 1 red team. Mỗi vòng nhận toàn bộ output của vòng trước, nên các mâu thuẫn (ví dụ Wallet pass bị cấm hay không) được phát hiện ở vòng red team chứ không bị làm mượt.

**Chuẩn bằng chứng.** Một claim chỉ được tính khi có URL cụ thể; số liệu repo phải chỉ được file/dòng; suy luận phải gắn nhãn “inference”. Nguồn cũ hơn 12 tháng chỉ dùng làm bối cảnh, không dùng làm bằng chứng hiện tại. Mọi con số chính sách của retailer/brand phải kèm `sourceUrl` + ngày đọc.

**Giới hạn — nói thẳng.** (a) Không có telemetry: repo không có analytics SDK, nên mọi điểm impact là định tính. (b) Không có phỏng vấn người dùng hay A/B nào. (c) Chưa có bản sao build 23, hành vi binary đang suy từ HEAD. (d) PDF bảo hiểm (Bảo Việt, MSIG, HSBC) đọc qua search snippet vì fetcher không nhận PDF; HomeZada trả 403. (e) TGDD render bằng JS, câu “15 ngày” chỉ đọc được từ snippet + mirror. (f) `docs/FEATURE_IDEAS.md` lệch HEAD: widgets, OCR text search và email-in đã ship nhưng vẫn ghi “chưa bắt đầu”; insurance pack đã ship. (g) AccessTrade publisher approval và việc một app native có được tính là “site” chưa xác minh. (h) Không có nguồn nào định lượng willingness-to-pay của hộ gia đình VN.

## 3. Hiện trạng & ràng buộc

- **Build 23 bị đóng băng.** Mọi đề xuất trong tài liệu này là API/web trước; bề mặt iOS nằm ở 1.1 (build 24). Không có đề xuất nào cần sửa binary đang review.
- **28 migration.** `ls api/migrations` kết thúc ở `0028_staple`; `deploy/PRODUCTION_CHECKLIST.md` §2 đang khớp 28. Shortlist có **năm** kế hoạch cùng đòi `0029` — không thể. Tài liệu này cấp phát một sổ migration duy nhất: `0029` Premium lifecycle, `0030` RetailerPolicy, `0031` InstallmentPlan, `0032` (dự phòng e-invoice/vehicle), `0033` (dự phòng).
- **Premium:** 49.000đ/tháng hoặc 399.000đ/năm, trial 7 ngày, StoreKit 2, `POST /billing/verify`; **chưa có App Store Server Notifications V2** (được defer có chủ đích trong `api/internal/appstore/appstore.go`). Hạn mức free 50 active/500 total/100 subscription/200 wishlist; Premium 200/2.000/500/1.000.
- **Chỉ các đường ADD gọi `PlanFor`.** Đọc, sửa, xoá và export không bị chặn. Vì vậy “lapse = read-only” là mô tả sai; trạng thái thật là “vượt trần, chỉ không thêm được”.
- **AI:** `User.aiOptIn` default OFF; bề mặt toggle trong Settings đang bị ẩn (`AIOptInSurface.isVisible = false`), luồng quét hoá đơn trên iOS cũng bị ẩn theo. `NSCameraUsageDescription` hiện nói ảnh “chỉ xử lý trên thiết bị và không gửi đi đâu”, trái với luồng OCR và assess-claim đã ship.
- **Resend đã live** từ 18/10/2026 (`docs/HUMAN_TASKS.md` 1.3). Mọi lập luận “email fallback bị chặn vì thiếu Resend” trong shortlist là cũ.
- **Không có analytics SDK** và landing page cam kết không có GA/Facebook SDK. Đo lường phải server-side `slog` + `cron.Stats`.
- **Không household rewrite, không scrape marketplace, không tự động hoá form của brand.** iOS là client chính; Android/web đi sau.
- **Team 2–3 người, ship nhanh.** Mọi thứ dưới đây tính theo person-week thật, không theo nhãn.

## 4. Backlog đã khử trùng lặp (40 mục)

Cột Effort ghi person-week thật; S = ≤1 ngày, M = 1–3 ngày, L = ≥1 tuần theo thang repo, nhưng ngoặc là thời gian thực tế cho một team 2–3 người. “ext” = mở rộng một mục backlog đã có, không phải ý mới.

| # | Tính năng | Theme | Vấn đề | Platforms | I | E | C | Premium | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Đồng hồ sửa chữa & đổi trả (ext claim record) | Warranty truth | `endDate` bỏ sót ngày sửa; `returnWindowDays` thường trống | api,ios,android,web | 5 | L (1,5w + 2w) | 4 | Free clock, Premium hồ sơ | **Build now** |
| 2 | Lock Screen accessory + Control Center (ext widgets) | iOS surfaces | Hạn chỉ thấy khi mở app; capture 4 tap | ios | 4 | S–M (1w) | 5 | Free | **Build now** |
| 3 | Premium lapse Phase 0 | Monetization | Grace mất quyền; 409 khuyên sai | api,web,ios | 4 | S (3–5d) | 4 | Rail | **Build now** |
| 4 | Đọc thẻ bảo hành (ext contract terms) | Capture/AI | 9 cột 0017 trống → verdict UNCLEAR | api,ios,web | 5 | L (2–3w) | 4 | Premium sau gate | **Next** |
| 5 | Trả góp ledger | Ownership economics | `purchasePrice` như tiền mặt | api,ios,web,android | 5 | L (3w) | 4 | Forecast | **Next (thu hẹp)** |
| 6 | Starter kit + fix-up sprint | Activation | Vault trống, row thiếu ngày | api,ios,android,web | 4 | M (1w) | 3 | Free | **Next** |
| 7 | Renewal windows (ext trial/cancel) | Subscription money | Audit báo tăng giá sau khi trừ tiền | api,ios,web | 4 | S (3–5d) | 4 | Free | Later (copy-only) |
| 8 | Reminder delivery health + email fallback | Reliability | Push chết im lặng | api,ios,android,web | 4 | M (2w) | 4 | Free | Later |
| 9 | Play Billing Android | Monetization | Android không có đường mua | android,api | 5 | L (4w) | 4 | Rail | Later |
| 10 | Policy fit check (contents cap) | Insurance | Cap per-item vs inventory | api,web | 4 | M (1–2w) | 4 | Premium | Later |
| 11 | Pre-loss snapshot + loss event | Insurance | Pack render live rows | api,web | 4 | L (3w) | 4 | Premium | Later |
| 12 | Condition log (pin, tình trạng) | Resale | Pin bị kích, không trend | api,ios,web | 4 | M (1–2w) | 4 | Premium | Later |
| 13 | Handoff/transfer record | Resale | Hồ sơ chết khi sang tay | api,web,ios | 4 | L (3w) | 3 | Free | Later |
| 14 | Transferability verdict (ext contract terms) | Warranty truth | `transferable` không hiện | api,ios,web | 3 | S (3d) | 4 | Free | Later |
| 15 | Support clock EOL | Warranty truth | Firmware chết trước bảo hành | api,web | 3 | M (1–2w) | 3 | Premium | Later |
| 16 | Quote ledger / resale TCO | Ownership economics | Không có giá thu | api,ios,web | 4 | M (2w) | 4 | Premium | Later |
| 17 | Bundle/channel/seat audit | Subscription money | Trả trùng bundle, giá in-app | api,ios,web | 4 | M (2w) | 3 | Premium | Later |
| 18 | Security timeline + freeze | Trust | Không audit trail | api,web,ios | 4 | M (2w) | 4 | Free | Later |
| 19 | Passkeys web | Trust | Một mật khẩu cho cả vault | api,web | 4 | M (2w) | 4 | Free | Later |
| 20 | On-device receipt scan | Capture | AI off = không quét được | ios,android | 4 | M (2w) | 3 | Free | Later (prereq #4) |
| 21 | Trip kit + travel cover gap | Travel | Adapter không đổi điện áp | api,ios,web | 4 | M (2w) | 4 | Premium | Later |
| 22 | Portability verdict | Travel | Xách tay bị từ chối tại VN | api,ios,web | 4 | M (1–2w) | 3 | Free | Later (gộp #14) |
| 23 | Incident lockdown (mất máy) | Loss | 24h giấy tờ, IMEI nằm trong máy mất | api,ios,web | 5 | M (2w) | 4 | Premium | Later |
| 24 | Vehicle km service ladder | Vehicle | Bảo dưỡng theo km, không theo ngày | api,ios,android,web | 5 | L (3w) | 4 | Premium | Later |
| 25 | Vehicle sale 30-day clock | Vehicle | Phạt 4–6tr nếu không thu hồi đăng ký | api,ios,web | 4 | M (2w) | 4 | Premium | Later |
| 26 | Recall watch | Vehicle | Triệu hồi theo model, không ai báo | api,ios,web | 4 | S (1w) | 3 | Free | Later |
| 27 | Business asset register | B2B | NĐ 68/2026: khấu hao là chi phí | api,web | 4 | L (4w) | 4 | Premium | Later (B2B) |
| 28 | Gear-out ledger | B2B | Cho thuê gear ghi bằng chat | api,ios,web | 4 | M (2w) | 3 | Premium | Defer |
| 29 | Estimated warranty window | Capture | `purchaseDate` bắt buộc | api,ios,android,web | 4 | M (2w) | 4 | Premium | Later |
| 30 | Gift list reservation | Growth | Quà trùng, mất bất ngờ | api,web,ios | 4 | M (2w) | 3 | Free | Later (Tết 2027) |
| 31 | Certificate claim → device draft | Growth | Loop chết ở người mua | api,web,ios | 4 | S–M (1w) | 3 | Free | Later |
| 32 | Public warranty-term pages | SEO | Không trang trả lời “bảo hành bao lâu” | web,api | 4 | M (2w) | 4 | Free | Later |
| 33 | Return-window public calculator | SEO | Quy định đổi trả rải rác | web,api | 4 | S (3–5d) | 4 | Free | Later |
| 34 | Co-keeper grant | Household | Nhà 3 người, 1 người giữ máy | api,web,ios | 4 | M (2–3w) | 4 | Premium | Defer |
| 35 | Shared plan seats | Household | Không biết ai trả bao nhiêu | api,ios,web | 4 | S (3–5d) | 4 | Premium | Defer |
| 36 | Insurance referral | Revenue | Hoa hồng bảo hiểm chưa có | api,ios,web | 4 | L | 2 | — | Defer (pháp lý) |
| 37 | Family Sharing Premium | Monetization | 399k/năm cho một người | ios,api | 3 | S (3d) | 3 | — | Later (sau duyệt) |
| 38 | Win-back offers | Monetization | Lapsed không có đường quay lại | ios,api | 4 | S (1–2d) | 4 | — | Later (sau duyệt) |
| 39 | Readable export | Trust | Export chỉ có ciphertext | api,web | 3 | M (1–2w) | 4 | Free | Later |
| 40 | Erasure receipt | Trust | Không chứng minh đã xoá | api,web | 3 | M (1–2w) | 5 | Free | Later |

**Mục backlog đã biết — không liệt kê lại như mới:** email-in alias/forwarding, barcode/serial scanning, multi-stage reminders, household accounts, Zalo OA/ZNS, serial-to-brand lookup, capture-first inbox, full-text OCR search, pre-service handover checklist, share-sheet import, per-item currency/FX, widgets/Siri/Spotlight, maintenance schedules, bulk capture, event log/what’s new, share-sheet wishlist, periodic cloud backup, ICS calendar, component ledger, monthly summary, app shortcuts. Chỉ những mục có angle thật mới vào bảng trên và đều gắn “ext”.

**Mục bị loại khỏi bảng vì bằng chứng yếu hoặc trùng:** e-invoice XML (#41 trong bản nháp, xem §11), daily digest, invoice-identity fields, Wallet pass (không bị Apple cấm như shortlist nói — xem §8), MCP connector, accessibility text-scale, offline counter card, thumbnail endpoint (đưa vào quick win của 1.1).

## 5. Top 8

| # | Tính năng | Vì sao | Bằng chứng | Effort | Phụ thuộc | App Store risk |
|---|---|---|---|---|---|---|
| 1 | Đồng hồ sửa chữa & đổi trả | Sửa số đang sai cho mọi client; cron đang push sớm | Điều 30.2.c; TGDD 15 ngày; CellphoneS 24h–14 ngày; Claim 0021 | 1,5w + 2w | Claim, cron, `AT TIME ZONE` ICT | Thấp — chỉ copy “theo chính sách” |
| 2 | Lock Screen + Control Center | Bề mặt rẻ nhất, không lộ dữ liệu, không schema | Apple ControlWidget/accessory; snapshot App Group đã có | 1w | Widget extension, project.yml | Không — phải Free (4.10) |
| 3 | Premium lapse Phase 0 | Sai sự thật trong câu từ chối + grace bị mất quyền | `premium.go`; ASN chưa có; review corpus | 3–5d | 0029; ASC URL cho phase sau | Thấp |
| 4 | Đọc thẻ bảo hành | Verdict đã ship đang mù đúng chỗ quyết định | `ai_assess.go` decisiveTerms; 0017; AppleCare fees | 2–3w | Consent surface + camera string + accuracy sheet | Trung bình (5.1.2) |
| 5 | Trả góp ledger | Sửa cost-per-day/profit; 2 nhóm độc lập cùng đề xuất | FPT ~50% iPhone 18; Vietstock 20,9tr; repo không có model | 3w | 0031; iOS 1.1 | Thấp |
| 6 | Renewal windows (copy-only) | Nửa premise đã ship; chỉ còn phần copy + store-rule | trial reminder đã fan-out; Play 48h; Tuổi Trẻ | 3–5d | Không migration | Thấp |
| 7 | Starter kit + fix-up | Vault trống là màn hình đắt nhất | AllKeep/Sortly; Appcues 58% vs 82% | 1w | bulk endpoint sẵn có | Không |
| 8 | Reminder delivery health | Push chết im lặng, email đã live | APNs 410; batch 56% iOS opt-in; Resend live | 2w | cron, Resend | Không |

**Vì sao #3 đứng trên #4:** warranty-card là upside lớn nhất nhưng đang bị chặn bởi hai điều kiện sản phẩm chưa đạt (bề mặt consent bị ẩn, độ chính xác chưa đo). Premium lapse là tiền đang mất mỗi ngày và sửa được trong một tuần, server-side, không cần build.

## 6. Sáu kế hoạch triển khai

### 6.1 Đồng hồ sửa chữa & đổi trả — build now, thu hẹp

**Phán quyết.** Đây là sửa một con số đang sai cho cả ba client, không phải module mới. Wave 1 không migration; wave 2 mới có bảng retailer.

**Vấn đề.** `Warranty.endDate` là ngày trên giấy. Sau một lần sửa 12 ngày, hạn đúng phải là ngày giấy + 12 (Điều 30.2.c), nhưng cron và feed vẫn tính theo ngày giấy nên push “còn 7 ngày” đến sớm 12 ngày. iOS đã tự cộng bù bằng `WarrantyRepairAdjustment` (client-side, lịch local) trong khi Android/web không có gì. `returnWindowDays` do người dùng tự nhập nên thường null; TGDD công bố 15 ngày sửa, FPT 1-đổi-1 30 ngày, CellphoneS 24h–14 ngày làm việc — không số nào vào được app.

**Data model.** Wave 1: không migration. `repairExtensionDays` và `entitledWarrantyEnd` derive khi read, bằng SQL `(c."closedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - (c."openedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`, `GREATEST(0, …)`, chỉ với claim `RESOLVED/REJECTED/CANCELLED` có `closedAt`, clamp 3650. Tuyệt đối không dùng `::date` trần: `dbconn` pin session UTC, nên claim đóng 05:30 ICT sẽ bị 22:30Z hôm trước và mất một ngày — đây là lỗi mà comment trong `WarrantyRepairAdjustment.swift` đã ghi. Wave 2: migration `0030_retailer_policy` gồm `RetailerPolicy` (storeId PK FK `Store`, `returnWindowDays` NULL, `repairCeilingDays` NULL, `repairCeilingNote`, `exchangeNote`, `sourceUrl` NOT NULL, `checkedAt`, `isActive`), `Device.retailerId` NULL + index + backfill exact-match qua `wv_unaccent`, `Claim.promiseNotifiedAt`/`promiseNotifiedKind`. `DeviceInput.retailerId` phải tri-state (vắng = giữ, `''` = xoá, id = set) như `warrantyMonths`, nếu không mỗi lần sửa thiết bị từ build 23 sẽ xoá retailer.

**API.** Wave 1: thêm `repairExtensionDays` (int, luôn có, 0 = không) và `entitledWarrantyEnd` (date, nullable) vào `GET /devices`, `/devices/{id}`, `/search`, `/reminders`; `effectiveWarrantyEnd` giữ nguyên nghĩa. Không route mới. Wave 2: `Claim.repairPromise` object (days, dueAt, daysLeft, state ON_TRACK/DUE_SOON/OVERDUE/MET/MISSED, sourceUrl, checkedAt); `GET /catalog` trả `retailers[]`; thêm `retailerId` vào backup (additive, unknown id → NULL, không fail import). **Cắt** endpoint breach-record premium: nó trùng `draftLetter` miễn phí của `POST /ai/assess-claim`.

**Clients.** iOS: bỏ hẳn fetch `/claims` thứ ba trong `RemindersStore` và map `repairDaysByDevice`; hiển thị `entitledWarrantyEnd`; giữ helper cũ làm fallback khi field nil; thêm chip “Ngày 12/15” vào `ClaimsSection`; wave 2 thêm picker cửa hàng trong device form và chip “Dùng 30 ngày”. Android: chỉ chip + field, không picker (chưa có đường mua Premium nên picker là vô nghĩa). Web: chip trong `claims/page.tsx` và block hai ngày trong device detail; form có `<select name=retailerId>`.

**Thông báo.** Flag `WV_REPAIR_EXTENSION` (default off). Khi bật, bucket T-30/T-7 dùng ngày entitled và body nêu cả hai ngày (“còn 7 ngày; hạn trên giấy 12/03”). Wave 2 thêm T-2 và T+1 cho promise, stamp `promiseNotifiedAt/kind`; body tiếng Việt, url `/devices/{id}` — build 23 vẫn route đúng. Không bao giờ tạo `Reminder` row cho promise (`Reminder.warrantyId` NOT NULL và `isDismissed` là cổng push bảo hành).

**Đo lường.** `slog` + `cron.Stats`: `repairExtensionShiftedNotices`, `repairPromiseNotices`; một dòng log khi policy NULL để biết retailer nào cần xác minh.

**Edge cases.** Sửa trong ngày = 0, không phải “+0 ngày”; `closedAt < openedAt` = 0; mở lại claim làm hạn lùi (chấp nhận, ghi chú); claim 400 ngày clamp 3650; device SOLD/LOST skip, **BROKEN vẫn chạy** (máy đang ở tiệm là case sống); policy NULL → không countdown, không đoán; `checkedAt` >180 ngày → UI mờ + “số liệu có thể đã cũ”.

**Test.** Unit ICT boundary 00:00–07:00, month/year edge; DB equality giữa SQL và Go; cron idempotent (chạy 2 lần = 1 push); `api/scripts/test_promise_clock.sh`; iOS decode payload không có field mới (tương thích 1.0.0); web helper.

**Rollout.** Server flag off → client hiển thị field → bật flag ở staging một chu kỳ cron → production. Wave 2 chỉ seed 2–3 retailer đã đọc trong browser thật, có `sourceUrl` + `checkedAt`.

**Effort.** Wave 1: 1,5 tuần (server 3 ngày, iOS 3 ngày, Android 1 ngày, web 1 ngày). Wave 2: 2 tuần.

**Rủi ro.** (1) UTC/ICT — đã xử lý, nhưng phải test. (2) TGDD JS-rendered: nếu không đọc được trong browser, hàng TGDD ship NULL và countdown không tồn tại cho retailer lớn nhất — nói trước, đừng đoán. (3) Assert policy của retailer như sự thật là rủi ro pháp lý; mọi surface phải in “theo chính sách của <retailer>” + ngày. (4) Letter premium trùng free — đã cắt.

**Câu hỏi mở.** BROKEN có tính promise không; ngưỡng stale 90 hay 180 ngày; PDF bảo hiểm in ngày giấy hay ngày entitled.

### 6.2 Lock Screen + Control Center + Action Button kit

**Phán quyết.** Build, nhưng là ba commit độc lập và nói đúng sự thật: control mở camera trong một tap, ảnh là tap thứ hai, và Face ID chen giữa nếu app lock bật. “One tap” thật sự cần LockedCameraCapture (target mới, không network, không App Group) — để sau.

**Data model.** Không Postgres, không migration, không openapi — đó là lý do nó rẻ. Chỉ sửa file App Group `deadline-snapshot.json`: thêm `counts {dueToday, within7, within30}` đếm **distinct deviceId** trên toàn bộ reminder đã lọc dismissed, **trước** khi cắt 12 dòng; bump version 2; `DeadlineSnapshotStore.readOutcome()` phân biệt missing / unreadable / snapshot. Thêm key `wv.pendingCapture` để control bàn giao intent.

**API.** Không có. Widget và control không gọi mạng. Chỉ tái dùng `GET /reminders?withinDays=90`, `GET /devices`, `POST /attachments` (deviceId rỗng = inbox) — tất cả đã có; lưu ý rate limit 60 write/phút và phải hiện đúng `message` của envelope khi 429.

**iOS.** `WarrlyDeadlineWidget` thêm `.accessoryCircular/.accessoryRectangular/.accessoryInline` (iOS 16+), không dùng `.containerBackground` cho accessory; `DeadlineAccessoryRules.swift` giữ toàn bộ copy/số để extension chỉ còn layout; `ReceiptCaptureControl.swift` (@available iOS 18) dùng `ControlWidgetButton` + `OpenIntent`; `DeadlineWidgetBundle` mới với guard **`iOSApplicationExtension 18.0`** — dùng `iOS 18.0` sẽ làm mất toàn bộ widget trên iOS 17, đây là lỗi đã biết; intent có target membership ở cả app và extension; `AppRouter` thêm `warrly://capture`; `RootView` présent `InboxCaptureSheet(startWithCamera: true)` dưới lớp AppLock; sheet enqueue offline qua `SharedInboxStore`.

**Android/web.** Không có. Android widget cố ý home-screen-only; web đã có PWA shortcut “Hộp thư”.

**Thông báo.** Không thêm. Timeline giữ 7 mốc nửa đêm + 6h/48h; `reloadTimelines(ofKind:)` đã phủ mọi family.

**Đo lường.** Không SDK, không event. App Store Connect không đo widget. Tín hiệu duy nhất: số `POST /attachments` không có deviceId. QA debug counter `wv.qa.capture.*` chỉ trong `#if DEBUG`.

**Edge cases.** iOS 17 sau update (widget phải sống); máy khoá trước lần unlock đầu (readOutcome = unreadable, không bịa “0”); snapshot build 23 không có counts (decodeIfPresent); không có mốc nào trong 90 ngày (nói rõ cửa sổ, không hiện “0”); camera bị từ chối (`Mở Cài đặt`); offline (queue, banner đếm); 429; sign-out (clear snapshot + cờ).

**Test.** Boundary 0/7/8/30/31; đếm trước truncation (15 reminder → within30 = 15, rows = 12); distinct device; dismissed bị loại; không có tên thiết bị trong string; `xcodebuild -scheme WarrlyWidget` + `-scheme Warrly` là gate bắt buộc vì CI không build extension.

**Rollout.** 1.1 build 24, ba PR: accessory (1 ngày) → control (3 ngày) → offline (2 ngày). Không có flag client-side cho `supportedFamilies`; kill switch là chu kỳ review sau.

**Effort.** 1 tuần.

**Rủi ro.** Bundle availability bug; không ai compile extension trong CI; cơ chế mở app từ control chưa được xác nhận trên thiết bị (OpenIntent vs OpenURLIntent) — budget nửa ngày; count chỉ tươi bằng lần sync cuối (rectangular có “Tính đến”, circular không có chỗ).

### 6.3 Đọc thẻ bảo hành — server-shadow trước, Premium sau

**Phán quyết.** Build, nhưng không phải #1 và không Premium ngay. Toàn bộ giá trị nằm ở chỗ 9 cột hợp đồng (0017) đang trống làm verdict của `assess-claim` bị hạ xuống UNCLEAR; feature chỉ là input, không phải module.

**Điều kiện tiên quyết (chặn).** Bề mặt opt-in AI phải được bật lại và câu chữ phải nói đúng: ảnh thẻ được gửi tới Anthropic, ngoài Việt Nam, trong bao lâu; `NSCameraUsageDescription` phải được viết lại cho đúng (hiện đang sai). Đây là quyết định sản phẩm + App Review, không phải “reword copy”.

**Data model.** Không migration. Draft là struct transient như `DraftDevice`; ảnh nằm trong `Attachment` (0018, deviceId NULL = inbox); transcript vào `Attachment.extractedText` (0019) để search được. Không suy `type` từ điều khoản; `transferable` giữ tri-state; `months` chỉ derive nếu tái tạo đúng ngày kết thúc.

**API.** `POST /api/v1/ai/extract-warranty-card` body JSON `{attachmentId}` (không nhận multipart: cần row attachment để lưu transcript), trả `{draft: …}` với mọi scalar nullable, `confidence`, `unmatched[]`, `warnings[]`. Gate: `aiOptIn`, `ANTHROPIC_API_KEY`, env `WARRANTY_CARD_PREMIUM` default OFF. Rate limit riêng 10/60s. Lỗi dùng lại mã cũ: 403 `ai_optin_required`, 403 `premium_required`, 404, 429, 502, 503.

**Sanitizer (quan trọng nhất).** Khấu trừ dạng % → null + warning, không quy ra đồng; “0/2” → tách used/allowed, used>allowed thì bỏ used; hai đồng hồ trên một thẻ → giữ gói whole-unit + warning, không lấy hạn dài; mọi số phải nằm trong quote; truncate theo rune đúng bound của `ValidateWarrantyInput`. Test “pin” phải map draft vào `WarrantyInput` và yêu cầu validator không lỗi.

**Clients.** iOS: `WarrantyCardScanSheet` (camera/Photos/Files), merge **chỉ điền ô trống**, hiện “Trên thẻ: …” khi lệch, không ghi đè số người dùng đã nhập; `WarrantyFormView` thêm row “Đọc thẻ bảo hành”. Web: component + server action upload-first giống `receipt-scan.ts`. Android: defer (chưa có đường mua Premium; capture làm sau).

**Thông báo.** Không có.

**Đo lường.** `slog`: tokens vào/ra, confidence, unmatched, warning codes; bảng accuracy 20 thẻ thật chấm theo field (exact/acceptable/wrong/null). Đây là cổng để bật Premium, không phải dashboard.

**Edge cases.** Thẻ chỉ có ngày (derive months nếu khớp chính xác); ảnh chụp màn hình trang chính sách (confidence thấp); HEIC transcode; PDF e-warranty; re-scan không đọc được không được xoá transcript cũ; attachment của người khác → 404.

**Test.** Tool schema (9 field, không có `type`); sanitizer table; gate matrix (flag × premium); `TestExtractWarrantyCardWritesNothingButText`; openapi drift; iOS/web merge matrix giống nhau.

**Rollout.** Server shadow (403/503 cho tới khi bật) → web → iOS 1.1. Bật Premium chỉ sau khi sheet accuracy đạt ≥80% exact-or-null trên cap/deductible/exclusions/scope và biết cost/scan.

**Effort.** 2–3 tuần; server-shadow 1 tuần.

**Rủi ro.** Accuracy trên thẻ giấy VN chưa từng được đo (chính repo ghi vậy); một `exclusions` đọc sai có thể biến UNCLEAR trung thực thành “được bảo hành” có trả tiền; premium-only sẽ tạo nút chết trên Android/web; transcript là PII plaintext trong Postgres.

### 6.4 Premium lifecycle + graceful lapse

**Phán quyết.** Phase 0 build ngay (3–5 ngày); ASN V2 là dự án riêng 3–4 tuần, không nằm trong 1.1.

**Vấn đề thật.** Không phải “khoá quyền đọc” — đọc/sửa/xoá/export vẫn chạy. Vấn đề là: grace period bị coi là hết hạn; refund không được áp cho tới khi app mở; và câu 409 khuyên người dùng “đánh dấu đã bán” trong khi nguyên nhân là mất Premium.

**Data model.** Migration `0029_premium_lifecycle` (additive): `PremiumEntitlement` thêm `autoRenewStatus`, `expirationIntent`, `inBillingRetryPeriod`, `gracePeriodExpiresAt`, `revocationReason`, `lastEventType/At`; bảng `EntitlementEvent` append-only (id `asn:<uuid>` / `verify:<txn>` / `cron:…`, `originalTransactionId`, `source`, `effectiveAt`, `applied`, `applyNote`, hash payload — không lưu JWS thô); bảng `PremiumNotice` khoá `(userId, periodEnd, kind)`.

**Predicate.** `active = revokedAt IS NULL AND (expiresAt > now OR (gracePeriodExpiresAt IS NOT NULL AND gracePeriodExpiresAt > now))`, tính bằng DB `now() AT TIME ZONE 'UTC'`, không cache. Row legacy NULL grace hành xử y như cũ.

**API.** `GET /billing/status` (state PREMIUM/GRACE_PERIOD/BILLING_RETRY/EXPIRED/REVOKED/NEVER, usage/limits/overCap, `addsBlocked`, `canExport: true`); `GET /billing/events`; `POST /billing/appstore/notifications` (200 cho mọi kết quả ngữ nghĩa, 400 chỉ khi signature không verify, 500 chỉ khi DB lỗi; idempotent theo `notificationUUID`; replay event chưa gán khi verify). `POST /billing/verify` giữ nguyên shape. Phase 0 chỉ cần status + copy + test export.

**Clients.** Phase 0: không client nào cần đổi — câu 409 mới đi qua `envelope.message` tới cả build 23. iOS 1.1: banner dismissible 7 ngày, `PremiumStatusSheet`, route push `/settings/premium`. Web: card read-only, không giá, không nút mua, chỉ link manage. Android: 0 dòng code.

**Thông báo.** Email “sắp hết hạn” khi `autoRenew=false` trong T-3; email “đã hết hạn” sau kỳ + grace; cả hai bỏ qua entitlement Sandbox; push tag `wv-premium-<periodEnd>-<kind>`. Không có offer, không link mua ngoài app.

**Đo lường.** Ledger là funnel (SUBSCRIBED/DID_RENEW/… group by type); `billing.quota.refused` (plan, lapsed, resource, limit, usage) là tín hiệu quan trọng nhất; không log mỗi lần GET status.

**Edge cases.** Event đến trước khi app mở (userId NULL → replay); out-of-order (guard `effectiveAt`); refund khi app đóng (revoke ngay); grace hết hạn; retry trùng UUID; Sandbox vs Production; transactionId trùng giữa hai môi trường (rủi ro cũ, chưa sửa).

**Test.** `verifyWithRoots` seam để test chain; predicate matrix; copy test (free path byte-identical, lapsed path không chứa “đánh dấu đã bán”); export-over-cap 200; replay; 200-vs-400 ASN; cron.

**Rollout.** 0029 trước binary; flag `PREMIUM_NOTICES_ENABLED` off; ASC URL sau khi endpoint live; Billing Grace Period phải bật trong App Store Connect nếu không `gracePeriodExpiresAt` không bao giờ tới.

**Effort.** Phase 0: 3–5 ngày. ASN: 3–4 tuần.

**Rủi ro.** Ordering có thể revoke người đang trả tiền — nghiêm trọng nhất; retry 4xx của Apple chôn lỗi thật; thêm email channel mới; thông tin “multi-week lead” trong shortlist là sai (URL là thay đổi 5 phút; `.p8` không bắt buộc).

### 6.5 Trả góp ledger — thu hẹp

**Phán quyết.** Build phần lõi, cắt phần nguy hiểm. Không push nhắc “quá hạn”, không forecast trong wave 1, không Android editor.

**Vấn đề.** `purchasePrice` được dùng như tiền mặt ở cost-per-day, resale profit và `/stats`. Với ~50% người mua iPhone 18 tại FPT chọn trả góp, mọi con số đó sai theo phí và theo khoản còn nợ.

**Data model.** Migration `0031_installment_plan`: bảng `InstallmentPlan` PK `deviceId` FK cascade, `downPayment`, `months` 1–60, `monthlyAmount`, `firstDueAt` (calendar day → override `wire.Day`), `fileFee`/`monthlyFee` NULL, `paidCount`, `lender`, `notifiedDueAt`/`notifiedLeadDay`. Không lưu derived (total, remaining, next due) — tính khi read. Không đưa vào `DeviceInput`/PATCH, nếu không build 23 sẽ xoá plan mỗi lần sửa thiết bị; chỉ ghi qua endpoint riêng.

**API.** `PUT /devices/{id}/installment` (idempotent, trả `{device}`), `DELETE` (idempotent), field `installment` + `ownershipCostVnd` trên mọi device payload. Validation: `paidCount ≤ months`, `monthlyAmount > 0`, `months` 1–60, currency change bị 400 khi có plan. Backup additive, version không đổi.

**Clients.** iOS 1.1: sheet + card (progress, đã trả, còn nợ, kỳ tới), sửa basis của `StatsRollup`/`DeviceResale`. Web: form riêng dưới device form, card, sửa `stats-rollup.ts`/`device-resale.ts`. Android: card read-only + link “Sửa trên web”; sửa profit basis để ba client không lệch.

**Thông báo.** Wave 1 **không push**. Lý do: `paidCount` là người dùng tự khai, app không biết ngân hàng đã trừ hay chưa; một “quá hạn” sai là lỗi phá niềm tin nhất của một tính năng tiền. Khi có bảng payment thật mới bàn lại.

**Đo lường.** `slog` khi lưu/xoá (id, months, has_fee — không log số tiền); SQL một lần: tỷ lệ device có plan, tỷ lệ plan trên máy đã bán.

**Edge cases.** Ngày 29–31 clamp theo tháng; `paidCount = months` → completed; trả trước → không overdue; thiếu phí → lower bound; ngoại tệ không có rate → VND null; bán máy còn nợ → giữ plan + cảnh báo; backup thiếu key → không plan.

**Test.** Month-clamp table; profit sign flip có chủ đích; iOS decode không có key; web rollup; `check_openapi_drift` + `check_request_field_drift`.

**Rollout.** Server trước (additive), iOS 1.1, web, Android sau. Không cần flag vì không client cũ nào gửi field.

**Effort.** 3 tuần (server 1 tuần, iOS 1 tuần, web 4 ngày, Android 2 ngày).

**Rủi ro.** `paidCount` không đáng tin → đừng gọi là “ledger”, đừng cảnh báo quá hạn; profit đổi dấu (lãi → lỗ) phải giải thích bằng copy; build 23 vẫn tính theo giá niêm yết đến khi 1.1 phát hành.

### 6.6 Renewal windows — chỉ copy, không migration

**Phán quyết.** Nửa “pre-charge” đã ship (nhắc trial theo `leadDays` + `convertsToPrice`). Thứ thật sự thiếu là **câu chữ về quy tắc cửa hàng** và một cờ “đã ghi nhận khoản bị trừ”. Làm phần đó, đừng thêm cột.

**Phạm vi.** Một bảng hằng số Go `storeRules` (Apple: cửa sổ đồng ý 60 ngày/năm, 27 ngày/tháng — **không** dùng con số “7 ngày” vì không có nguồn xác nhận; Google: ≥30 ngày, auto-cancel nếu không đồng ý; refund Google 48h; Apple **không** có cửa sổ cố định), mỗi dòng có `sourceUrl` + `checkedOn`. API trả `renewalWindow` object trên `GET /subscriptions/{id}` khi trial đã convert trong 14 ngày (derive từ `trialEndsAt`, `convertsToPrice`, `SubscriptionPayment`) — không endpoint mới, không cột mới, không queue kind mới ở wave 1.

**UX.** Card trong detail: ngày convert, số đã ghi nhận (nếu có), “còn ~2 ngày” (calendar day, nói rõ), nút “Ghi nhận khoản đã trừ” mở sheet log-payment có sẵn, và walkthrough 4–6 bước trong app — không link ngoài, không hứa hoàn tiền.

**Clients.** iOS + web. Android: 0.

**Không làm.** Không migration `nextChargeAmount`; nếu sau này cần, đó là wave 2 với endpoint riêng và không đụng PATCH.

**Effort.** 3–5 ngày. **Rủi ro:** hứa hạn refund sai (Apple); paywall hoá đúng lúc người dùng vừa bị trừ tiền — để free.

## 7. Roadmap 90 ngày

**1.1 — build 24 (tuần 1–3, ~4,5 person-week).** (a) Lock Screen accessory families (1 ngày) + control + offline (4 ngày). (b) Claim clock wave 1 server (3 ngày) + iOS/Android/web hiển thị (5 ngày). (c) Premium Phase 0 (4 ngày). (d) Quick win thumbnail `?w=160` (2 ngày) + `X-Request-Id`/log sạch. (e) Starter kit web (3 ngày) nếu còn capacity. Gate: `xcodebuild` widget + app; openapi drift; không đụng build 23.

**1.2 — build 25 (tuần 4–8, ~6 person-week).** (a) Reward card extraction: server-shadow + accuracy sheet 20 thẻ; chỉ mở UI khi consent surface đã bật lại và đạt ngưỡng. (b) Installment ledger (server + iOS + web). (c) Claim clock wave 2: seed 2–3 retailer đã đọc browser + countdown. (d) Renewal copy + store-rule table. (e) ASN V2 khởi động song song nếu còn người.

**2.0 — tuần 9–13.** Chọn **một** nhánh lớn: resale handoff (acquisition loop, L) hoặc insurance pre-loss pack (willingness-to-pay cao, L). Không làm cả hai. E-invoice, digest, Play Billing, vehicle, B2B để sau khi có dữ liệu 1.1.

**Không làm trong 90 ngày.** Play Billing (Android-first trong khi iOS là chính, demand chưa đo); Wallet pass (không bị cấm, nhưng không phải ưu tiên — đính chính shortlist); household/co-keeper; referral hai chiều; insurance referral (cần pháp lý); e-invoice XML (chưa có fixture provider, `Store` không có MST); digest (chưa có baseline đo).

## 8. Red team — điều có thể giết từng tính năng

**Chung.** (1) Nhãn effort sai: sáu deep dive ~14–16 person-week, không phải “zero L/XL”. (2) Năm kế hoạch cùng đòi `0029` — không thể serialize. (3) Docs backlog lệch HEAD nên “không phải backlog” không đáng tin nếu không grep lại. (4) Premium matrix tự mâu thuẫn: #1 premium-only nhưng gate default OFF; #2 “token cost” nhưng deep dive nói deterministic; #6 deep dive nói nên free.

**#1 Claim clock.** Killer: tính ngày bằng UTC (đã sửa bằng `AT TIME ZONE`); TGDD JS-rendered nên countdown có thể không tồn tại cho retailer lớn nhất; letter premium trùng `draftLetter` miễn phí (đã cắt); seed policy từ snippet = assertion pháp lý không có nguồn. Cắt: mọi thứ trừ wave 1.

**#2 Lock Screen.** Killer: guard `iOS 18.0` làm mất widget trên iOS 17; CI không compile extension; cơ chế mở app từ control chưa xác nhận; “one tap” là marketing sai nếu app lock bật. Giữ: slice 1 một ngày, ship trước.

**#3 Premium Phase 0.** Killer: refactor `assertDeviceQuota` có thể đổi câu free (đã pin test); ASN ordering có thể revoke người đang trả; shortlist nói lead time “nhiều tuần” là sai. Cắt: ASN khỏi 1.1.

**#4 Warranty card.** Killer: surface opt-in đang ẩn (`AIOptInSurface.isVisible = false`) nên user story “bật trong Settings” là sai; `NSCameraUsageDescription` đang nói dối; accuracy chưa đo; một `exclusions` sai = verdict trả tiền sai. Không ship UI/Premium trước khi sửa consent + có sheet.

**#5 Installment.** Killer: `paidCount` tự khai → “quá hạn” sai; đổi basis làm profit lật dấu; build 23 vẫn tính giá niêm yết nên ba client lệch; effort 3 tuần là L thật. Cắt: reminders, forecast, Android editor.

**#6 Renewal.** Killer: premise “hai cửa sổ đều thiếu” sai (trial reminder đã ship); “48h” chỉ đúng cho Play; paywall đúng lúc bị trừ tiền. Giữ: copy + một object derive.

**#7 Starter kit.** Killer: shell không ngày = nhiễu nếu không có fix-up đi kèm; iOS chưa có màn bulk (chỉ helper). Ship web trước.

**#8 Reminder health.** Killer: không đo được opt-in; email chỉ hoạt động nếu domain Resend đã verify; fallback có thể thành spam. Cắt: chỉ email transactional cho deadline user tự tạo, 1 lần/entity/lead.

**Bằng chứng yếu phải nói rõ.** Không có bản sao build 23; hành vi binary suy từ HEAD. TGDD đọc qua snippet. Chợ Tốt AI-writer ~13 tháng. AccessTrade approval chưa xác minh. Không có nguồn nào định lượng WTP hộ gia đình VN. “Không competitor nào làm X” là inference từ phạm vi tìm kiếm, không phải census.

**Đính chính so với shortlist.** Wallet pass **không** bị Apple cấm (pass generic/coupon/loyalty vẫn hợp lệ) — hoãn vì ưu tiên, không phải policy. Play Billing không bị chặn bởi “deadline v7 đã qua” (v8/v9 tồn tại) — lý do thật là Android chưa phải ưu tiên và demand chưa đo. Resend **đã live** 18/10/2026, nên email fallback không còn bị chặn.

## 9. Câu hỏi mở / quyết định cần founder

1. Có chấp nhận **một** release 1.1 gọn (4–5 person-week) thay vì “hai release tám slice” không? Nếu không, cần thêm người.
2. Ai chịu trách nhiệm bật lại bề mặt AI opt-in và viết lại `NSCameraUsageDescription`? Đây là chặn cứng của #4 và là rủi ro App Review hiện tại.
3. Ưu tiên 2.0: resale handoff hay insurance pack? Không làm cả hai.
4. Có mở Premium cho warranty-card ngay khi ship, hay đợi sheet accuracy? (Đề xuất: đợi.)
5. Chốt sổ migration `0029`–`0033` theo thứ tự nào, và ai giữ nó?
6. Có bật Billing Grace Period trong App Store Connect và đặt ASN URL trước 1.2 không?
7. TGDD: nếu không đọc được policy trong browser, chấp nhận ship NULL và countdown không có cho TGDD chứ?
8. Trả góp: chấp nhận “kế hoạch người dùng khai”, không phải ledger ngân hàng, và không push nhắc trong wave 1?
9. Có cắt e-invoice XML và digest khỏi 90 ngày không? (Đề xuất: có.)
10. Có chấp nhận rằng bản build 23 đang review vẫn hiển thị ngày bảo hành sai đến khi 1.1 phát hành, và chuẩn bị release note cho việc đó?
11. Ai review `checkedAt` của các bảng retailer/store-rule mỗi quý?
12. Có đồng ý bỏ chữ “ledger” khỏi tên tính năng trả góp để không ngụ ý app biết giao dịch ngân hàng?

## 10. Nguồn (nhóm, 36 URL mạnh nhất)

**Pháp lý & quy định VN**
- Điều 30 Luật 19/2023 (sửa chữa, 3 lần, hoàn tiền): https://camnangluat.vn/diem/luat-19-2023-qh15-dieu-30-khoan-2-diem-c/
- Nghị định 254/2026/NĐ-CP (hoá đơn điện tử, hiệu lực 1/7/2026): https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-so-254-2026-nd-cp-ve-hoa-don-dien-tu-chung-tu-dien-tu-119260713164251972.htm
- Quyền truy cập/xoá dữ liệu (PDPL): https://letranlaw.com/practices/data-privacy-personal-data-protection/

**Bảo hành, retailer, brand**
- TGDD 15 ngày sửa: https://www.thegioididong.com/bao-hanh/obaku
- CellphoneS 24h–14 ngày: https://cellphones.com.vn/bieu-phi-bao-hanh-mo-rong
- FPT 1-đổi-1 30 ngày: https://fptshop.com.vn/ho-tro/gioi-thieu-may-doi-tra
- Samsung VN (kích hoạt, giới hạn quốc gia): https://www.samsung.com/vn/support/warranty/
- Sony VN (kích hoạt, +12 tháng promo): https://www.sony.com.vn/support/resources/vi_VN/html/Warranty/Warranty_Information/CSBH2.htm
- Apple VN AppleCare+ fees (799k/2.649k): https://www.apple.com/vn/legal/applecare/fees-deductibles/
- endoflife.date (vòng đời hỗ trợ): https://endoflife.date/api/iphone.json

**Apple / Google platform**
- App Store Server Notifications: https://developer.apple.com/documentation/appstoreservernotifications
- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- ControlWidget: https://developer.apple.com/documentation/swiftui/controlwidget
- Wallet passes: https://developer.apple.com/documentation/walletpasses/showing-a-pass-on-the-lock-screen
- Play Billing RTDN: https://developer.android.com/google/play/billing/rtdn-reference
- Notification permission Android: https://developer.android.com/develop/ui/views/notifications/notification-permission

**Thị trường VN (second-hand, trả góp, giá)**
- Chợ Tốt 48.007 tin, 46,3% Apple: https://vietnambiz.vn/iphone-18-pro-max-vua-mo-ban-loat-iphone-cu-bat-dau-giam-gia-2026930192747431.htm
- FPT ~50% trả góp: https://laodong.vn/cong-nghe/khach-mua-iphone-18-pro-max-chuong-tra-gop-thu-cu-doi-moi-1769692.ldo
- Vietstock 20,9tr: https://vietstock.vn/2026/09/thu-nhap-25-trieu-moi-thang-mat-65-trieu-tra-gop-do-gia-dung-4260-1492424.htm
- TGDD 0% 18 tháng: https://vnexpress.net/the-gioi-di-dong-mo-ban-iphone-18-pro-voi-loat-uu-dai-5121985.html
- CellphoneS S-BuyBack: https://cellphones.com.vn/s-buyback-goi-cam-ket-gia-thu-18-pro-max-15-thang

**Bảo hiểm**
- Bảo Việt nhà tư nhân (cap 50tr/món): https://baovietonline.com.vn/uploads/attachment/to-roi-bao-hiem-bao-hiem-nha-tu-nhan-vi.pdf
- MSIG claim form: https://www.msig.com.vn/sites/default/files/downloads/RCD%20-%20Home%20Insurance%20-%20Claim%20Form%20-2024.pdf

**Benchmark & hành vi (dùng thận trọng)**
- RevenueCat 2026: https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026
- Airship push opt-in: https://www.airship.com/blog/your-guide-to-airships-mobile-app-push-notification-benchmarks-for-2026/
- Appcues onboarding: https://www.appcues.com/blog/product-adoption-benchmarks
- FIDO Passkey Index 2026: https://fidoalliance.org/passkey-index-2026/
- AccessTrade datafeed (chưa xác minh approval): https://developers.accesstrade.vn/api-publisher-vietnamese/lay-thong-tin-datafeeds.md

**Inference (không phải nguồn):** “chưa có app nào làm X”, “nhu cầu hộ gia đình VN cao”, “Android demand thấp” — tất cả là suy luận từ phạm vi tìm kiếm, không phải số đo.

## 11. Phụ lục — các tính năng không vào top 8

**Warranty & claim (mở rộng):** transferability verdict (S, đáng làm cùng claim wave 2); support clock EOL (M, free, làm sau); activation registrar/promo +12 tháng (M, mùa promo); repair intake + component ledger (L, làm cùng wave 2); denial reason + escalation ladder (M, chỉ làm nếu có nguồn policy đã xác minh); 3-repair ledger (S, derive từ claim — làm cùng #1).

**Resale & ownership:** condition passport + buyer inspection (L, 2.0); handoff/transfer record (L, 2.0); quote ledger/TCO (M); condition log pin (M); exit comparison (S, gộp TCO).

**Insurance:** policy fit check (M, đáng thử với 10 hộ trước); pre-loss snapshot + loss event (L); incident lockdown (M, impact 5, có thể là 2.0 thay vì resale); condition baseline (S, làm cùng #4); insurance referral (defer — cần agency contract).

**Subscription & money:** bundle/channel/seat audit (M, ROI cao nếu làm 1 bảng bundle VN); Play Billing (L, sau); Family Sharing premium (S, sau duyệt); win-back (S, sau duyệt); installment (đã ở top); renewal copy (đã ở top).

**Surfaces & capture:** Wallet pass (M — không bị cấm, hoãn vì ưu tiên); Visual Intelligence (M, iOS 26+); Siri add-device (S); offine counter card (M); text scale/reduced motion (M, 1.2); thumbnail (S, quick win); on-device scan (M, prereq #4); share extension URL/PDF (S).

**Trust & reliability:** security timeline/freeze (M); passkeys web (M); readable export (M); erasure receipt (M); reminder health (đã ở top 8); digest (M, defer); AI consent ledger (M — gộp vào điều kiện #4).

**Household:** co-keeper grant (M, defer); shared seats (S, defer); gift reservation (M, Tết 2027); certificate claim (S, 2.0).

**Growth/SEO:** brand warranty term pages (M); return-window calculator (S); subscription true-cost calculator (S); referral (M, defer).

**Adjacent asset classes:** vehicle km ladder (L); vehicle sale 30-day (M); recall watch (S); trip kit (M); portability (M); repair abroad (M); business asset register (L); gear-out ledger (M).

**Documents:** e-invoice XML (defer — chưa có fixture provider, `Store` không có MST, và doc đã từng defer vì thiếu bằng chứng); invoice identity fields (defer cùng lý do); readable export (later).

**Đã loại hẳn:** marketplace scraping, escrow/thanh toán trong app, household account object, tự động hoá form bảo hành của brand, lưu Wi-Fi password, điều khiển smart home.
