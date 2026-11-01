# Never miss a warranty deadline — iOS task walkthrough

**Core task:** open Warrly, make it able to remind me before a warranty expires, and have that reminder reach me.
**Scope:** iOS only. Read-only; no app code was changed.
**Evidence:** working tree at `a3f0393` (2026-11-01 05:43 +0700), read 2026-11-01 05:50–06:10 ICT.
**Screenshot vintage — stated because it matters:** `ios/build/qa-five-forms/` is 31 Oct 20:22 and shows the current form. `ios/build/qa-visual/after/` is 31 Oct 08:59–09:20, i.e. **before** the 09:50 commit that fixed the Settings notification rows (`3b1733b`), so `after/07-settings.png` shows a bug the current code has already fixed: two rows both reading "Bật thông báo". I quote it only for what it still shows correctly (the "Chưa bật" chip, the section order). `qa-visual/login/` is irrelevant to this task and was not used.
**Tagging:** `[fact]` = readable at the cited `file:line` or in the named screenshot. `[judgement]` = my reasoning. §8 lists what I could not establish.

Paths are repo-relative; `DeviceFormView.swift` = `ios/App/Features/Devices/DeviceFormView.swift`.

---

## 1. The count

| | Count | Backed by |
|---|---|---|
| App screens | 3 | Tổng quan → "Thêm nhanh" sheet → `Thiết bị mới` form |
| System surfaces | 1 | notification permission alert |
| **Taps to a remindable first device** | **6** (5 in-app + 1 system) | §2, steps 1–6 |
| Taps to a device that can **never** be reminded | 5 | step 7's "Bật thông báo" replaced by "Để sau" |
| Fields that must be typed | **1** (Tên) | `DeviceFormView.swift:321-326` — validity is name + lead days + rate |
| Inputs above the deadline field | 12 always present, +4 conditional | `DeviceFormView.swift:903`–`1200` vs `:1224` |
| Decisions the app asks | **1** (notifications) | `:2326`–`:2331` |
| Decisions the app makes silently | **2** | purchase date = today (`:253`), term = 12 months (`:271`) |
| Times the user leaves the flow | 1 | the system alert, at the very end |
| Taps + scrolls to recover a declined reminder | 4 taps + 1 scroll | §3 H1 |

The first device's deadline is created entirely by defaults: `Ngày mua` = today (`DeviceFormView.swift:253`), `Số tháng` = "12" (`:271`), `Nhắc trước` = 30 and 7 days (`LeadDaysRules.swift:50`). So the count above is the *whole* task — and the two numbers that actually decide the deadline are never confirmed or displayed.

---

## 2. The walkthrough, in order

**Intent.** "My phone's warranty runs out soon; I don't want to find out after it does."
**Outcome.** A device row exists with an end date, a lead schedule, and a delivery path. Measured at the last of those three.

1. **Tap "＋" on Tổng quan** — 1 tap. `DashboardView.swift:135-140`. `[fact]` The dashboard's lead card (screenshot `qa-visual/after/03-dashboard.png`: "Bảo hành / Apple Watch Series 11 / còn 18 ngày / Hết hạn 18/11/2026") is the thing that brought the user here.
2. **Tap "Thiết bị" in "Thêm nhanh"** — 2 taps. `DashboardView.swift:142-146`, sheet rows at `:627-638`. It is a sheet with three rows, so the device form is not one tap away even though the intent is unambiguous. `[fact]`
3. **Tap the "Tên" field** — 3 taps. `DeviceFormView.swift:903`. Everything else on the first screen (Hãng, Model, Loại, Serial, Ngày mua, Giá mua, Nơi mua) is optional or prefilled. Screenshot `qa-five-forms/01-device-form-empty.png` shows that entire screen contains **no** warranty or reminder control. `[fact]`
4. **Type a name** — work the task requires, not friction. `[judgement]`
5. **Tap "Thêm" in the nav bar** — 4 taps. `DeviceFormView.swift:1471`. Enabled with one typed field. The nav bar is fixed, so **the save is reachable without ever scrolling past the deadline field**. `[fact]` The form's own layout lets the user save before reaching the only input that creates a deadline. `[judgement]` That is the structural problem this task inherits.
6. **The primer card appears at the top of the saved form** — "Đã lưu thiết bị" + "Bật nhắc nhở để Warrly báo trước khi hết bảo hành…" + two buttons (`DeviceFormView.swift:2310-2334`). The form has already scrolled to the top to show it (`:764-772`). `[fact]`
7. **Tap "Bật thông báo"** — 5 taps. Then the system alert. **Tap "Allow"** — 6 taps. `PushRegistrar.swift:96-125`. `[fact]`

To reach the deadline input on foot instead: it is at `DeviceFormView.swift:1224`, below 12 always-present inputs and three sections that are not the deadline itself (`Nhắc trước`, `Bảo hành & kích hoạt`, `Đối chiếu với hãng`). `[fact]`

**Is "after the first device save" the right moment?** In principle yes: it is the first moment the app owns something worth reminding about, and it deliberately does not stack on the ads-consent prompts (`PushRegistrar.swift:32-39`, `:59-69`; the call site is `DeviceFormView.swift:2262-2272`). In practice the moment is undermined three ways. `[judgement]` over the following facts:

- **The answer is treated as final.** Once offered, the flag is set even if the user taps "Để sau" (`PushRegistrar.swift:70-78`), so the moment is only as good as the escape hatch behind it — and there is none (H1/H2). A right moment with an unrecoverable answer is worse than a wrong moment with one.
- **The same call is made where the premise is false.** After a bulk create the app asks the identical question (`BulkDeviceAddView.swift:681-687`) for rows that carry `warrantyMonths = 0` (`BulkDevices.swift:171-172`) — there is nothing a reminder could ever fire on.
- **It is deferred without saying so when the create trips a serial advisory.** The offer only runs when `warnings.isEmpty` (`DeviceFormView.swift:2266-2272`), and the flag is not consumed there, so the question simply waits for a later create — possibly weeks, possibly never.

---

## 3. Q1 — where a real person stops

**H1 · "Để sau", next to "Bật thông báo".** `DeviceFormView.swift:2326-2331`. Two small buttons side by side, one primary one secondary, and the secondary one **dismisses the sheet** — so it reads as "done", not as "never ask me again". It calls `finishAfterPrimer()` (`:2355`), and the offer flag was already written when the card was *shown*, not when permission was granted (`PushRegistrar.swift:44-49`, `:76`; `PushRouting.swift:112-121`). After that tap the app never offers again and never states that reminders are off. `[fact]` The only routes back are the Settings row (H2) or granting it in iOS Settings by hand, which `refreshIfAlreadyAuthorized` picks up on the next launch (`PushRegistrar.swift:129-142`). `[fact]` This is the hesitation that costs the product its promise, and it is one tap wide. `[judgement]`
Recovery, if the user thinks of it at all: **Thêm tab → Cài đặt → scroll to "Nhắc nhở" → "Bật thông báo" → Allow** = 4 taps + 1 scroll (`MoreScreen.swift:294-315`, `SettingsView.swift:214-215`, `:481-537`). No screen sends the user there `[judgement]` — no `push.` read exists outside `SettingsView` `[fact]`

**H2 · The Settings row that cannot do what its label says.** On `.denied`, `pushButtonLabel` returns "Mở Cài đặt iOS để bật" (`SettingsView.swift:651`) and the row's action is `push.requestAndRegister()` (`:507`), which returns immediately at `PushRegistrar.swift:106-108` without prompting and without opening anything. It is not disabled either (`:657-662`). So the one control the user is told will fix it does nothing, and the only working route is the iOS Settings app by hand. `[fact]` The app already has the right implementation for the camera (`DeviceFormView.swift:1610-1615`, `UIApplication.openSettingsURLString`) — it is simply not used here. `[fact]`

**H3 · "Nhắc trước" is asked before the deadline exists.** The lead-time editor (`DeviceFormView.swift:1183`, `LeadDaysSection.swift`) sits **above** "Bảo hành mặc định" (`:1216`), i.e. above the only field that creates an end date on this screen. The footer explains "Chọn 1–5 mốc nhắc, mỗi mốc từ 0 đến 365 ngày" (`LeadDaysSection.swift:36`) without saying 30 days before *what*. `[fact]` A user who reads it as "how often" rather than "how far ahead" has no way to check until the device is saved. `[judgement]`

**H4 · "Số tháng" shows no result.** `DeviceFormView.swift:1224`. Fill it in and nothing on the screen tells you the date you just created. The other form that writes the same warranty **does** show it: `WarrantyFormView.swift:344-346` renders "Ngày kết thúc (dự kiến)" from `WarrantyFormRules.endDate`, with the note "máy chủ sẽ lưu đúng ngày này". `[fact]` Same field, same math, opposite feedback — and the form without it is the one everybody sees first. `[judgement]`

**H5 · The number cannot be corrected where it was typed.** The whole "Bảo hành mặc định" section is create-mode only (`:1216`), and on edit `input.warrantyMonths = 0` (`:2229-2231`). To change 12 to 24 the user must go **Thiết bị → device → warranty list row → `WarrantyFormView` → "Số tháng" → Lưu** = 4 taps + 1 scroll (`DeviceDetailView.swift:869-874`, `:644-651`), into a screen the create form never named. `[fact]`

**H6 · The row that says "Tuỳ chỉnh" and does nothing.** `SettingsView.swift:534-537`: icon "clock", title "Nhắc trước", subtitle "Theo từng thiết bị / gói", detail "Tuỳ chỉnh" — a `WVRow` with no action and no chevron. It is where a user who wants to change their reminder schedule will tap first, and it is inert by design (`:530-533`). `[fact]`

---

## 4. Q2 — what the app already knows and does not use

This is the weakest of the three questions for *this* task, and that is worth saying plainly rather than padding it: almost nothing is retyped, because the defaults do the typing. The waste is in **facts the app holds and never shows**:

- **K1 · The permission state.** `PushRegistrar.status` is refreshed on every authenticated launch (`WarrlyApp.swift:71`, `PushRegistrar.swift:129-142`). It is read only inside Settings — three switch sites (`SettingsView.swift:634`, `:649`, `:660`) plus the disabled check at `:657`. The dashboard lead card, the reminders screen and the device detail all know nothing about it. So the app can be looking at a countdown it will never interrupt the user about, and say nothing. `[fact]`
- **K2 · The computed end date.** It exists in the Kit (`WarrantyFormRules.swift:84-91`) and in the server (`api/internal/services/devices.go:1058-1059`, `addMonths`). The device form neither calls nor displays it. `[fact]`
- **K3 · The language the user is reading.** The UI follows the device language by default (`LocalizationStore.swift:63-66`), but `User.locale` is only written when the user opens Settings → Ngôn ngữ (`:127-139`; `api/migrations/0014_user_locale.sql:19-24`). The cron has no request to read, so it falls back to `i18n.Default`, which is English (`api/internal/i18n/i18n.go:57`, `api/internal/cron/run.go:100-112`). A brand-new Vietnamese user on the default "Theo thiết bị" therefore runs a Vietnamese app that sends **English** reminders. `[fact]`

---

## 5. What the reminder actually says

Server-composed, one per lead day, sent by the daily cron. `[fact]`

- **Title:** "BH %s của \"%s\" sắp hết trong %d ngày" → e.g. *BH Tiêu chuẩn của "iPhone 16 Pro" sắp hết trong 7 ngày*. EN: "%s warranty for \"%s\" expires in %d days". (`api/internal/cron/run.go:400-406`; `api/internal/i18n/catalog.go:181-193`)
- **Body:** "Hết hạn: 19/10/2026 • Apple Việt Nam" — the date plus the provider, nothing to do. (`run.go:396-400`, `:407`)
- **Routing:** `url: /devices/<id>` (`run.go:408`), so a tap opens the device detail (`PushRouting.swift:64-76`; `AppDelegate.swift:49-74`). That is the whole post-tap payload. `[fact]`
- **When:** once a day at 02:00 UTC = 09:00 Hanoi, fixed for everybody (`deploy/systemd/warranty-vault-cron.timer:25`). `[fact]`
- **Day 0 reads wrong.** Lead day 0 is offered as a one-tap preset and explained as "Mốc 0 là nhắc đúng ngày hết hạn" (`LeadDaysSection.swift:36`, `LeadDaysRules.swift:57`), but the title is built by `renderCount`, which only singularises `1` (`run.go:152-157`). At day 0 the user gets **"sắp hết trong 0 ngày"** / "expires in 0 days". `[fact]`

---

## 6. Q3 — what happens when it fails

**Answer to the owner's question: yes — five distinct paths, all silent.** F1 (rationale declined), F2 (system prompt denied), F3 (no warranty row), F4 (bulk rows, same hole), F5 (warranty shorter than every lead day). F6 then makes the miss invisible to the server as well. `[fact]` for each path; `[judgement]` that they exhaust the set — I found no sixth in the client, the cron or the action queue.

- **F1 · Declined at the rationale.** Silent. The card is replaced by `dismiss()` (`DeviceFormView.swift:2355-2357`), no banner, no state change, no second offer ever (flag set at offer time). `[fact]` The user now believes they are covered.
- **F2 · Denied at the system alert.** Same silence (`PushRegistrar.swift:112-113` → `dismiss()`), plus the dead Settings row of H2. `[fact]`
- **F3 · No warranty row at all.** `createDeviceWithWarranty` writes a warranty only when `warrantyMonths > 0` (`api/internal/services/devices.go:1058`), so a device saved with the term cleared has **no end date and can never produce a reminder**. The only trace is a `DEVICE_NO_WARRANTY` action item in "Việc cần xử lý" (`api/internal/services/actions.go:517-530`). `[fact]`
- **F4 · Bulk add creates the same hole, at scale.** Bulk rows ship `warrantyMonths = 0` (`ios/Sources/WarrlyKit/BulkDevices.swift:171-172`) and then the screen asks "Bật nhắc nhở?" (`BulkDeviceAddView.swift:681-687`) — permission requested in service of devices that cannot remind. `[fact]` Every bulk-added device is a device the user thinks is tracked. `[judgement]`
- **F5 · A warranty shorter than the schedule.** Each lead day matches one calendar day only (`run.go:352-380`). With the default [30, 7], a warranty ending in **under 7 days** falls in no window and **never produces a push at all** — not late, not once. The form accepts any term without a word. `[fact]`
- **F6 · Delivery failure is recorded as success.** `StampWarrantyNotified` runs after `dispatch()` regardless of what `dispatch` did (`run.go:422-429` vs `:295-325`); a user with zero push subscriptions sends nothing and still gets the per-lead-day stamp. There is no retry and no user-visible record — the reminders feed is derived from the warranty dates, not from deliveries. `[fact]`
- **Second attempt.** For permission: none in-app (F1/F2). For the reminder itself: the next lead day, if one is still in the future. If the warranty was already inside the shortest lead day, there is no second attempt. `[judgement]` over the above facts.
- **Empty state claims safety it cannot know.** With a loaded empty reminder feed the screen reads "Không có nhắc nào, ngon!" / "Tất cả gói bảo hành đều an toàn." (`RemindersView.swift:108-112`) — shown equally to a user with three unwarranted devices and notifications off. "All warranty packages are safe" is vacuously true and materially misleading. `[fact]` + `[judgement]`
- **The in-app net still catches it.** The deadline appears on the dashboard card, the devices list and the reminders feed whether or not a push was ever sent (`DashboardView.swift:274-340`, `RemindersView.swift:343-360`). So the promise fails **only for the user who is not looking at the app** — which is the entire point of a reminder. `[judgement]`

---

## 7. Three changes, ranked

### 1. Put "reminders cannot reach you" on the deadline surfaces — and make the Settings fix real

Where: the dashboard lead card (`DashboardView.swift:340-344`) and the reminders screen header (`RemindersView.swift:115-126`), reading the `push.status` already in memory (K1); plus `SettingsView.swift:507` calling the camera's `openSettingsURLString` path (`DeviceFormView.swift:1613`) when `.denied`.
Why first: it is the only failure in this report that is both **invisible** and **permanent** (F1/F2), and the app already has every fact needed to state it. It is a state line and a three-line fix, not a new surface — no new card, no new pattern, nothing §9 of `WARRLY-visual-direction.md` protects is touched. `[judgement]`
Saves: recovery goes from 4 taps + a scroll + knowing where to look → 1 tap from the screen that is already showing the countdown; the `.denied` row stops being a dead end. Exposure removed: every user who taps "Để sau" — the one who is in a hurry at the exact moment the product asks — would at least see that nothing will remind them. `[judgement]`

### 2. Make the deadline visible where it is created, and refuse a schedule that cannot fire

Where: (a) a "Hết hạn dự kiến" line under `Số tháng` in `DeviceFormView.swift:1216-1230`, rendering `WarrantyFormRules.endDate` — the identical row `WarrantyFormView.swift:344-346` already ships; (b) when the resulting end date is nearer than the largest selected lead day, either drop the dead chip or say so, because F5 is a reminder that can never arrive; (c) one "số tháng cho cả lô" input on the bulk sheet so a bulk device gets a deadline, or drop the "Bật nhắc nhở?" alert there (`BulkDeviceAddView.swift:681`).
Why second: the deadline is currently two invisible defaults (K2) and the user's only way to check is to leave the form, save, and open a different screen. Showing the date costs **0 taps** and converts an assumption into a check.
Saves: for the common "I'm adding the phone I bought last Tết" case, the 12-month default from *today* produces an expiry ~10 months later than the truth — no reminder in the real window and no warning. `[judgement]` on the frequency; the defaults themselves are `[fact]` (`:253`, `:271`). F5 is saved outright for short warranties; F3/F4 for bulk.

### 3. Make the reminder arrive in the language the user is reading, and say a true sentence on day 0

Where: (a) close K3. `WARRLY-visual-direction.md` §9.9 says artifacts — push included — are Vietnamese; the code instead sends the user's stored language and falls back to English when none is stored. Pick one and make the fallback agree with it: either store the device language at first launch so `User.locale` is never NULL, or make the cron's fallback Vietnamese. Today it is neither, so the default Vietnamese install gets English. (b) a `0` branch so lead day 0 says "hết hạn hôm nay" instead of "trong 0 ngày" (`run.go:400-406`; the preset is explained at `LeadDaysSection.swift:36`).
Why third: it does not change how many steps there are, only whether the step lands. It is third because it costs the user comprehension, not the reminder itself.
Saves: the one artifact read at arm's length becomes legible to the majority-language user by default; removes a nonsense sentence from the most urgent lead day, the one people actually choose. `[judgement]`

**Not proposed, deliberately:** per-user reminder time-of-day, a second schedule, any new card or banner pattern, or anything AI-shaped. `docs/handoff/WARRLY-ai-input-analysis.md` §6 already ranks the input-side work, and its receipt schema does extract `warrantyMonths` (§1.1) — so OCR can already fill the term; what it cannot do is confirm it, which is change 2(a).

---

## 8. What the code could not tell me

- **Whether a reminder actually arrives.** I did not run the app against APNs or the cron; every delivery claim above is read from `run.go` / `push/*` / `PushRegistrar`, not observed. Whether a given device token is live is outside the code.
- **How often the "Để sau" tap happens.** No telemetry in the repo. The ranking of change 1 rests on the shape of the failure, not on a measured rate.
- **Scroll distance in screens, not points.** I counted rows and control order (`:903`–`:1224`), not rendered heights; the "below the fold" claims are from the screenshot plus row order, and a 6.7" device shows more of the form than the 16 Pro in `qa-five-forms/`.
- **Whether `after/07-settings.png` still matches the current rows.** It predates `3b1733b` by 33 minutes; I used it only for the "Chưa bật" chip, the section order and the inert-row shape, all of which the current code at `:481-537` still produces.
- **The registered-push-devices list.** `PushDevicesView.swift:35-38` has a "Chưa có thiết bị nào đăng ký" empty state, which is the one place the app admits no device is registered — but it is two taps deeper than the row of H2 and I could not confirm how it presents a *zero-registration* account without a device to test against.
