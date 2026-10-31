# Warrly iOS — visual direction

**Status:** proposal, ready to implement.
**Scope:** the SwiftUI app in `ios/App` — the eight screens photographed in
`ios/build/qa-visual/before/`.
**Not in scope:** the API, the website, Android, the login/register flow, the
widget and the share extension.

This document is written to be executed by eight people working in parallel on
eight screens. One decision per screen, one set of tokens, one list of things
that must not move. If something here reads as "it depends", it is a bug in the
document — tell the owner before you guess.

> **If you read nothing else:** one lead per screen · 16 pt gutter · radii
> 8 / 12 / 16 · type 34 / 28 / 20 / 17 / 13 · coral = the selected tab plus one
> action, nothing else · green, amber and red only on dates and verdicts ·
> delete every gradient, every coloured icon tile and every uppercase kicker
> outside `WVSectionHeader` · never let a title truncate before its value ·
> and leave the receipt strip, the skeletons and the disclosure exactly as they
> are.

---

## 0. The design in one paragraph

Warrly is a **calm reassurance utility**: it answers one question — *what is the
next date I could miss, and how long do I have?* — and then gets out of the way.
So the interface has exactly one lead per screen, one accent that means "the
thing you can do", and **colour only where it encodes a state**. Everything
decorative that does not carry information — category hues, gradient heroes,
uppercase kickers, coloured icon tiles — comes out. What is left is paper, type,
and a red number when it matters.

Three rules follow from that, and every decision below is one of them:

1. **One lead per screen.** One 34 pt title, one thing at the top that a person
   came to see. Nothing above the lead, ever.
2. **Colour encodes a state, never an identity.** Coral is the action and the
   tab you are on. Green / amber / red are the state of a date or a verdict.
   Nothing is coloured because of what *kind* of thing it is.
3. **One left edge, one vertical rhythm, three corner radii.** 16 pt gutter, a
   4 pt-based spacing scale, and 8 / 12 / 16 only.

---

## 1. What is wrong today

Every item below is visible in `ios/build/qa-visual/before/`. File references
are to the current tree.

### 1.1 The app has no single accent — each list screen invents its own

Three "summary hero" cards, three different gradients, none of them the brand:

| screen | gradient | padding | file |
|---|---|---|---|
| Thống kê (`04-stats.png`) | `#FF6B45 → #FF2D55` coral → pink | 18 | `Features/Stats/StatsView.swift:490` |
| Đăng ký (`05-subscriptions.png`) | `#5856D6 → #007AFF` indigo → blue | 16 | `Features/Subscriptions/SubscriptionsScreen.swift:273` |
| Wishlist (`06-wishlist.png`) | `#FF2D55 → #AF52DE` pink → purple | 16 | `Features/Wishlist/WishlistScreen.swift:215` |

Look at the three shots side by side: they read as three products. On the Thống
kê screen the coral runs into a magenta-red that nothing else in the app uses;
on Đăng ký there is no coral at all. The colour a user would call "Warrly" is
present on one of the three, and diluted by decoration on the other two.

### 1.2 Coral means four things

The same hex stands for: (1) the **primary action**, (2) **selection** / the
navigation tint, (3) a **category** colour, and (4) **brand identity** — the
first stop of a gradient.

In `01-devices.png` alone, coral is: the filter icon, the camera badge, the "+",
the selected tab, **and** the iPhone row's icon badge (because `WVCategory` maps
`"phone": .brand` — `DesignSystem/Formatters.swift:148`). Add the primary button
(`WVButton.primary` = `WVColor.tint`), the checkmark in `07-settings.png`, the
back chevron, the "Xem chi tiết" link in `03-dashboard.png`, and the start of
the Thống kê gradient.

Five coral things on one screen. A user cannot learn "coral = the main thing",
because coral also means "this row is a phone".

### 1.3 Every row has the same weight, and the one that matters is fourth

`01-devices.png` — seven rows, identical anatomy: 36 pt coloured icon tile, 16 pt
medium name, 13 pt meta, a 12 pt pill. The only difference between the row that
expires in 8 days and the row that expires in 2 years is the pill's fill.

And the order is *purchase date* (`DevicesScreen.swift:99`, default
`.purchaseDesc`). The Apple Watch with `Còn 8d` is row **four**. A sold Nintendo
Switch sits at row two, between two live devices. Nothing about the screen's
order tells you where to look.

The same failure at section level, in `03-dashboard.png`: four headings —
"Hạn gần nhất", "Việc cần xử lý", "Gói đăng ký", "Đang thêm" — all 22 pt bold.
Four co-equal leads.

### 1.4 The most prominent thing on the home screen is a 2022 subscription

`03-dashboard.png`, the lead card:

> GÓI ĐĂNG KÝ … iCloud+ 2TB … **Gia hạn 15/02/2022 · quá hạn 1719 ngày** … Xem chi tiết

The nearest-deadline card is an expired subscription from four and a half years
ago, while `Apple Watch Series 11 · Hết hạn 18/11/2026 · còn 18 ngày` sits third
in the row list below it. The board ranks by absolute date including the past
(`Sources/WarrlyKit/DeadlineBoard.swift:88` — deliberate, "it is the one the
user has already missed"). As a *rule* that is defensible; as the top card of a
reassurance app it is the loudest possible statement of something the user can
no longer act on.

### 1.5 The time-left column has seven grammars, two languages and one nonsense

From `01-devices.png` and `05-subscriptions.png`, in one column:

| rendered | where | problem |
|---|---|---|
| `Còn 8d` | device row | abbreviation + no space |
| `Còn ~11th` | device row | tilde, "th" for tháng, no space |
| `2 năm` | device row | full Vietnamese word |
| `Hết 1d` | device row | expired, still a countdown |
| `Còn ~5th` | device row | same as above |
| `Quá hạn 1719d` | subscription row | four and a half years as a day count |
| `31d nữa` | subscription row | different preposition, same idea |

Nothing here prints the date. A user who wants to put the deadline in a calendar
has to open the row. (The device *detail* screen already does it right —
`Hết hạn 20/09/2027 · còn 324 ngày` in `02-device-detail.png` — which is the
proof the long form belongs everywhere dense rows appear.)

### 1.6 Three money formats on one screen, none of them the app's own

`04-stats.png` in one viewport:

> `169.350.000 ₫` · `100 tr ₫` · `176,3 tr ₫` · `724 ng ₫` · `123,9 tr ₫` ·
> `~8,7 tr ₫/năm` · `2.000.000 ₫`

and one scroll further (`04` + chart): `52M`, `35M`, `17M` on the chart's y-axis.
Four schemes — full VND, "tr", "ng", "M" — two decimal separators, and "ng" is
ambiguous in Vietnamese (nghìn? ngàn?). Every other screen prints `724.000 ₫`.

### 1.7 Content has three left edges

Measured from the screenshots (px ÷ 3 on a 402 pt-wide screen):

| element | left edge | shot |
|---|---|---|
| cards, list groups, large title | **16 pt** | all |
| dashboard section heads (`WVDashSectionHead`) | **20 pt** (`WVSpacing.titleGutter`) | `03` |
| section headers and footers (`WVSectionHeader/Footer`) | **32 pt** | `03`, `07`, `08` |

So on the dashboard the heading "Hạn gần nhất" starts 4 pt right of the card
under it, and the legal footer starts 16 pt right of both. In `07-settings.png`
the label "GIAO DIỆN" is 16 pt right of the card it labels. In `08-search.png`
the group headers "THIẾT BỊ / ĐĂNG KÝ / WISHLIST" are 16 pt right of the results.

Three different insets for the same job — and none of them is a token: the 32 is
a literal in `Components.swift:143/157`, the 20 is `WVSpacing.titleGutter`.

### 1.8 Section headers are 32 pt in, list dividers are 60, 62 and 76 pt in

`WVDivider` has a default inset of 16, but call sites use: 16 (17 sites), 60
(66 sites), 62 (3 sites), 76 (1 site). On a single device-detail screen the
"Mua hàng" group indents its hairlines to the text after a 30 pt badge, while
the attachments card below uses a full-bleed-divider rule. A hairline is a
detail; three values for it is a tell that nobody owns it.

### 1.9 Nine corner radii, four of them on one screen

The tokens are `card 14 / list 12 / widget 18 / sm 8 / pill 999`; on top of that
the code has literal radii `2, 3, 4, 6, 7, 8, 9, 10, 12, 14, 16` and a computed
`size * 0.23` for icon tiles (`Components.swift:80`).

`06-wishlist.png` alone: hero card **14**, list group **12**, segmented track
**9**, segmented thumb **7**, icon tile **8.3** (36 × 0.23). Plus a gradient.
Four-shape geometry in one column of content.

### 1.10 Uppercase micro-labels in three sizes, two of them tracked

* Heroes: 11 pt semibold **uppercase, tracking 1** — `CHI MỖI THÁNG`,
  `ĐANG THÊM 3 MÓN`, `TỔNG GIÁ TRỊ THIẾT BỊ`.
* Section headers: 13 pt **uppercase, no tracking** — `GIAO DIỆN`, `MUA HÀNG`.
* `WVWidget`: 11 pt uppercase, no tracking.
* `DeadlineCard`: 12 pt uppercase ("GÓI ĐĂNG KÝ").

Four treatments for "small label above a thing". `.tracking(` appears at exactly
6 sites in the whole app — all of them on those three heroes.

### 1.11 The same state is drawn three ways in one list

`08-search.png`, one screen:

* device: a **green filled pill** `Đang dùng`
* subscription: **green 13 pt text**, no pill: `Đang hoạt động`
* wishlist: **gray 13 pt text**: `Đang theo dõi`

And on the devices list, the terminal state "sold" is a **blue** pill
(`Đã bán`, `01-devices.png`) — blue, the app's "information" colour, on the one
state that needs no action at all.

### 1.12 Explanations sit above the thing sometimes and below it other times

`07-settings.png`: "Ngôn ngữ áp dụng cho…" is **below** its card; the reminder
paragraph is **above** where its card would be; one scroll down
(`07b-settings-scrolled.png`) "Khi bật, ảnh hoá đơn…" (four lines) is **above**
the toggle it explains, and the backup warning is **above** its three rows. No
rule, so no reader can predict where the sentence about a control lives.

While we are there: the first group ("GIAO DIỆN") contains a row titled
`Giao diện tối` that toggles the theme, and the second group ("CHẾ ĐỘ") contains
a three-way picker for the same setting — two controls, stacked, one of them
with no switch or chevron glyph, so it reads as a dead row.

### 1.13 Rows are truncated by their own trailing column

`01-devices.png`: `Máy lọc nước Karofi KA…`, `Máy lạnh Daikin Inver…`.
`05`: `Spotify Premium Fam…`, `Adobe Creative Clo…`.
`06`: `Máy pha cà phê Br…`.
`08`: `Apple Watch Serie…`, `MacBook Air 15…`, `Apple · Chờ giảm gi…`.
`07b`: `Bảng kê cho bảo hiểm (tiếng V…` plus a truncated subtitle.

The name is the one thing a row must never lose, and it loses first — because
the trailing pill/price is laid out before the title.

### 1.14 Category codes leak, in English, in uppercase

`06-wishlist.png` and `08-search.png`: `Apple · LAPTOP`, `Sony · HEADPHONE`,
`Breville · KITCHEN`. The app has Vietnamese labels for these
(`CategoryLabels.swift:16` → `Laptop`, `Tai nghe`, `Đồ nhà bếp`); the wishlist
row prints the raw code (`WishlistScreen.swift:327`). It is the same class of
defect as `SUB MỖI THÁNG` on Thống kê and the `Wishlist` tab label among four
Vietnamese tabs.

### 1.15 The skeleton does not match the row it replaces

`01b-devices-skeleton.png`: four placeholder rows with a 36 × 36 icon block and
two text bars — and **no trailing value, no chevron**, so the silhouette stops
where every real row continues. The placeholder is calm and static (good, keep
that — see §9.2), but it promises a shape the data does not deliver.

---

## 2. Type

All roles stay **semantic `WVFont` cases**, so Dynamic Type keeps working and
no new case has to be added. Sizes below are the defaults at the Large content
size; what matters is the order and the ratio, not the points.

| role | WVFont | default | weight | colour | used for | never used for |
|---|---|---|---|---|---|---|
| `title` | `.display` | 34 | bold | `label` | the navigation large title, exactly once per tab root | anything inside content |
| `lead` | `.statValue` | 28 | bold | `label` (money) or the state colour (a date) | the one number a screen is about | a second number on the same screen |
| `section` | `.title3Emphasis` | 20 | semibold | `label` | 1–3 content section headings, sentence case | a repeat of the screen title |
| `rowTitle` | `.bodyEmphasis` | 17 | semibold | `label` | the name of a device / subscription / item | the OS-shaped rows in Cài đặt (those stay `body` regular) |
| `rowValue` | `.body` + `weight: .medium` | 17 | medium | `label` for money, the state colour for a date | the trailing column of a row | a label |
| `body` | `.body` | 17 | regular | `label2` | one sentence that explains a block | a list row |
| `meta` | `.footnote` | 13 | regular | `label3` | the second line of a row, footers, counts | a value |
| `eyebrow` | `.footnoteEmphasis` | 13 | semibold | `label3` | ≤ 3 words above a lead block, sentence case | anything uppercase |

Rules that fall out of the table:

* **Uppercase is gone from content.** It survives in exactly one component —
  `WVSectionHeader`, the OS-shaped grouped-list header used by Cài đặt / Hồ sơ /
  Thêm — at 13 pt semibold, tracking `0.5`, `label3`, 16 pt inset. That is the
  only `.uppercased()` allowed in `ios/App/Features`. Today there are 8 sites.
* **`.tracking()` is gone from content.** One value, in `WVSectionHeader`, as
  above. Today there are 6 sites, all 1.0, all on heroes that are being removed.
* **Two weights per row, not four.** A row has a `rowTitle` and a `rowValue` (or
  a `meta`). A chip or a pill is not a third text role; it is a word.
* **Minimum sizes:** nothing below 13 pt except icon glyphs. (Today: 11 pt
  eyebrows and 9 pt chart axis labels.)
* **Chart axis labels keep their fixed 9 pt** — see `Fonts.swift:41-47`; they are
  geometry, not text. Do not "fix" them.

---

## 3. Spacing

A 4 pt base, six steps, no others:

| step | token | what uses it |
|---|---|---|
| **4** | `WVSpacing.xs` | a line-to-line nudge inside a chip; the inset of a 4 pt strip |
| **8** | `WVSpacing.sm` | title ↔ meta inside a row; between a card's lines; below a group header; row vertical padding |
| **12** | `WVSpacing.md` | icon ↔ text inside a row; the gap inside an HStack of two facts |
| **16** | `WVSpacing.gutter` / `.lg` | **the** screen gutter, card padding, row horizontal padding, footer inset |
| **24** | `WVSpacing.xl` | above a section heading |
| **32** | new: `WVSpacing.xxl` | the top of a screen hero and the vertical padding of an empty state — nowhere else |

Deleted, with their replacements: `2→4`, `3→4`, `6→8`, `7→8`, `10→12`, `14→16`,
`18→16`, `20→16`, `60/62/76→56` (dividers only, see below), `titleGutter 20→16`.

Two consequences worth stating out loud, because they change every screen:

* **The 20 pt and 32 pt left edges die.** Section headings, headers, footers and
  cards all start at **16 pt**. `WVSectionHeader`/`WVSectionFooter` go from 32 to
  16 (`Components.swift:143`, `:157`); `WVDashSectionHead` goes from 20 to 16
  (`Components.swift:874`); `WVSpacing.titleGutter` becomes 16.
* **Dividers align to the title, not to the card edge.** With a 28 pt leading
  tile and a 12 pt gap that is `16 + 28 + 12 = 56`. One constant, one value,
  every list: `WVDivider.rowInset = 56`. (Today: 16 / 60 / 62 / 76.)

Row geometry: `min-height 44`, horizontal `16`, vertical `8` (today 7), icon
tile `28` with a `20` pt glyph, icon↔title `12`, chevron `13`, divider `0.5 pt`
inset `56`.

---

## 4. Shape

Three radii, and a reason for each:

| radius | name | what it is |
|---|---|---|
| **8** | `WVRadius.sm` | anything the size of a control: segmented thumb and track, chips, tags, a 28 pt icon tile, a small button |
| **12** | `WVRadius.list` | a **group** of rows, a **row-card** (attachment, notice), every button, a 64 pt thumbnail, skeleton blocks |
| **16** | `WVRadius.card` | a **screen-level card** — the one block that leads a screen |

Deleted: `14` (→16), `18` (→16), `999` (capsule is no longer a card shape),
`10` (→8), `9`/`7` (→8), `6` (→8), `2` (the 4 pt strip is a `Capsule`, which is
radius = width / 2 and not a number anyone types), and the computed
`size * 0.23` on icon tiles (→ 8). `4` survives as the radius of a placeholder
text bar and a chart bar — nothing else.

**When a card is a card.** A card is *one object and the action on it*, it sets
itself apart from the page background (`bg2` on `bg`), it never contains a
divider, and **a screen may have at most one** — the lead. Today at least seven kinds of thing
call themselves a card: the deadline card, three gradient heroes, six stat
tiles, a widget, a `WVSectionCard`, a `WVNotice`, and the attachment card. After
this document: the dashboard's deadline card and the subscription total are
cards; stat tiles become rows; the gradients are gone; the attachment card
becomes a group of rows.

**When a row is a row.** A row is *one item among peers*. It has no background
of its own, no radius of its own, no shadow. It lives inside a group (12 pt,
`bg2`), separated by a 0.5 pt hairline inset 56, and it is the same row
everywhere it appears — devices list, dashboard preview, search results. Same
name, same value column, same colour rules. That is what makes search results
legible as "the same object you saw on its own screen".

**Pills are gone.** A capsule around a phrase was doing the work of a column.
The only filled shapes left in content are the 4 pt urgency strip (a capsule,
4 × len, inset 14 vertically, on the lead card only) and the one amber warning
chip on device detail.

---

## 5. Colour

### 5.1 Coral keeps exactly one meaning: **this is the action**

`WVColor.brand` / `WVColor.tint` (#FF6B45, #FF8060 in dark) may be used for:

1. the **selected tab** and the navigation tint (the platform's "you are here"),
2. **one** primary affordance per screen — a toolbar "+", a filled `WVButton`,
   or the dashed "Thêm" receipt tile on device detail.

And nothing else. Concretely, from today:

* **Out:** the category accent (`WVCategory.accent` → `WVColor.gray`; the phone
  category stops being coral). Icon tiles become `fill3` + `label2` glyphs.
* **Out:** the three gradient heroes and every literal `Color(hex:)` in
  `App/Features` (5 sites).
* **Out:** coral for a secondary control. The filter icon, the camera badge, the
  "Hủy" in search, the "..." on device detail, the checkmark in Cài đặt: all
  become `label` / `label2`. The checkmark is `label` because position already
  says "selected".
* **Out:** coral text links inside cards. The card is tappable; press feedback
  says so.

### 5.2 The state scale keeps its meanings

| colour | token | means | appears as |
|---|---|---|---|
| green | `WVColor.green` #34C759 | good: > 90 days left, or a positive verdict ("đáng sửa") | text, never a fill |
| amber | `WVColor.orange` #FF9500 | caution: 31–90 days left, or data that needs a look (brand mismatch) | text; the one warning chip |
| red | `WVColor.red` #FF3B30 | act: ≤ 30 days left, or a destructive action | text, the 4 pt strip, the destructive row's label |
| gray | `WVColor.label3` | past, sold, unknown — nothing to do | text |

The **thresholds do not change**: `≤30` red, `31…90` amber, `>90` green,
`<0` expired (`Sources/WarrlyKit/WarrantyPillCopy.swift:26-32`). They are unit
tested; this document changes how they are drawn, not when they fire.

Rules:

* **Status is text, not a fill.** No tinted pill behind the number, no coloured
  row background, no red card. The only filled state signal is the 4 pt strip on
  a lead card.
* **Money is always `label`.** Never red, never green. Only *dates* take a state
  colour.
* **A count is not a state.** The red `6` badge on "Việc cần xử lý" becomes a
  neutral `rowValue`; six things to do is not six alarms.
* **Expired is gray, including an expired subscription.** `Quá hạn 1719d` in red
  is an alarm about the past; it becomes `chưa ghi nhận kỳ mới` in `label3`
  (nobody can act on 2022).
* **One exception to "coral = action": the 12-month spend chart on Thống kê.**
  A chart is a picture of the data and needs data ink; it keeps the coral bars.
  Everywhere else, coral is an action.

### 5.3 Dark mode

Every token above is already `Color.adaptive`. Two rules for the new work: never
hard-code `.black` / `.white` except on top of coral or a state colour, and the
`fill3` icon tile is `fill3` in both schemes (it already resolves correctly).

---

## 6. The deadline column — the one new pattern

Everything dense in this app is a list of things that have a date. Give that
column one grammar and stop inventing per-screen ones.

**In a row** (devices, dashboard preview, search results, subscription renewals),
trailing, right-aligned, one line, `rowValue`:

| state | string | colour | example |
|---|---|---|---|
| > 90 days | the absolute date | `label3` | `20/09/2027` |
| 1–90 days | `còn N ngày` | red if ≤30, amber if 31–90 | `còn 18 ngày` |
| today | `hết hạn hôm nay` | red | |
| past | `đã hết hạn` | `label3` | |
| sold | `đã bán` | `label3` | |
| no date | `chưa có hạn` | `label4` | |

Why a date instead of "~11th" or "2 năm": a fuzzy countdown is not actionable and
it is what forces the abbreviations. A date is stable, fits in the column, and
is the fact a user puts in a calendar. The day count appears only in the window
where it changes a decision.

**On a lead surface** (device-detail hero, dashboard lead card), three lines:

```
eyebrow   Bảo hành                   13 semibold  label3
lead      còn 324 ngày               28 bold      the state colour
meta      Hết hạn 20/09/2027         13 regular   label3
```

The number is the lead, the date is its caption. That is the inversion this app
is missing: today the date line is 15 pt green under a 64 pt icon.

Wording is fixed by `Sources/WarrlyKit/DeadlineCopy.swift` — absolute date always
present, `quá hạn` its own phrase, never a negative "còn". Do not restate dates
as `%d ngày` only.

---

## 7. What each screen leads with

One sentence per screen. This is the decision; the briefs in §8 are how.

| # | screen | leads with | nothing above it except |
|---|---|---|---|
| 3 | **Tổng quan** | the next deadline you can still act on, as one card with its day count at 28 pt | the 34 pt title |
| 1 | **Thiết bị** | the most urgent device, first row, because the list is ordered by deadline | the 34 pt title and the search field |
| 2 | **Chi tiết thiết bị** | the deadline itself — `còn 324 ngày` at 28 pt with its absolute date — not the icon, not the name | the navigation bar |
| 4 | **Thống kê** | the value still under warranty, as money, with how many devices it covers | the navigation bar |
| 5 | **Đăng ký** | the monthly cost, as a plain number on a white card | the 34 pt title and the search field |
| 6 | **Wishlist** | the items themselves — there is no summary block on this screen | the 34 pt title and the search field |
| 7 | **Cài đặt** | the first group, exactly as iOS does it; this screen has no lead and should not get one | the navigation bar |
| 8 | **Tìm kiếm** | the query field, then results grouped by type | nothing |

Two of these should mostly be left alone, and their agents should be told to
stop early:

* **Cài đặt** — tokens and two corrections, no restructuring (§8.7). It is the
  one screen that is already right: a standard grouped list, one thing per row,
  no hero, no decoration.
* **The receipt strip** on Chi tiết thiết bị — it is already in the right place,
  at the right size, for the right reason. Do not touch it (§9.1). The deadline
  line next to it is also the right idea at the wrong size (§8.2) — fix the size,
  not the idea.

---

## 8. Screen briefs

Every brief assumes the token work in §10.1 has landed. Numbers below are the
final values — use them literally even if the token does not exist yet.

### 8.1 Thiết bị — `Features/Devices/DevicesScreen.swift`

**Leads with:** the most urgent device.

* Default sort becomes `.warrantyAsc` ("BH sắp hết trước" already exists,
  `DevicesScreen.swift:117`). It is a one-line default change; the menu keeps all
  five options. Sold devices sort to the end of every order — they are not
  deadlines.
* Row: 28 pt `fill3` tile (radius 8) with a 20 pt `label2` glyph, name
  `rowTitle` 17 semibold, meta `Apple · 34.990.000 ₫` 13 `label3`, trailing
  deadline column per §6, chevron 13 `label4`. No pill.
* The name never truncates before the value does: give the title
  `layoutPriority(1)` and the value a fixed max width of 96 pt.
* Toolbar: `+` stays coral (the screen's one action). Filter and camera become
  `label2` glyphs, no filled tile. The camera remains a shortcut into the same
  capture flow.
* Search field: `fill3`, radius 8, 36 pt tall, 16 pt gutter, 8 pt below the
  title. It scrolls with the list.
* Footer `7 thiết bị` → 13 `label3` at the 16 pt gutter.
* Skeleton: four rows, 28 pt icon block, two bars, **and a 64 × 13 bar on the
  trailing edge**, so the placeholder has the same silhouette as the row.

**Must not lose:** the filter menu, the attachment-count glyph, the brand
mismatch glyph, `WVEmpty` for zero devices and for a filtered-to-zero result.

### 8.2 Chi tiết thiết bị — `Features/Devices/DeviceDetailView.swift`, `AttachmentsSection.swift`

**Leads with:** the deadline.

* Hero, left-aligned (not centred):
  * 20 pt neutral glyph + device name `section` 20 semibold on one line,
  * the deadline block from §6 (eyebrow / 28 pt lead / date),
  * the status chip `Đang dùng` is **removed** — the deadline line already says
    it. Keep the amber brand-mismatch chip.
* The 64 pt coral icon goes. The name stays in the hero but drops from 22 bold
  to 20 semibold — it is the caption to the deadline, not a second title
  competing with the navigation bar.
* Receipt strip stays exactly where it is, directly under the deadline block,
  first thing after the hero — 64 pt tiles, 10 pt apart, 12 pt radius, the
  dashed coral "Thêm" tile as the screen's one coral action. **Do not touch its
  behaviour** (§9).
* Attachment management card → a group of rows: 56 pt thumbnail (12), filename
  `rowTitle`, description `meta`, and one `...` menu per row carrying Sửa mô tả /
  Xoá. The 176 pt tile with two floating circular buttons goes.
* `Mua hàng` / `Nhắc nhở` rows: neutral 20 pt glyphs, no coloured tiles, values
  `rowValue` `label3`, dividers inset 56.
* Section order stays: deadline → receipts (the strip) → File đính kèm (now a
  group of rows) → Bảo hành & sửa chữa → Mua hàng → Nhắc nhở → Trạng thái →
  Xoá thiết bị.
* `Xoá thiết bị` keeps red text but loses the red badge: 20 pt red glyph, label
  red, no fill.
* `Trạng thái` segmented control: track `fill3` radius 8, thumb `bg2` radius 8,
  13 semibold, 2 pt inset.

**Must not lose:** the receipt strip, the repair-extension note under the date
line (`WarrantyRepairAdjustment.legalNote`), the mismatch chip, the attachment
ownership model (one `DeviceAttachmentsModel` feeding both surfaces).

### 8.3 Tổng quan — `Features/Dashboard/DashboardView.swift`, `DeadlineSection.swift`

**Leads with:** the next deadline you can still act on.

* **Delete `WVHeroGreeting`** — the avatar, "Chào buổi sáng", the user's name.
  The name lives in Hồ sơ. This removes ~70 pt and the biggest coral thing on
  the screen.
* Lead card = the first candidate with `days >= 0`, not `board.nearest`
  (`DeadlineBoard.board` keeps its rule; the *view* picks). If every candidate
  is past, the card shows the most recent one with the eyebrow `Đã qua` and the
  date in `label3`.
* Card: 16 pt radius, 16 pt padding, `bg2`, 4 pt capsule strip inset 14
  vertically in the state colour. Lines: kind eyebrow (`Bảo hành` / `Gói đăng
  ký` / `Đang thêm`) → name 20 semibold → `còn 18 ngày` 28 bold in state colour
  → `Hết hạn 18/11/2026` 13 `label3`. No "Xem chi tiết" link; the card is
  tappable.
* The row list under it keeps 3 rows, same row anatomy as §8.1, including the
  overdue ones (sorted by date, so they come first) with `đã hết hạn` in
  `label3`.
* Section heads become `WVSectionHeader` at 20 semibold, 16 pt inset, 24/8.
* "Việc cần xử lý": the section head and the card title currently say the same
  words three times. The card becomes one row — 20 pt glyph, title
  `6 việc cần xử lý`, meta `1 mức cao`, trailing chevron. No red badge.
* "Gói đăng ký": white card, `724.000 ₫` 28 bold, `/ tháng` 13 `label3` beside
  it, `≈ 8.688.000 ₫ một năm · 3 gói đang chạy` 13 below. Remove the
  `SẮP GIA HẠN` uppercase kicker; the three rows carry their own dates and
  colours (§6).
* "Đang thêm": rows with name + price, no truncation before the price — the
  name gets layout priority.
* The legal footer (`Đây là quyền lợi theo khoản 2.c Điều 30 Luật 19/2023…`)
  stays, 13 `label3`, 16 pt inset, max two lines.

**Must not lose:** the partial-failure note ("Một số hạn có thể chưa được tải"),
the repair-extension legal note, the empty state ("Chưa có hạn nào" + "Thêm thiết
bị"), the fact that an empty board is only shown once every read has answered.

### 8.4 Thống kê — `Features/Stats/StatsView.swift`

**Leads with:** the value still under warranty.

* Delete the gradient hero. The lead block is a plain block on `bg` (no card,
  no radius): eyebrow `Giá trị còn bảo hành` → `123.900.000 ₫` 28 bold `label` →
  `4 trên 7 thiết bị · 1 thiết bị hết trong 30 ngày` 13 `label3`. The second
  clause is printed only when at least one device is inside 30 days, and then it
  is red — that is the sentence's whole point.
* The 2-column tile grid becomes **groups of rows** (12 pt, `bg2`), one row per
  number: label `rowTitle` left, value `rowValue` right. Groups: `Bảo hành`,
  `Chi phí`, `Gói đăng ký`. Money is always the full number
  (`176.300.000 ₫`, not `176,3 tr ₫`), `lineLimit(1)`, `minimumScaleFactor(0.7)`.
* `SUB MỖI THÁNG` → `Gói đăng ký mỗi tháng` (and it is not an eyebrow any more).
* The repair-verdict block ("Đáng sửa hay không, so với giá mua") stays a card —
  it is one object with three devices and a verdict each. 16 pt radius. Verdict
  text keeps green/red per device (§5.2), the rest of the line is `meta`.
* The 12-month chart keeps its coral bars (the one exception, §5.2), gets 12 pt
  radius and 16 pt padding. Its x-axis labels currently truncate (`02/…`):
  label each bar `T1`…`T12` and put the range in the section header
  (`Chi phí 12 tháng · 11/2025 – 10/2026`). Nothing on an axis may be cut off.
* Every `CHI PHÍ & TÀI SẢN`-style uppercase header becomes `WVSectionHeader`
  (20 semibold, 16 inset).
* The explanatory sentence above the chart ("Gồm tiền thiết bị và gói bảo
  hành…") becomes a 13 pt `label3` **footer below the chart**, not a 17 pt
  paragraph above it.

**Must not lose:** the partial-stats warning (`WVNotice`), the per-device repair
rows, the forecast rows, the chart itself.

### 8.5 Đăng ký — `Features/Subscriptions/SubscriptionsScreen.swift`

**Leads with:** the monthly cost.

* Delete the indigo→blue gradient. The total becomes a white card (16 radius,
  16 padding): eyebrow `Mỗi tháng` → `724.000 ₫` 28 bold `label` →
  `≈ 8.688.000 ₫ một năm · 3 gói đang chạy` 13 `label3`.
* "Soát gói đăng ký": the 3-line paragraph inside the row is a paragraph, not a
  row. It becomes a card above the list with the paragraph at 13 `label3` and a
  `WVButton(.secondary)` "Soát gói đăng ký"; the purple tile goes (neutral glyph).
* Segmented control: 8 pt track and thumb, 13 semibold, `fill3` / `bg2`.
* Rows: 20 pt neutral glyph, name `rowTitle`, meta `Apple · Hàng tháng`, trailing
  column = the price in `rowValue` `label` with the renewal date under it in
  `meta`, coloured by §6 (`chưa ghi nhận kỳ mới` in `label3` for the three past
  dates; `còn 31 ngày` in amber for Adobe).
* Sort the list by next renewal date ascending, within the segment.
* Three of the four subscription rows fall back to the same gray shipping-box
  icon (`05-subscriptions.png`: Spotify, Netflix, Adobe) because their catalog
  category is missing; only iCloud has one. With neutral glyphs this is no
  longer loud, but the fallback should still be
  `arrow.triangle.2.circlepath`, not a parcel.

**Must not lose:** the three segments and their meaning, the `4 gói` count, the
audit entry point.

### 8.6 Wishlist — `Features/Wishlist/WishlistScreen.swift`

**Leads with:** the items. No summary block.

* Delete the pink→purple gradient and the `ĐANG THÊM 3 MÓN / 57.380.000 ₫` hero.
  It becomes one line under the title: `3 món · 57.380.000 ₫` at 13 `label3`.
* Segments directly under that line (`Đang thêm / Đã mua / Tất cả`).
* Rows: 20 pt neutral glyph, name `rowTitle`, meta `Apple · Laptop` using
  **`CategoryLabels.label(for:)`**, not the raw code; trailing price `rowValue`
  `label` and the target-date column per §6 when the item has one.
* The delta line (`↓ 12,5%`) stays `meta` with the state colour — it is a
  verdict, not an identity.
* `Wishlist` as a title and tab label stays English: the web app and the other
  client call it that (`website/src/.../wishlist`). Do not "translate" it here.

**Must not lose:** the segment meanings, the delta, the empty state.

### 8.7 Cài đặt — `Features/Settings/SettingsView.swift`, `AccountView.swift`, `Features/More/MoreScreen.swift`

**This screen is already structurally right. Do not redesign it.** It is an
OS-shaped grouped list, and it should look like one. Changes are tokens and two
corrections:

* `WVSectionHeader` at 13 semibold uppercase tracking 0.5 `label3`, **16 pt
  inset** (was 32). Same for `WVSectionFooter` (16, 8 pt below the group).
* **Footers always go below the group they explain.** Today the language footer
  is below, the reminder footer is above, the AI footer is above, the backup
  footer is above (`SettingsView.swift:206-229`). Move all four below, 8 pt
  after the card.
* Delete the redundant `Giao diện tối` row in the first group — the `Chế độ`
  group right below it is the real control (`appearanceSection`,
  `SettingsView.swift:443`). Two controls for one setting, one of them without a
  switch glyph, is the only actual bug on this screen.
* Row icons: `fill3` tile + `label2` glyph, 28 pt, radius 8. The saturated
  rows on the Thêm screen (`07c-more.png`: nine hues, one per row — indigo,
  orange, red, indigo, orange, blue, gray, green, orange) and the six blue
  globes on the language rows go neutral. Selection keeps its checkmark, in
  `label` (not coral).
* `WVRow` stays 17 `body` regular — it is an OS row, not a content row.
* Truncated row (`Bảng kê cho bảo hiểm (tiếng V…`): allow the title 2 lines and
  drop the subtitle to `meta` with 1 line; never truncate the title first.

**Must not lose:** every row's behaviour, the AI opt-in switch and its one
shared flag, the conditional privacy-options row (it must stay absent when UMP
does not require it), the `Đăng xuất` flow.

### 8.8 Tìm kiếm — `Features/Search/SearchScreen.swift`

**Leads with:** the query.

* Search field: `fill3`, radius 8, 36 pt tall, 16 pt gutter; `Hủy` becomes
  `label` 17 (today coral).
* Result count `5 kết quả` → 13 `label3`, 16 pt inset.
* Group headers `THIẾT BỊ / ĐĂNG KÝ / WISHLIST` → `WVSectionHeader` 20 semibold
  sentence case (`Thiết bị`, `Đăng ký`, `Wishlist`), 16 pt inset, 24/8.
* Every result row is the same row as its home screen, per §6/§8.1: device rows
  get the deadline column, subscription rows the price + renewal, wishlist rows
  the price + target date. No per-entity chip grammar.
* Empty state keeps `WVEmpty` (icon 40, title 20 semibold, description 13
  `label3`, max 280 wide).

**Must not lose:** the diacritic-insensitive hint copy in the empty state, the
grouping order, the debounce.

---

## 9. What must not change

These are the parts that already work. A redesign that damages them is a
regression, and each has a reason:

1. **The receipt strip in the device hero.** 64 pt tiles, horizontal scroll,
   directly under the name/deadline, the dashed coral "Thêm" tile at the end,
   tap-to-preview through `QLPreviewSheet`, one `DeviceAttachmentsModel` for
   both surfaces. The strip is the product's promise — "keep the receipt" — and
   it is the only part of the app that is *already* in the right place. Change
   nothing about it except the gap between tiles (10 → 12).
2. **The skeleton states.** Static `.redacted` placeholders, no shimmer, no
   spinner for a list's first load (`DevicesScreen.swift:447-470`,
   `DeadlineSkeleton`). Four screens already share this vocabulary. The *shape*
   may be corrected to match the new row (§8.1) — the *behaviour* may not.
3. **The disclosure.** `WVDisclosure` — a full-width header with icon, title,
   one-line subtitle and a chevron; content expands below with a 200 ms
   ease-in-out. Keep the interaction, the chevron swap and the accessibility
   hint. Only the radius (12) and the icon tile (neutral) move.
4. **The loading vocabulary.** One bootstrap spinner; skeleton for a first list
   read; an inline "Thử lại" row when a read fails; a toast only after a write
   completes; never an empty state before the first read has answered. Do not
   add pull-to-refresh spinners where a skeleton exists, and do not replace
   `WVEmpty` with a card.
5. **The 4 pt urgency strip** on the lead card — keep it, keep it 4 pt and inset
   14, keep it the card's only filled colour. (It generalises to nothing else;
   do not add it to rows.)
6. **The tab bar**: five tabs, same labels, same order, same SF Symbols.
7. **The deadline copy rules** in `DeadlineCopy`: absolute date always present,
   `quá hạn` its own phrase, never a negative "còn", the repair-extension
   legal note verbatim.
8. **Every string that is a legal or privacy statement** — the Luật 19/2023
   footer, the AI third-party disclosure, the backup warning, the
   "Thiết bị đăng nhập" explanation. They may move, shrink to 13 pt and be
   re-inset; they may not be shortened or summarised.
9. **The bilingual policy**: UI follows the user's language, artifacts (email,
   push, certificate) are Vietnamese. `Wishlist` stays English by product
   convention (§8.6); everything else in these eight screens is Vietnamese.

---

## 10. Applying it with eight agents

### 10.1 Step 0 — tokens and shared components (one agent, before the eight)

Four files (`Fonts.swift` needs no change), no screen changes. Everything here
is a value or a one-line behaviour change, so it cannot conflict with the screen
work.

| file | change |
|---|---|
| `DesignSystem/Theme.swift` | `WVRadius.card 14→16`, `widget 18→16`, `sm 8`, `list 12`; `WVSpacing.titleGutter 20→16`; add `WVSpacing.xxl = 32` |
| `DesignSystem/Components.swift` | `WVSectionHeader`/`WVSectionFooter`: inset 32→16, footer top 7→8; `WVDashSectionHead` → 20 semibold, 16 inset, 24/8; `WVLeadingIcon`: always `fill3` + `label2` (ignore `color:`), radius 8; `WVRow`: vertical 7→8; `WVButton` radius 14→12 / 10→8; `WVSegmented` 9/7→8/8; `WVTag` 6→8; `WVCard` radius 16; `WVChip` capsule→8, 13 pt; `WVDivider` default inset 16→56; `WVEmpty` title 22→20 semibold, description 15→13 |
| `DesignSystem/Components.swift` (2) | `WarrantyPill` → `WarrantyPill(daysLeft:endDate:)`: no fill, no capsule, `rowValue` 17 medium, and the §6 grammar needs the date, so add `endDate: Date?` and render the absolute date for > 90 days. Leave `WarrantyPillCopy` and its tests untouched — it keeps the thresholds; the view stops using its abbreviation strings |
| `DesignSystem/Formatters.swift` | `WVCategory.accent(for:)` → always `WVColor.gray` (keep the function so no call site breaks) |
| `DesignSystem/Fonts.swift` | none — every role in §2 already exists |

Then a mechanical sweep, by grep, in `App/Features`:

* `cornerRadius: 6|7|9|10|14|18` → the nearest of 8/12/16
* `WVDivider(inset: 60|62|76)` → `56`
* `padding(.horizontal, 32)` on a header/footer → `16`
* `padding(.vertical, 7)` → `8`
* `padding(14)` / `padding(18)` → `16`
* `Color(hex:` inside `App/Features` — there are five sites: three are the
  gradients on the list screens (removed by their own agents, §8.4–8.6), two are
  the auth screens, which are out of scope. Step 0 leaves all five alone.
* `LinearGradient` inside `App/Features` → remove on the three list screens
  (those three are owned by their screen agents, not by step 0)

### 10.2 Step 1 — eight agents, one screen each

| agent | owns | may not edit |
|---|---|---|
| 1 Thiết bị | `Features/Devices/DevicesScreen.swift` | everything else |
| 2 Chi tiết thiết bị | `Features/Devices/DeviceDetailView.swift`, `AttachmentsSection.swift` | `Components.swift`, `AttachmentPreview.swift` |
| 3 Tổng quan | `Features/Dashboard/DashboardView.swift`, `DeadlineSection.swift` | `Sources/WarrlyKit/DeadlineBoard.swift` |
| 4 Thống kê | `Features/Stats/StatsView.swift`, `DesignSystem/Charts.swift` | `StatsRollup` |
| 5 Đăng ký | `Features/Subscriptions/SubscriptionsScreen.swift` | the audit sheet |
| 6 Wishlist | `Features/Wishlist/WishlistScreen.swift` | `CategoryLabels` |
| 7 Cài đặt | `Features/Settings/SettingsView.swift`, `AccountView.swift`, `Features/More/MoreScreen.swift` | `Components.swift` |
| 8 Tìm kiếm | `Features/Search/SearchScreen.swift` | the search debounce logic |

Do **not** create new shared components in `DesignSystem/` during step 1. If two
screens need the same row, each writes it inline to §6; unifying them is a
follow-up, after the eight land.

### 10.3 Acceptance checks (run these before you call a screen done)

1. `grep -n "uppercased()" <your file>` → no hits outside `WVSectionHeader`.
2. `grep -n "tracking(" <your file>` → no hits.
3. `grep -nE "cornerRadius: (6|7|9|10|14|18)" <your file>` → no hits.
4. `grep -nE "padding\((6|7|10|14|18|20)\)" <your file>` → no hits. `32` is
   allowed in exactly two places: the top padding of a screen hero and the
   vertical padding of a `WVEmpty`.
5. Coral appears at most twice: the tab selection and one action.
6. Every coloured thing on the screen is a date, a verdict, or that one action.
7. Screenshot at default text size in light **and** dark; every text role still
   resolves through `WVFont`; nothing clips at AX3.
8. No row's `title` truncates before its trailing value does.

### 10.4 Taking your own after-shots

`ios/build/qa-visual/README.md` has the exact commands (simulator, QA token,
`WV_QA_TAB`, `WV_QA_DEVICE_ID`, `WV_QA_SCROLL_TO_WARRANTY`). Drop your shots in
`ios/build/qa-visual/after/<n>-<screen>.png` with the same names as `before/`,
so the two sets diff by eye.

---

## 11. What I could not see

* **Inbox** — not captured (Search was the eighth screen). The tab had no badge,
  so I expect the empty state; I did not open the screen and did not photograph
  it.
* **Dark mode, Accessibility sizes, iPad, iOS 26** — every shot is light, Large,
  iPhone 16 Pro on iOS 18.3. The direction is specified for both schemes but the
  dark pass is unphotographed.
* **Empty and error states of the list screens** — the account has 7 devices / 5
  subscriptions / 3 wishlist items, so only the populated states exist. I did
  not fabricate data.
* **A sold device's detail, a device with no warranty, a device with a brand
  mismatch, and a repair extension** — none of these states exist on this
  account, so the amber chip, the repair note and the `đã bán` row are specified
  from code, not from a screenshot.
* **The device form, the claim form, the reminders screen, the action queue** —
  out of scope for the eight screens, but they share the components in §10.1 and
  will inherit the token change. They should get their own pass.
* The API was **not running** when I started; I started it against
  `warranty_vault_typography` to take these shots. The build is from the working
  tree at `11e0e67` plus the uncommitted changes present on 2026-10-31
  (`DeviceDetailView`, `ClaimFormView`, `ClaimsSection`, `WarrantiesStore`,
  `StatsRollup`, …) — so these shots show the working tree, not `HEAD`.
