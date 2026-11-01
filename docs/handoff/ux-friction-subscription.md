# Warrly iOS — friction in one core task: *what a subscription costs, and when it renews*

**Status:** analysis only; no app code changed. **Evidence:** repo `warranty-vault` at commit `79b600a`
(2026-11-01 05:43 +0700), **clean tree**, so the `file:line` pins hold. Screenshots:
`ios/build/qa-five-forms/04-subscription-plan-suggestions.png` (mtime **31 Oct 20:23**, matches current code) and
`ios/build/qa-visual/after/05-subscriptions.png` (mtime **31 Oct 08:59**, older — layout only, §1.2).
**Tagging:** `[fact]` = verifiable at the cited `file:line` or screenshot; `[judgement]` = my reasoning over those
facts. Unknowns in §7.

## 0. The answer

- **The task is decided by two numbers and the create form shows neither.** It takes a price and a cycle and displays
  no monthly equivalent and no first charge date (`SubscriptionFormView.swift`, whole file). Both exist: the monthly
  one ships **three times** (`SubscriptionsScreen.swift:6`, `SubscriptionDetailView.swift:557`,
  `api/internal/services/subscription_billing.go:103`); the date is derived by the server on any create that omits
  one (`services/subscriptions.go:268-271`). **Both appear only after the save** — per-plan monthly on the detail
  (`SubscriptionDetailView.swift:207-215`), the date on a list row (`SubscriptionsScreen.swift:507-523`).
- **The one control that reveals the date is off by default and opens on today** (`SubscriptionFormView.swift:112-113`).
  Flipped and saved untouched it hands the cron an already-due renewal, and the next daily pass writes a payment that
  never happened (`api/internal/cron/run.go:797-846`).
- **"Cancel" has two meanings on one screen and the prominent one does not cancel**
  (`SubscriptionDetailView.swift:333-347` vs `:394-419`).
- **The audit screen answers "when does it renew" for neither three subscriptions nor thirty** — no rule is a renewal
  rule (`services/subscription_audit.go:63-66`) and it prints a 14-day renewal promise nothing implements
  (`Sources/WarrlyKit/SubscriptionAudit.swift:341-342`).

**Not proposed, on purpose.** No AI parsing — the input is two typed fields and `WARRLY-ai-input-analysis.md` §2/§6
already owns image/text parsing; a subscription is not a receipt. No redesign — all three changes in §6 live inside the
form or reuse an existing footer/link. Untouched: the row's price + renewal anatomy (§8.5), the audit entry card
(§8.5), the tab bar, the palette.

## 1. The task, counted

**As the user would say it:** *"I subscribed to X for a year. What does that cost me a month, when does it charge me
again, and where do I cancel?"* App opens on **Tổng quan** (`05-subscriptions.png`: 5 tabs, `Đăng ký` third).

### 1.1 The spine, tap by tap `[fact]`

| # | Tap | Effect | Source |
|---|---|---|---|
| 1 | tab **Đăng ký** | the list | `SubscriptionsScreen.swift:152` |
| 2 | **+** | pushes **Gói mới** | `:258` |
| 3 | **Tên** field | focus, then typing (work) | `SubscriptionFormView.swift:149` |
| 4 | **Giá / chu kỳ** | focus, then typing (work) | `:212` |
| 5 | **Chu kỳ** row | modal sheet | `:216-233` |
| 6 | **Hàng năm** | sheet self-dismisses | `:650-654` |
| 7 | **Thêm** | POST, toast, pop | `:400-405` |
| 8 | the new row | detail — **the first place this plan's monthly figure exists** | `SubscriptionDetailView.swift:209-211` |
| 9 | **Thông tin & thanh toán** | expands the disclosure | `:121-132` |
| 10 | **Huỷ gói** | leaves for Safari | `:409-413` |

**10 taps, 2 typing bursts, 2 sheets, 5 in-app surfaces (list, form, both sheets, detail), 1 app exit.** Minimum create
is **7**; tap 8 buys the answer to question one; 9–10 buy the cancel. The segmented **Đã huỷ** instead is 9 taps and
**cancels nothing** (H5).

**Fields and controls `[fact]`.** The form holds 12 text inputs (two of them money fields), 3 toggles, 3 date pickers and
2 sheet pickers (`SubscriptionFormView.swift:147-359`), plus the 3-row reminder editor
(`App/DesignSystem/LeadDaysSection.swift:38-44`). **18 rows exist on an untouched create**, about ten of them above the
fold in `04-…png`. **Two are required** — `Tên` and `Giá` (`isValid`, `SubscriptionFormView.swift:63-70`); the reminder
schedule arrives pre-filled and valid, so it counts as neither. **The flow is left twice**: into the `Chu kỳ` sheet, and
into Safari at tap 10. The tab bar stays visible over the pushed form (`04-…png`), so a tab detour keeps the draft; the
back chevron does not (§7.4).

### 1.2 Work versus friction

| The user does | Verdict | Why |
|---|---|---|
| types name + price, picks `Hàng năm` | **work** | unknowable to the app; facts about the purchase `[judgement]` |
| types `Huỷ URL` | **work, asked at the wrong moment** | no directory of vendor cancel pages exists (`migrations/0012_brand_service_info.sql` covers device warranty providers), so the app truly does not know it — but it asks at creation, when nobody has the URL to hand `[fact + judgement]` |
| divides 2.590.000 by 12 | **friction** | that division already ships three times `[fact]` |
| picks the next renewal date | **friction** | the server derives it whenever it is not given one (`subscriptions.go:268-271`, `subscription_billing.go:69-87`) `[fact]` |
| corrects `Loại` away from `Ai` | **friction** | `ai` is pre-selected for every new subscription (`SubscriptionFormView.swift:107`) and later manufactures false duplicate findings (§5) `[fact]` |

**The screenshot, and its vintage.** `qa-visual/after/05-subscriptions.png` (08:59) puts the two cards above the list:
the first row starts at **≈ 62 % of screen height**, about **four rows** fit above the tab bar, and the
`Đang dùng / Đã huỷ / Tất cả` segment sits *inside* the ScrollView (`SubscriptionsScreen.swift:130-137`) so it scrolls
away while the nav-bar sort button does not. That shot is **older than the row code**: it prints raw past dates
(`15/02/2022`), which today render as **`Chưa ghi nhận kỳ mới`** (`:518-522`). Layout only.

## 2. Where the user hesitates — six named elements

**H1 · `Giá / chu kỳ` beside `Chu kỳ`, nothing monthly between them.** `[fact]` `SubscriptionFormView.swift:211-233`.
`04-subscription-plan-suggestions.png` shows the whole Chi phí block — `Giá / chu kỳ 0 ₫`, `Chu kỳ Hàng tháng`,
`Bắt đầu ngày 31 thg 10, 2026`, `Có ngày gia hạn` — and no `~ … / tháng` anywhere. The hesitation is *"is the yearly plan
cheaper?"* left as mental arithmetic — and the string that answers it already exists one screen away
(`SubscriptionDetailView.swift:210`).

**H2 · `Có ngày gia hạn`, off, picker starts on today.** `[fact]` `SubscriptionFormView.swift:113`
(`hasRenewal = sub != nil` → false on create) and `:112` (`renewalDate = Date()`). The toggle reads "do you know the
date?" but means "do you want to see the date"; turn it on and the picker offers **today**, not the cycle the app would
compute. Consequence in F3.

**H3 · `Loại` pre-filled with `Ai`.** `[fact]` `SubscriptionFormView.swift:107`; `Loại ✨ Ai` in the screenshot. Every
non-AI subscription is wrong by default and the user must notice a value that looks chosen. Correcting it costs 2 taps
and a 26-row sheet — 6 subscription categories then all 20 device categories, undivided (`:571-592`).

**H4 · `Nhắc trước 30 và 7 ngày` on a monthly plan.** `[fact]` A new subscription starts from `LeadDaysRules.defaults`
= `[30, 7]` (`SubscriptionFormView.swift:124-126`, `LeadDaysRules.swift:50`) and the form sends it explicitly (`:529`).
The app's own subscription constant is `subscriptionDefaults = [3, 1, 0]` (`LeadDaysRules.swift:53`), matching the
server (`services/leaddays.go:58`), and it has **zero call sites** (grep: only its definition). Silent, not hesitant:
a monthly plan renews in a month, so the 30-day lead fires within a day of creation `[judgement]` (exact-day window,
`store/queries/subscriptions.sql:148-150`) — the first renewal notification is noise 30 days out, which is how the 7-day
one gets ignored later.

**H5 · `Đã huỷ` and `Huỷ gói`, same screen, different meanings.** `[fact]` `SubscriptionDetailView.swift:333-347` is a
three-way segment that PATCHes `status` immediately — no confirm, no footer — and `setStatus` carries `autoRenew`
through unchanged (`SubscriptionsStore.swift:76-90`), so the vendor keeps billing. The real cancel is a link inside the
collapsed disclosure (`:394-419`). No string says the status is bookkeeping; the audit screen has that sentence
(`SubscriptionAudit.swift:317-319`), the detail screen has none. Mis-reading it costs a monthly charge until a bank line
gives it away.

**H6 · sorting: a funnel icon opens a sort sheet, and the order is by a number the row does not print.** `[fact]`
`SubscriptionsScreen.swift:251-255` opens `sortSheet` (`:344-393`) — the icon says filter, the sheet says `Sắp xếp`, and
the segments above the list already look like the filter. Sorting is by `subMonthlyEquivalent` (`:106-107`) while the row
prints price per cycle (`:472-477`): under `Tốn nhiều / tháng`, 500.000 ₫/month correctly precedes 6.990.000 ₫/year, but
the visible numbers run 500.000 then 6.990.000, which reads as a broken sort. `[judgement]` Same missing figure as H1,
seen from the list.

## 3. What the app already knows and makes the user supply

| # | Known where | Still asked at | Cost |
|---|---|---|---|
| K1 | monthly equivalent — `subscription_billing.go:103-118`, `SubscriptionsScreen.swift:6-17`, `SubscriptionDetailView.swift:557-568` | nowhere in the form (`SubscriptionFormView.swift:211-233`) | a division per plan plus a save-then-look trip `[fact]` |
| K2 | next renewal date — `NextRenewalDate` (`subscription_billing.go:69-87`), applied whenever `renewalDate` is absent (`subscriptions.go:268-271`) | the form asks the user to pick one (`:238-250`), only if they opt in | 2 taps for a worse date than the computed one `[fact]` |
| K3 | the renewal state — `renewalDate`, `daysUntil`, the colour rule (`SubscriptionsScreen.swift:506-531`) | nothing of it in the form | "when" is answered only after the money is committed `[fact]` |
| K4 | the brand behind a suggestion — `Spotify Premium` implies `Spotify` | the chip sets `plan` (and `name` if empty), never `brand` (`AutocompleteChips.swift:23-25`, `SubscriptionFormView.swift:172-176`) | an empty `Hãng`, and a weaker input to duplicate detection, which keys on brand + category (`store/queries/subscription_audit.sql:126-136`) `[fact]` |
| K5 | the subscription reminder default `[3, 1, 0]` (`LeadDaysRules.swift:53`, `leaddays.go:58`) | the form pre-fills `[30, 7]` and sends it (`SubscriptionFormView.swift:124-126`, `:529`) | a schedule unlike the app's own default, with nothing saying so (H4) `[fact]` |

K1 and K2 are what the owner asked about, and both are pure friction: the app computes them and shows them everywhere
except where they change a decision.

## 4. What happens when it fails

**F1 · the list lies when the read fails.** `[fact]` `SubscriptionsScreen.swift` never reads `store.state` (grep: zero
hits); its body is `if filtered.isEmpty { emptyState }` (`:140-144`), and the empty state says **`Chưa có gói nào`**
with a `Thêm gói` button (`:304-318`). On cold launch the store is `[]` until `load()` returns; on a transport failure
it is still `[]`. **Offline shows "you have no subscriptions" and offers to add one** — also breaking the settled rule
"never an empty state before the first read has answered" (`WARRLY-visual-direction.md` §9.4). No retry.

**F2 · the detail swallows its error.** `[fact]` `SubscriptionDetailView.swift:501` sets `errorMsg`; it is declared at
`:17` and **never rendered** (three occurrences: declare, clear, set), so a failed re-read leaves stale data on screen
with no sign it is stale. `SubscriptionAuditScreen.swift:67-72` is the counter-example done right — the server's message
plus `Thử lại`.

**F3 · the wrong date, and the payment the app invents.** `[fact]` `renewalDate = Date()` on create
(`SubscriptionFormView.swift:112`) with `autoRenew = true` (`:114`). A renewal counts as overdue from the next midnight
(`subscriptions.sql:168-174` compares against today's start), and the daily cron
(`deploy/systemd/warranty-vault-cron.timer`, 02:00 UTC = 09:00 ICT) writes a `SubscriptionPayment` of the full price
dated that day, advances the cycle (`cron/run.go:797-846`) and pushes `✅ Đã gia hạn`. **The app records a charge that never
happened**, and that row feeds `Đã chi tổng` (`SubscriptionDetailView.swift:209-211`) and `chargedTotalVnd` in every later
audit finding; nothing calls it a simulation. `[judgement]` on frequency: it needs the toggle flipped and the picker
untouched — likely for the user who flipped it because they did not know the date.

**F4 · submit errors are handled well; there is no second attempt after F3.** `[fact]` `FormErrorCopy.presentation`
separates 5xx, 401, 429, `LIMIT_REACHED` and field errors with "chưa có gì được lưu" language
(`App/DesignSystem/Components.swift:1370-1422`) — leave it. But payments can only be added, never deleted
(`SubLogPaymentSheet`, `SubscriptionDetailView.swift:572-675`), so repairing F3 means editing the date and living with a
wrong total. `[fact + judgement]`

## 5. The audit screen: three subscriptions versus thirty

**What it is.** One tap from the list (`SubscriptionsScreen.swift:218-233`), `GET /api/v1/subscriptions/audit`, three
finding kinds, no write path (`services/subscription_audit.go:12-20`, `:63-66`). Its copy is honest about what it reads —
payment history — in the entry paragraph ("Đọc lịch sử thanh toán…", `SubscriptionAudit.swift:365-366`) and the server's
`note` (`SubscriptionAuditScreen.swift:112-117`).

**Three subscriptions.** With no recorded payments **every rule returns nothing**: quiet auto-renew needs ≥ 3 auto
charges with the first ≥ 6 months old (`subscription_audit.go:226-247`), price rise needs two consecutive payments
(`:274-320`). The screen is a summary card, the empty card ("Không có phát hiện nào từ dữ liệu bạn đã ghi…",
`SubscriptionAuditScreen.swift:137-148`) and four rule lines — 2 taps that teach nothing about the renewal dates held.

**Thirty subscriptions.** Same three rules, so it is still **not** a renewal view. Two things change:

1. **The duplicate rule scales quadratically and fires on a default.** `[fact]` `SAME_BRAND_CATEGORY` needs only two
   ACTIVE subscriptions with the same non-empty `brand` **and** the same non-empty `category`
   (`store/queries/subscription_audit.sql:121-137`). Every subscription created without touching `Loại` has
   `category = "ai"` (H3), so **Apple One + iCloud+ (both `brand = Apple`) are reported as "you may be paying twice for
   the same thing"**, and thirty subscriptions multiply the pairs (5 Apple + 5 Google = 20 findings). The screen's stated
   promise is that it never accuses without data (`SubscriptionAudit.swift:5-25`); the form's default breaks it. The check
   is cheap — 30 subscriptions is at most 435 pairs, ceiling 100 per user (`MaxSubscriptionsPerUser`) — so this is a
   *trust* problem, not a performance one.
2. **Nothing else changes.** No grouping, no filter, no cap, one card per finding (`SubscriptionAuditScreen.swift:57-64`),
   sorted severity-then-monthly (`SubscriptionAudit.swift:389-400`), so thirty low-severity duplicate cards bury
   whatever mattered.

**The renewal rule it prints and never applies.** `[fact]` The payload echoes `upcomingRenewalDays: 14`
(`subscription_audit.go:82-85`, `:394`), openapi calls it the window in which a finding is still actionable
(`openapi.yaml:6596`), and the client prints it as a rule: **`Còn kịp xử lý trước khi bị trừ tiền: 14 ngày.`**
(`SubscriptionAudit.swift:341-342`). No kind uses it: `attachRenewal`, which fills `nextRenewalAt` and
`daysUntilRenewal`, is called from exactly one place, the quiet-auto-renew loop (`subscription_audit.go:260`). The
screen promises a 14-day renewal warning it can never produce.

**Where renewals *are* surfaced:** the row countdown (`SubscriptionsScreen.swift:507-523`), the dashboard's nearest
three (`DashboardView.swift:67-73`, plus one card and three rows on the deadline board, `DeadlineBoard.swift:83`), a push
per lead day, and — **only when `cancelUrl` is missing** — an action item `Sắp bị trừ tiền nhưng chưa có link huỷ` in a
14-day horizon (`services/actions.go:78`, `:101-104`, `:654-680`). `[judgement]` The inversion: a subscription **with** a
cancel link and a charge tomorrow produces no queue item at all, so keeping good data removes the warning.

## 6. The three changes that remove the most friction, ranked

All three sit inside the form or reuse an existing component; none changes a settled screen anatomy.

**1 · Print the monthly equivalent in the form, under the price** *(removes H1, H6, K1)*. A read-only row under
`Giá / chu kỳ` (`SubscriptionFormView.swift:211-214`) using the string that already exists — `~ %@ / tháng`
(`SubscriptionDetailView.swift:210`) — recomputed when `price`, `billingCycle` or `intervalDays` change. Move
`subMonthlyEquivalent` into `WarrlyKit` **once** and delete both private copies (`SubscriptionsScreen.swift:6-17`,
`SubscriptionDetailView.swift:557-568`), numerically identical to `MonthlyEquivalent` (`subscription_billing.go:103-118`)
so form, list and server total cannot disagree. No new control, so it costs 0 taps. **Saves** the division and the
save-and-open-the-detail tap (spine step 8) per plan added or cycle changed, and makes `Tốn nhiều / tháng` legible.
`[judgement]` On an existing thirty-subscription account the number still costs one detail screen per plan — §8.5 pins
the row's trailing column to price + renewal and I am not proposing to change that — but the *ranking* is already free in
3 taps via the sort sheet, and that ranking is the decision this task asks for. Estimate: **1 tap + 1 division per add;
1 confusion per use of the monthly sort.**

**2 · Compute the next charge date, show it, and default the toggle to it** *(removes H2, K2, F3)*. Default
`hasRenewal = true` on create and seed `renewalDate` from the rule the server already uses (`NextRenewalDate`:
`startedAt` + 1 / 3 / 12 months, or `intervalDays`, `subscription_billing.go:69-87`), recomputed whenever `startedAt`,
`billingCycle` or `intervalDays` changes. Render it as a read-only line beside the existing picker
(`SubscriptionFormView.swift:244-250`); the picker stays for anyone who knows a different date. The row already exists —
it is populated instead of blank. **Saves** 2 taps (toggle + picker) and answers "when does it charge me" *before* the
save instead of one screen later. **Removes F3**: with a computed future date, a default save can no longer produce an
overdue row, so the cron stops inventing a payment and `Đã chi tổng` stops being wrong. Estimate: **2 taps per create,
plus one whole class of bad data** — a fabricated payment, its inflated total, and its effect on every later audit
figure. `[judgement]`

**3 · Separate the two cancels** *(removes H5)*. Under the status segment (`SubscriptionDetailView.swift:333-347`) add
the existing `WVSectionFooter` with one sentence: the status is a record inside Warrly and does not stop the vendor. When
`cancelUrl` exists, surface the existing `Huỷ gói` row (`:409-413`) at that level instead of a disclosure deeper; when it
does not, the footer says the app has no link and cancellation happens at the vendor. That is one sentence in the
same class as the audit's protected advisory line (`SubscriptionAudit.swift:317-319`), and it contradicts nothing in the
visual direction. **Saves** 2 taps (the disclosure round trip) for the user who came to cancel, and — the real prize —
the belief that `Đã huỷ` cancels. `[judgement]` Lowest frequency of the three, highest loss per occurrence: **a charge
recurring every month after the user believed they had stopped it.**

**Ranking rationale.** 1 and 2 hit every single add and cost nothing; 2 also deletes a data error, which puts it above 3
despite 3's larger per-incident loss. `[judgement]`

## 7. What I could not establish

1. **Whether the cron runs in production.** `deploy/systemd/warranty-vault-cron.timer` schedules 09:00 ICT daily;
   whether it is installed on the live box is outside the repo, and F3 depends on it. `[fact: the timer exists]` /
   `[unknown: enabled]`
2. **F3's frequency, and whether the push lands first.** No form-interaction telemetry exists, so the frequency is an
   estimate; delivery depends on notification permission and on which lead day fires — in the wild `[30, 7]`, not
   `[3, 1, 0]` (H4).
3. **Whether `Loại`'s `ai` default is deliberate.** No comment says so (`SubscriptionFormView.swift:107`) and the picker
   lists `ai` first (`:572`). If deliberate, §5's false-duplicate path still has to be fixed at the rule or the default.
4. **The form's two exits.** `SubscriptionFormView.swift:407-410` confirms discard from **Huỷ**, but the back chevron
   pops the pushed form with no guard, losing 18 rows silently; whether an ancestor installs one is untested. `[fact + unknown]`
