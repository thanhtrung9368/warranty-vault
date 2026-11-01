# UX friction — the warranty claim (iOS)

**Task walked:** "my phone screen cracked" → a filed claim. The moment the product exists for.
**Outcome counted:** a `Claim` row on the server with a non-empty `issue` — the only field the user has
to supply (`openapi.yaml:4341-4343`, `ios/Sources/WarrlyKit/ClaimRules.swift:276-285`).

**Evidence.** Repo `warranty-vault` at `79b600a` (2026-11-01 05:43 +07, clean tree). iOS read at file
level; screenshots read as images. `[fact]` = file:line or screenshot; `[judgement]` = my reasoning over
those facts. Anything I could not establish is in §8, not smoothed over.

## 0. The answer, before the detail

Filing a claim works, in six taps and about a screen and a half of scrolling. What does not work is the
**second record**: the app asks the user to declare the device broken — a separate, half-hidden write at
the bottom of the same screen — and that declaration is the only thing that makes the repair affordance
visible, while filing a claim never sets it, closing a claim never clears it, and a broken device
silently stops receiving warranty-expiry reminders. One event, two records, no direction of update.

**Counted:** **6 taps** minimum, **12–14** complete · **4 screens** · **11 fields** (**1 required**) ·
**18 controls** · **7 hesitation points**, 6 app-caused · **5 places** holding the 6 things needed at the
counter.

### Screenshot vintage — the brief's picture is incomplete

There is a **fourth folder** the brief does not name: `ios/build/qa-claims/` (30 Oct 10:31–11:33), the
only folder containing claim screens. `[fact]` Ages: `qa-claims/` (30 Oct 10:31–11:33) →
`qa-visual/after/` (31 Oct 08:59–09:20) → `qa-visual/login/` (31 Oct 14:19) → `qa-five-forms/`
(31 Oct 20:22–20:23, the only one matching current code).

All three claim views were last modified **31 Oct 09:50** (`3b1733b`), after `qa-claims` and after
`qa-visual/after`. `[fact]` So **every claim screenshot predates the code in this report**, and
`ClaimFormView` (717 lines, the only create path) has **never been photographed at all** — the nine
shots in `qa-five-forms/` are the device form. Quotable: the *device detail*
(`qa-visual/after/02-device-detail.png`) for the disclosure's placement, and
(`qa-claims/shots/claim-row-device-default.png`) for the row. Field geometry below is summed from
component minima (44 pt rows + 14 pt padding), `[judgement]`, not measured.

## 1. What must be in hand, and where the app keeps it

The app's own pre-service checklist (20 items, `ServiceChecklist.swift`) is the authority on what the
counter asks for. Six things matter, and the claim form holds **two**:

| You need | Where the app keeps it | In the claim? |
|---|---|---|
| Serial/IMEI | `Mua hàng` group — `DeviceDetailView.swift:431-433` | no (stays on the device) |
| Invoice / receipt | `File đính kèm` — `DeviceDetailView.swift:274-277` | **no — the claim has no attachments at all** |
| Warranty end + legal extension | hero and warranty card — `:123-133` | no |
| Where to take it / phone | `Liên hệ bảo hành`, `Đi bảo hành ở đâu` — `:335-356`, `:375` | **name only, retyped** |
| Ticket number | the paper in hand | **yes** — `ticketNumber` |
| Promised return date | the paper in hand | **yes** — `expectedReturnAt` |

So **five places on one screen** (hero, attachments, claim section, contact/directory block, purchase
group) plus two sheets. The one screen that *should* be the counter answer — the checklist — is the 7th
block of a collapsed disclosure, its ticks are in-memory only, and it cannot file anything. `[fact]`
(`DeviceDetailView.swift:362-370`; `ServiceChecklist.swift:22-27`)

**Work vs friction.** The ticket number and the promised date are *work*: they exist only on paper.
The shop name is *friction*: the app holds it (§4 K0). Whether to declare the device broken is
*friction*: it is the app's bookkeeping, not a fact about the world (§3 H3).

## 2. The walkthrough, counted

Minimum path — device already in the app, no claim, cold launch:

| # | The user does | Element | Taps |
|---|---|---|---|
| 1 | Opens the app | lands on **Tổng quan**, always (`RootView.swift:203,224`) | — |
| 2 | Switches tab | `Thiết bị` (`RootView.swift:238`) | 1 |
| 3 | Finds and opens the phone | device row (`DevicesScreen.swift:653`) | 1 |
| 4 | Opens | `Bảo hành & sửa chữa` disclosure, **collapsed by default** (`DeviceDetailView.swift:287-292`) | 1 |
| 5 | Scrolls past warranty cards + brand lookup | inside the disclosure (`:295-324`) | — |
| 6 | Taps | `+ Thêm lần sửa chữa` (`ClaimsSection.swift:123-126`) | 1 |
| 7 | Taps `Mô tả lỗi`, types one sentence | the only required field (`ClaimFormView.swift:352-355`) | 1 |
| 8 | Taps `Lưu` | toolbar (`:159`), or the duplicate body button (`:424`) | 1 |

**6 taps, 4 screens, 2–4 swipes, 2 scroll journeys, 1 field typed of 11 offered.**

A *complete* claim — ticket, shop, promised date, package — adds 6–8 taps in the sheet (`:338` shop,
`:322` ticket, `:252` toggle + `:260` date, `:291` package) for **12–14 taps**. `[judgement]` on the
count; every control is `[fact]`.

**What leaves the flow.** Filing stays inside one sheet — good. The other half does not: adding the
intake-slip photo means the sheet auto-dismisses on save (`ClaimFormView.swift:623`), then scrolling
**up** to `File đính kèm` for a picker — a second journey over the same screen in the opposite direction,
where the 5-file cap is per device and shared with the invoice (`services/attachments.go:27`), so the
slip the checklist says to photograph may have nowhere to go.

**Controls: 18** — 2 toolbar, 5 status chips, 2 date controls, 1 package menu, 5 text fields, 1 money
field, 1 tri-state segmented, 1 body save. Two of them (`Lưu` and `Thêm lần sửa chữa`) do the same thing,
which no other form in the app does (`WarrantyFormView` has only the toolbar save). `[fact]` Counted, not
friction.

## 3. Where the user hesitates

- **H1 — the launch screen says nothing.** The Dashboard is deadline-fed: warranties inside the reminder
  window, subscriptions, wishlist (`DashboardView.swift:216-240`). A phone with 324 days left
  (`qa-visual/after/02-device-detail.png`) is not a deadline, so "my phone cracked" has no answer at
  launch. No repair entry there, and **nothing targets a claim**: `PushRouting.swift:31-33` knows three
  destinations — device, subscription, wishlist — and no push or deep link adds a fourth. *App-caused.*
- **H2 — three surfaces share two names.** The disclosure is `Bảo hành & sửa chữa`
  (`DeviceDetailView.swift:288`); the section inside it is `Sửa chữa & bảo hành` (`ClaimsSection.swift:68`);
  the cross-device screen is `Sửa chữa & bảo hành` again (`:458`). The user taps one and is read at by a
  near-anagram of it, whose subtitle is five nouns with repairs third. *App-caused.*
- **H3 — "do I have to mark it Hỏng?"** The status control sits at the **bottom** of the detail
  (`DeviceDetailView.swift:531-546`), after the disclosure, purchase group, activation, reminders, resale
  and notes. Nothing says it is load-bearing: it is the sole input to the nudge
  (`ClaimRules.swift:141-143`). Its cost is invisible — §5 F1. *App-caused.*
- **H4 — five statuses at creation.** `Đang mở · Đang sửa chữa · Đã xử lý · Bị từ chối · Đã huỷ`
  (`ClaimFormView.swift:209-236`, labels `Models.swift:1510-1518`) on a claim that has not happened yet.
  A closed one is a legitimate "record last month's repair", but it also stamps the close date *now*
  (§5 F6). The footer explaining the rule sits below all five. *App-caused.*
- **H5 — four fields with no answer yet.** `Chẩn đoán` ("Trung tâm nói gì"), `Kết quả`, `Chi phí`, `Bảo
  hành chi trả` (`ClaimFormView.swift:363-380, 391-418`) cannot be answered at the counter; the only
  permission to skip them is a footer two sections further down (`:383`). *App-caused.*
- **H6 — which package?** The menu defaults to `Không gắn gói nào` (`:75, 559`); options read
  `provider · N tháng · Hết <date>` (`:564-569`) — a date, not a verdict, so the user compares it to today
  in their head. With AppleCare+ *and* a manufacturer plan
  (`qa-claims/shots/device-detail-scrolled-default.png`) that is a real comparison. *App-caused.*
- **H7 — "does the slip have a return date?"** The `Có ngày dự kiến trả` toggle (`:252`) is a schema
  question wearing a control: if the paper has no promise date, leaving it off is correct, and nothing
  says so. *Legitimate work, poorly shaped.*

## 4. What the app already knows and makes the user supply

- **K0 — the shop name.** `Nơi sửa` is free text, placeholder *"Ví dụ: FPT Shop Quận 1"*
  (`ClaimFormView.swift:338-344`). The same screen already renders `Device.purchasePlace`
  (`DeviceDetailView.swift:427-429`), every `Warranty.provider`/`address`/`phone` (`:335-356`) and a
  brand-keyed service directory (`:375`). The QA fixture claim reads `Apple Store Vincom Đồng Khởi` — a
  string the app had.
- **K1 — the used-claim counter.** The warranty card prints `Claims: 0/2`
  (`qa-claims/shots/device-detail-scrolled-default.png`; `WarrantyTerms.swift:173-181`), typed by hand as
  `Đã dùng` in a *different* form (`WarrantyFormView.swift:53-54, 618-620`). The claim form lets you attach
  a claim to that package and **nothing increments it** — no query, no trigger (`CountClaims` exists per
  user only, `queries/claims.sql:48`). The app knows the real count; it asks for a hand-kept copy.
- **K2 — a broken device is invisible.** The device row renders brand · price, a deadline pill and two
  badges (`DevicesScreen.swift:766-810`) — **no status**. The comment claiming "the BROKEN badge on the
  device list" (`ClaimsSection.swift:15-16`) is wrong. And `DevicesScreen` **already downloads every
  claim** for the repair-extension map (`RemindersStore.swift:56,75,149-167`), then discards the open ones.
- **K3 — the answer to "still covered?"** The hero says `còn 324 ngày` plus the legal extension date
  (`DeviceDetailView.swift:123-133`); the claim form says nothing about either and its package menu shows
  end dates only. The one question asked at the counter is answered on the screen *behind* the sheet.

## 5. What happens when it fails

- **F1 — the dead end returns after every successful repair.** `needsRepairNudge` is
  `status == BROKEN && !hasOpenClaim` (`ClaimRules.swift:141-143`). Close the claim and the device is
  still `BROKEN` with no open claim, so the amber card comes back: *"Thiết bị đang Hỏng nhưng chưa có lần
  sửa chữa nào đang mở"* + `Bắt đầu sửa chữa` (`ClaimsSection.swift:175-196`) — about a phone you just
  collected. Nothing prompts clearing the status. `[fact]` *[judgement]* The worst consequence of the
  two-record design.
- **F2 — a failed read looks like "no claims".** On a failed detail read, `ClaimsSection` renders the add
  row plus its permanent footer with **no error and no retry** (`ClaimsSection.swift:107-112`); only the
  nudge is guarded by `loaded` (`:61`). The section that must never claim "no repair" silently does.
- **F3 — a failed warranty read becomes a false statement.** `store.warranties` is empty on failure, so
  the form's footer reads *"Thiết bị chưa có gói bảo hành nào."* (`ClaimFormView.swift:308-310`) — an
  assertion about the device, from a request that did not answer. The add row is not gated on `loaded`.
- **F4 — offline says nothing useful, and the guard is on the wrong gesture.** A transport failure escapes
  `rawRequest` as a bare `URLError` (`APIClient.swift:188`), is not an `APIError`, and renders as the OS's
  own sentence via `localizedDescription` (`ClaimFormView.swift:645`, `ClaimRules.swift:317-320`). Typed
  text survives in `@State` — but a swipe-down dismisses with it, while `Huỷ` asks *"Bỏ thay đổi? Tất cả
  thông tin đã nhập sẽ mất."* even when nothing was typed (`:151, :166-171, :188`). No queue.
- **F5 — the 409 is the one path that is right.** One open claim per device is a partial unique index
  (`migrations/0021_claims.sql:126-129`). The form warns inline *before* saving when the store already
  knows, and on a server 409 it reloads, finds the open claim, and offers `Xem lần đang mở`
  (`ClaimFormView.swift:100-105, 629-648`) — so a lost response recovers into the row that was created.
  `[fact]` The best-handled failure in the flow.
- **F6 — filed, then nothing.** `expectedReturnAt` is written and rendered (`ClaimFormView.swift:245-247`;
  `ClaimsSection.swift:244-249`) and that is all: no cron bucket, no action-queue kind (`grep` for claim in
  `cron/run.go` → 0; `services/actions.go:70-80` has ten kinds, none about repairs). And `closedAt` is
  written *when a closed status is tapped* (`services/claims.go:290-299, 400`), not when the phone came
  back — so the legal extension the hero prints (Điều 30.2.c, `WarrantyRepairAdjustment.swift`) is measured
  from that tap. Recording last month's 20-day repair today adds 31 days, not 20.

## 6. Shipped vs `docs/SPEC-WARRANTY-CLAIM.md`

| Spec (§5.2/§5.3) | Shipped (`0021_claims.sql:95-116`) | Effect on the user |
|---|---|---|
| `DRAFT` — gather invoice/IMEI *before* going | absent; `OPEN` only | the prepare-first half lives in a read-only checklist that cannot file |
| `status` + `outcome` split | one `status`, free-text `outcome` | "đổi máy" vs "hoàn tiền" vs "sửa xong" is prose; the 3-times count is unanswerable |
| `WAITING_PARTS` | absent | the commonest cause of delay has no state |
| `deviceReturnedAt` | absent; `closedAt` = the tap (§5 F6) | the legal extension is measured from a UI action |
| `ClaimAttachment` (10 files) | absent; device `Attachment`, max 5, shared | the intake slip competes with the invoice |
| `promisedAt` + a cron bucket (§7.3) | `expectedReturnAt`, no bucket | the promise date is displayed and never watched |
| `rejectionReason` taxonomy, `servicePhone/Address`, `loanerDevice` | absent; `serviceCenter` only | refusals are not countable; phone/address stay on the `Warranty` row |

The spec expected the **web** to be the creation surface and native clients to *view* (§7.4); what shipped
is a full native create form on iOS (`ClaimFormView`), which is what this report walks.

## 7. The three changes, ranked

Each removes steps, changes a default, or uses data already held. No layout, no new screen, nothing that
contradicts `WARRLY-visual-direction.md` — which already prints `Đã bán` in the deadline column
(`DevicesScreen.swift:766-785`), the precedent these lean on.

**1. Let the open claim be the "in repair" state, and stop the device status being load-bearing.**
*Removes:* the H3 decision, its tap, and the scroll to the bottom of the detail. *Uses what is already
there:* `DevicesScreen` downloads every claim (`RemindersStore.swift:56,75`) — an open claim per device
costs **one dictionary, zero requests**. Print `Đang sửa` in the row's deadline column (same slot as
`Đã bán`), and gate the nudge on `claims.isEmpty` instead of `!hasOpenClaim` so a finished repair stops
producing F1's false card. *Also removes* the need to mark `BROKEN`, and with it the hidden cost: broken
devices get no expiry reminder (`warranties.sql:203,216` require `d.status = 'ACTIVE'`). **Saves ≈ 2
interactions + 1 decision per repair**, plus the recurring wrong prompt. *Minimum shippable half:* the
one-line `claims.isEmpty` change alone kills F1 today.

**2. At filing, ask only what exists at filing.** *Removes:* `Chẩn đoán`, `Kết quả`, `Chi phí`, `Bảo
hành chi trả` from the create state; reveal them when a closed status is chosen, which keeps the
legitimate "record last month's repair" path. **11 fields → 7, 18 controls → 12, ~500 of the form's
~1,500 pt** `[judgement, from component minima]`; the save point lands on the first screenful and H5
disappears. Nothing is lost — edit mode is where those four facts arrive
(`ClaimsSection.swift:140-145`).

**3. Preselect the package, and derive the used count instead of asking for it.** *Removes:* one menu
interaction, one date comparison (H6), and the hand-typed `Đã dùng` on the warranty form (K1). Default
`warrantyId` to the package whose `endDate >= today` when there is exactly one; label options `còn hạn /
hết hạn N ngày` and `đã dùng x/y` from `Claim` rows; show that derived count on the warranty card too.
**Saves ≈ 2 interactions at filing, deletes one hand-maintained number from the product**, and stops the
silent "no package" default that makes every per-package answer unknowable.

**Not in the top three, but free:** seed `Nơi sửa` from `Device.purchasePlace`
(`DeviceDetailView.swift:427-429`) or the matched `Warranty.provider` — one field, ~20 characters of
typing removed, no new control (K0).

**Deliberately not proposed:** anything that parses a photo, invoice or sentence. That ground is covered
(`WARRLY-ai-input-analysis.md` §2/§6) and the claim assessment already ships (`ClaimAssessmentView`,
`POST /api/v1/ai/assess-claim`) — though it hangs off a **filed** claim, so it answers "will they cover
this?" *after* the filing, behind an opt-in switch in Settings.

## 8. What I could not determine

1. **The claim form's real geometry.** No screenshot exists (§0); 1,500 pt is summed from declared
   minimums, ±20%. **Whether the disclosure is collapsed for real users** is code-only too: default
   `false` (`DeviceDetailView.swift:61,70-83`) with a DEBUG override, never a shot.
2. **How many devices a real account holds.** The QA fixtures (3–7) are not a population, and that
   number drives H1/H3's cost directly.
3. **Whether the 5-file cap actually binds.** The device-less inbox exists (migration `0018`); I did not
   trace whether it is reachable from the device screen, so the slip may be storable without filing.
4. **Android and web parity.** Out of scope; the web has its own form
   (`website/src/components/claim-form.tsx`), not walked. No telemetry exists, so "12–14 taps" is a count
   of controls, not of a user's path.
