# Add one device — friction map (Warrly iOS)

**Scope:** the create path of `DeviceFormView`, from "I bought a phone" to a saved device.
Read-only: no app code was changed; this file is the only thing written.
**Read at:** 2026-11-01, working tree after `a3f0393` ("five form improvements").
**Tags:** `[fact]` = file:line or screenshot. `[judgement]` = my reasoning, arguable.
Anything I could not establish from code is in §8, not smoothed over.

**Screenshots, with vintage.** `qa-five-forms/01-device-form-empty.png` (31 Oct 20:22),
`…/03-device-form-error.png` and `…/05-device-form-next-toolbar.png` (20:23) match the current
code and are the ones quoted below. `…/02-device-form-category.png` is **not** the category
picker — it is the same form launched with `WV_QA_CATEGORY=FRIDGE` (`DeviceFormView.swift:241`);
no shot of the picker sheet exists. `[fact]` `qa-visual/after/01-devices.png` (31 Oct 08:59) is
**older than the form work** — its filter glyph is coral where the code paints it neutral
(`DevicesScreen.swift:269`) — so it is used here for the list only. `[fact]`

---

## 0. The count, before the argument

| | value | how it was counted |
|---|---|---|
| Taps, cold start → device saved | **9** | 3 to open + 6 to fill (§1) |
| … shortest path that still saves | **2** | name + toolbar `Thêm` |
| Field rows drawn on create | **22** | `formBody` |
| Text inputs | **12** | |
| Required fields | **1** — `name` | `isValid`, `DeviceFormView.swift:321-328` |
| Optional fields *marked* optional | **1** of 21 | only Serial/IMEI says "Không bắt buộc", `:1911` |
| Decisions with a stored consequence | **8** | §1, D1–D8 |
| … of those, already answered by a default | **6** | D2, D3, D5, D6, D8 + `leadDays` |
| Screenfuls of form | **≈2.2** | screenshot: 9 of 22 rows fit above the fold |
| Sheets / exits from the flow | 0 phone · 1 sheet non-phone · 1 app exit | §5 |
| Second device of the same kind | **9 taps, 22 rows, 0 saved** | `init` reads only `device:`, `:248-317` |

The 22 rows are: Tên · Hãng (+chips) · Model · Loại · Serial/IMEI (+scan) | Ngày mua · Giá mua
(+currency) · Nơi mua (+chips) · Hạn đổi/trả | Nhắc trước ×3 | Cần kích hoạt · Mua gói mở rộng
trước | Đối chiếu: tra cứu · ghi kết quả | Số tháng · Hãng BH · SĐT BH · Địa chỉ | Ghi chú |
Ghi nhận đã bán. `[fact]`

---

## 1. The walkthrough

| # | what the user does | taps | on screen | stop-and-think |
|---|---|---|---|---|
| 0 | opens the app | 0 | Tổng quan | — |
| 1 | taps **Thiết bị** | 1 | device list | — |
| 2 | taps **+** | 2 | — | — |
| 3 | — | — | dialog "Thêm nhanh": *Thêm thiết bị* / *Thêm nhiều thiết bị* / *Huỷ* | **S1** |
| 4 | taps **Thêm thiết bị** | 3 | form, open on 9 rows | — |
| 5 | types a name | 4 | — | — |
| 6 | taps the **Apple** chip | 5 | 8 brand chips | **S2 · S3** |
| 7 | skips Model, Loại, Serial | — | — | — |
| 8 | skips Ngày mua (today) | — | — | — |
| 9 | types a price | 6 | | |
| 10 | taps the **CellphoneS** chip | 7 | 8 store chips | — |
| 11 | taps **30 ngày** or leaves *Chưa biết* | 8 | 6 pills + "Gợi ý: 30 ngày…" | **S4** |
| 12 | scrolls past six sections | — | Nhắc trước, Bảo hành & kích hoạt, Đối chiếu với hãng, Bảo hành mặc định, Ghi chú, Bán lại | **S5** |
| 13 | taps **Thêm** (toolbar) | 9 | saved → list | — |

D1 which kind of add (dialog) · D2 category · D3 purchase date · D4 currency · D5 return
window · D6 reminder lead days · D7 warranty months · D8 resale. `[judgement]`

- **The save is in the toolbar** (`:1471-1477`), so the ~2 screens of scroll cost *reading*,
  not taps. The user can always finish from where they are. `[fact]`
- The **first device ever** adds one decision after the save: an inline notification primer
  ("Bật thông báo" / "Để sau", `:2266-2271`, `:2310`). Once per install. `[fact]`
- The **dashboard** route is cheaper: `+` on Tổng quan → a 3-row sheet → the form, **2 taps**
  (`DashboardView.swift:136-140`, `:649-698`) versus 3 from the Devices tab, and nothing tells
  the user. `[fact]`

## 2. Work vs friction

**Work the task requires** `[judgement]`: the device name, the price, and — if the user cares
about the IMEI — the serial. Everything the app can *not* know.

**Work the form asks for anyway**: 12 text inputs (`[fact]`), 11 of them optional and unmarked.
Only Serial/IMEI volunteers "Không bắt buộc" (`:1911`), which by implication makes the other 21
rows mandatory. `[judgement]`

**Friction, defined strictly**: a repeated step, a value the app already holds, a decision it
has already made. §4 counts those.

---

## 3. Q1 — Where the user hesitates (named, on screen)

**S1 · the dialog after `+`.** `Thêm nhanh` offers *Thêm thiết bị* and *Thêm nhiều thiết bị*
(`DevicesScreen.swift:299-307`). The dialog exists so a batch add has an entry point on a list
that already has rows. It charges **1 tap and 1 decision to every single-device add** to pay for
a feature used rarely. The title promises speed and delivers a question. `[fact]` `[judgement]`

**S2 · the Hãng chips show the wrong brands on a form that is wrong by default.** The chips are
filtered by `category` (`brandSuggestions`, `:529-531`, via `CatalogStore.brands(matching:
category:)`, `CatalogStore.swift:47-63`), but **Loại sits three rows *below* Hãng** (`:907` vs
`:920`). So the row that decides which chips are right comes after the field it feeds. On the
default PHONE form a user adding a fridge sees ASUS, Apple, HONOR, Huawei, Nokia, OPPO — and
the chips only self-correct after they have already typed a brand. `[fact]`

**S3 · the chips are alphabetical, so the most common brand is off-screen.** Brands arrive
`ORDER BY name ASC` (`api/internal/store/queries/catalog.sql:22`) and the view takes `.prefix(8)`
(`:530`). In `01-device-form-empty.png` the row reads *ASUS · Apple · HONOR · Huawei · Nokia ·
OPPO* with OPPO's capsule cut at the right edge; **Samsung** — seeded second
(`api/migrations/0008_seed_brand_store_warranty_provider.sql:69`) — sorts 7th and is not on the
screen at all, so it costs a swipe or eight typed characters. `[fact]`

**S4 · "Hạn đổi/trả" asks a shop-policy question and defaults to no answer.** Six pills
(`DeviceReturnWindow.swift:133-140`), *Chưa biết* preselected (`:289`), and a caption the app
computed itself — "Gợi ý: 30 ngày cho Điện thoại" (`:650-655`) — that the user must tap a *second*
time to accept. Leaving it alone is not free: the API derives `RETURN_WINDOW_UNKNOWN` into
"Việc cần xử lý" (`WarrlyKit/ActionQueue.swift:296-299`), so the form's own default creates the
to-do that sends the user back to this row. `[fact]`

**S5 · the sections that get skipped are drawn in full.** Nhắc trước is 3 rows with a
`Đã chọn 2/5` counter, 6 preset chips and a custom-day field, plus a red "Chọn ít nhất 1 mốc
nhắc" when empty (`LeadDaysSection.swift:35-44`, `:80-86`) — it reads as a required question on
a form where nothing else is required, and its value is 100% defaulted (`[30,7]`, `:281-283`).
After it: Bảo hành & kích hoạt (2), Đối chiếu với hãng (2 rows + an external link),
Bảo hành mặc định (4), Bán lại (1). **Eight rows plus four headers and four footers that a new
device never needs**, between the last useful field and the end. `[fact]`

**Also visible, smaller:** `Huỷ` asks "Bỏ thay đổi?" on a pristine form — no dirty check
(`:1459`, `:1508-1513`) — while the back chevron **beside it** in the same screenshot discards
silently. Two exits, two rules. `[fact]`

## 4. Q2 — What the app already knows and makes the user type

1. **The user's whole device list, in scope, unread.** The form holds `store: DevicesStore`
   (`:18`) and uses it only to create (`:2240`) — it never reads `store.devices`. So the brand,
   store, category and warranty length this person used last time are in memory on every open
   and discarded. `[fact]`
2. **The return window.** `DeviceReturnWindow.suggestedDays(forCategory:)` is already called to
   *print* the suggestion (`:650-655`, `DeviceReturnWindow.swift:142-166`) and deliberately not
   applied (`:142-146`). The app computes the answer, shows it, and waits for a tap. `[fact]`
3. **The provider catalogue is decoded and unused here.** `catalog.warrantyProviders` exists
   (`CatalogStore.swift:70`) and is wired to the *same* field on the warranty form
   (`WarrantyFormView.swift:187`), but on create "Hãng BH" is a bare free-text row
   (`:1239-1242`). One tap versus typing a provider name that the catalogue already spells. `[fact]`
4. **The brand→category map is used one way only.** `BrandOption.categoryCodes` filters brands
   by category (`CatalogStore.swift:54-59`); the inverse — this brand usually belongs to this
   category, so default the picker — is never read. `[fact]` And the "repeated value" idea has
   already shipped in the *other* form: `BulkDeviceAddView` states that "a new row inherits the
   previous row's purchase date" (`BulkDeviceAddView.swift:19-21`). The single form has no
   equivalent for the values that actually repeat — store, brand, category. `[fact]`

**So: 3 fields the app holds the data for** (Nơi mua, Hãng BH, Hạn đổi/trả) **and 1 it
hardcodes and could tune** (Số tháng, fixed `"12"` at `:271`, wrong for most appliances).
Everything else it asks for is genuinely the user's to supply. `[judgement]`

## 5. Q3 — When it fails

- **Field rejection.** Banner + the server's own sentence under the offending row + scroll to
  top (`:764-773`, `FormErrorCopy` at `Components.swift:1370-1438`). Photographed in
  `03-device-form-error.png`: "Dữ liệu không hợp lệ" over "Tên thiết bị bắt buộc". Fixed in
  `a3f0393`; nothing to add. `[fact]`
- **Offline, before the form.** `CatalogStore.loadForce` swallows the error (`CatalogStore.swift:39-42`),
  so the failure is silent: the brand and store chip rows **disappear entirely** and the category
  sheet falls back to a hardcoded 11-code list (`:2439-2451`) missing **AC, APPLIANCE, CAMERA,
  ELECTRONICS, FURNITURE, KEYBOARD, KITCHEN, MONITOR, MOUSE**. A user offline cannot file an air
  conditioner as one — they must pick OTHER, and nothing says why. `[fact]`
- **Offline, on save.** "Không kết nối được máy chủ… chưa có gì được lưu", draft kept, toolbar
  `Thêm` one tap away (`Components.swift:1427-1431`). Good. `[fact]`
- **Save "succeeds but flags."** A duplicate serial or a failed IMEI checksum still **creates the
  device**, keeps the screen open and swaps the CTA for `Xong` (`:2259-2275`). Correct behaviour,
  but one more stop the first tap did not predict. `[fact]`
- **Quota.** `LIMIT_REACHED` names 50 / 500 in the same banner (`:2282-2286`). `[fact]`
- **Second attempt.** Everything typed survives; nothing is persisted outside the view, so a
  relaunch loses the form — and "Đối chiếu với hãng" opens Safari
  (`BrandWarrantySection.swift:227`), i.e. the app can be backgrounded mid-form by the form's own
  button. `[fact]`

## 6. The second device

**Nothing differs.** `init` reads only `device:` (`:248-317`); there is no `@AppStorage`, no
"last used", no recent list in the feature (`[fact]`: no AppStorage/UserDefaults under
Features/Devices). The second iPhone costs the same 3 + 6 taps, the same 22 rows and the same
8 decisions as the first — while `store.devices` already holds the previous device's brand,
store and category. `[fact]` Repetition is acknowledged only in the *batch* form, and only for
the date; a user entering a second similar device is routed to a form built for a first one.
`[judgement]`

---

## 7. The three changes, ranked by friction removed

Estimates below are `[judgement]`; the counts they rest on are `[fact]`. None changes a token,
colour, radius or type role (`WARRLY-visual-direction.md` §2–§5) or any of the four things §9
pins. **The AI-shaped options I am not proposing**: image/text parsing is already analysed and
prioritised in `WARRLY-ai-input-analysis.md` §2 and §6, and re-proposing it wastes the owner's
time. One observation only, since it is a fact about *this* flow: the "Quét hoá đơn" strip — the
one affordance that fills 11 fields — is drawn only when `aiEnabled` (`:811-899`), off by
default, so the 22-row manual form is the default path. `[fact]`

### 1. Take the four sections a new device never needs out of **create**

Keep them in the edit form. On create, Nhắc trước (3 rows), Bảo hành & kích hoạt (2), Đối chiếu
với hãng (2), Bán lại (1) are decisions for a device that has no history yet; each is editable
afterwards from the detail screen, which already renders all four (activation `DeviceDetailView.swift:441`,
brand warranty `:315`, lead days read-only `:466`, resale read-only `:477`). Shave "Bảo hành mặc
định" from 4 rows to 2 (Số tháng + provider chips). Create still sends the same defaults it sends
today (`:2225-2232`), so the payload does not change.
**Saves: 10 of 22 rows, 4 of 8 decisions, 4 headers + 4 footers of copy, and the one control that
leaves the app — on every add, for every user.** `[judgement]`
**Cost:** a non-default reminder schedule can no longer be set *at create* (2 taps later). This is
the change most likely to read as a redesign; it is a deletion, not a new pattern — owner's call.

### 2. Start the form from what it already knows

(a) pre-select the return window the app already computes and tag it as a suggestion
(`:650-655` → the `30 ngày` pill, still one tap to change); (b) put the `WarrantyProvider`
catalogue behind "Hãng BH" as chips (`CatalogStore.swift:70`, precedent `WarrantyFormView.swift:187`);
(c) order the brand and store chips by this account's own usage instead of `ORDER BY name`
(`catalog.sql:22`), which puts Samsung and CellphoneS first instead of behind a swipe.
**Saves: 1 tap + 1 decision per device on the pill; 1 tap instead of typing for the provider; ~1
swipe or ~8 characters on the most common brand; and it stops the form's default from creating a
`RETURN_WINDOW_UNKNOWN` to-do that points back at the form.** `[judgement]`
**Cost / risk:** the return window is a shop-policy fact and the data model deliberately treats
`nil` as "chưa biết" (`DeviceReturnWindow.swift:29-32`). Pre-selecting is a product decision, not
a bug fix — it must stay visibly a suggestion, and it is the one item here that needs the owner's
sign-off rather than a patch.

### 3. Put "Loại" above "Hãng", and default it from the last device

The picker is 20 rows, one tap, no search (`:2489-2532`); 19 of 20 categories are wrong on the
default form. Moving it above Hãng makes the chips right at the moment they are read, and a
default from `store.devices.last?.category` makes the common case zero taps.
**Saves: 2 taps + a 20-row sheet for every non-phone add, and removes the "why is ASUS first"
stop entirely.** `[judgement]`

**Not in the top three, for honesty:** the `+` dialog's extra tap (§3 S1) is only 1 tap and can
only be removed by re-homing batch add, which is a navigation change, not a form change.

---

## 8. What I could not tell from the code

- **Which rows people actually fill.** No telemetry exists in this repo, so "most users skip
  Bán lại" is my inference from the data model, not a measurement. `[judgement]`
- **Whether the scroll is felt, and what the keyboard does down there.** I count rows and
  estimate ~2.2 screenfuls from the screenshot, but I have not watched a person scroll it;
  `05-device-form-next-toolbar.png` catches the keyboard over a first-run QuickPath tutorial, so
  it cannot show whether the notes field is auto-scrolled into view.
- **Whether the category picker's 20 rows are searched or scanned.** No screenshot of the sheet
  exists; the code has no search field (`:2489-2532`).
- **Whether the catalog is usually warm.** `loadIfNeeded` runs in `.task` (`:1514`) and the
  devices list does not pre-warm it, so on a slow network the chips may be absent for the first
  seconds and nothing says so.
- **The owner's six original reports** exist only in the `a3f0393` commit message; they are fixed,
  so every count here comes from the current tree rather than from his description. `[fact]`
