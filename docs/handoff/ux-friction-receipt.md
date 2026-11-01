# Warrly iOS — finding a receipt

**Task mapped:** *"I need the invoice for my laptop"* and *"which of these files is the one I need"*.
**Status:** analysis only. No app code was touched to produce this; the only file written is this one.
**Evidence snapshot:** repo `79b600a` (2026-11-01 05:43 +0700), clean tree, read 2026-11-01, 05:50 ICT.
**Tagging:** `[fact]` = verifiable at the cited `file:line` or screenshot · `[judgement]` = my reasoning over those facts.
**Screenshot vintage — read this before quoting a number.** The newest shots (`ios/build/qa-five-forms/`, 31 Oct 20:22–20:24) match the current code but are all **device-form** screens; none of them shows a receipt. The newest shot of this task's surfaces is `ios/build/qa-visual/after/02-device-detail.png` (31 Oct 08:59) and `08-search.png` (31 Oct 09:19) — both **older than the form work**. They are still usable for the receipt strip because `WARRLY-visual-direction.md:699-704` freezes that component (§9.1: "Change nothing about it except the gap between tiles"), so its anatomy has not moved since the shot. They are **not** evidence for anything the form work touched. `login/` is irrelevant to this task.

---

## 0. The task, and what "done" means

Two intents share one outcome — *the receipt is legible on screen* — and diverge on the question the user can answer:

| intent | what the user can name | what they are actually asking |
|---|---|---|
| A | the device ("my laptop") | *show me the file attached to that device* |
| B | the content ("the one with 65W on it", "the shop one") | *find the file, I don't know which device* |

Two surfaces hold the same file: the **receipt strip** in the device hero (`AttachmentsSection.swift:167-270`) and the **inbox** (`InboxScreen.swift`). They are not two views of one list — the inbox is *only* the files with no device (`attachments.sql:18-25`, `WHERE a."deviceId" IS NULL`), so a filed receipt is reachable from the device it was filed to, or from search if OCR text exists (§3).

**Fields: 0 required, 1 optional** — the search query (`SearchScreen.swift:99`), and browsing needs not even that. That is a deliberate strength of the browse path and the reason every cost below is measured in taps, not typing.

---

## 1. Walkthrough, counted

Tap = one touch on a control that navigates or changes state. Typing is not a tap. "Screens" counts distinct full-screen views, not overlays.

### Route A — "I need the invoice for my laptop" (device known, receipt filed)

| # | action | evidence |
|---|---|---|
| 0 | app opens on **Tổng quan** | `RootView.swift:232-233` (`tag(0)` is the default) |
| 1 | tap **Thiết bị** tab | `RootView.swift:238-239` |
| 2 | tap the laptop row | `DevicesScreen.swift:322-324` |
| 3 | tap one 64 pt tile in the hero strip | `AttachmentsSection.swift:185-202` |

**3 taps · 0 fields · 2 screens + 1 full-screen preview · 1 decision.**
The third tap is the decision: *which tile?* The strip draws `AttachmentThumbnailImage` at 64 pt and nothing else — no filename, no date, no description (`AttachmentsSection.swift:178`, `:188-201`). The filename exists only as an accessibility label (`:200`), so a sighted user gets no text at all. For PDFs it is worse: every PDF renders the same generic `receipt` glyph (`AttachmentPreview.swift:77`), so two PDFs are pixel-identical tiles.
Wrong guess costs **2 taps** (close, `AttachmentPreview.swift:181-189`; next tile) **plus one full blob re-download** — `QLPreviewSheet` has no byte cache (`AttachmentPreview.swift:207-230`), so each guess waits on the network. The thumbnail cache (`AttachmentPreview.swift:34-52`) does not help; it caches a different, smaller decode.

`02-device-detail.png` is this route at its best case: one receipt, so there is nothing to guess. `[fact]` It also shows the escape hatch — the same receipt, labelled, sits immediately below in "FILE ĐÍNH KÈM (1/5)" (`AttachmentsSection.swift:318-328`), where the filename and description are printed, and both are visible at once. `[judgement]` So the strip's ambiguity is partly self-correcting for a user who scans the whole screen — but the strip is the surface the eye lands on first, and nothing on it says the labelled version exists below.

### Route B — "which of these files" (receipt still in the inbox)

| # | action | evidence |
|---|---|---|
| 1 | tap **Thêm** tab | `RootView.swift:256-261` |
| 2 | tap **Hộp thư đến** | `MoreScreen.swift:158-159` |
| 3 | — | **there is no tap that opens the file** |

`InboxAttachmentRow` (`InboxScreen.swift:289-334`) is a thumbnail, a 1-line filename, a date, a **"Gán vào thiết bị"** button and a `...` menu with exactly Gán/Xoá (`:308-329`). The thumbnail is not a button. The row body is not a button. The inbox lists files it will not show you.

**2 taps, then a dead end.** The only way to *see* an inbox receipt is to file it first: Gán (3) → pick a device (4) → the sheet dismisses and does not navigate (`InboxDevicePickerSheet.swift:199-202`) → tab Thiết bị (5) → device (6) → tile (7). **7 taps, and the file leaves the inbox to be looked at.**

`[fact]` In the inbox the filename is the only identifier, and for the app's own capture flow that filename is generated: camera → `receipt-<epoch>-<4 hex>` (`InboxCaptureSheet.swift:248-252`, `:301-303`), photo library → `photo-<epoch>` (`AttachmentsSection.swift:132`). `[judgement]` Truncated to one line (`InboxScreen.swift:303`), two receipts captured a minute apart differ only in characters past the visible width — so for the most common way a file reaches the inbox, the row carries **no distinguishing information at all**: not the name, and not a preview.

### Route C — "I only remember the shop"

| entry | taps | result |
|---|---|---|
| Tổng quan → magnifier → field | 2 + typing | **0 device results, 0 receipt results** |
| Thiết bị → search field | 2 + typing | **0 device results** |
| Thêm → Hộp thư đến | 2 | 0 rows (the receipt was filed) |

- Global search's device predicate covers `name`, `brand`, `model`, `serialNumber` — **not `purchasePlace`** (`search.sql:34-45`). Yet `purchasePlace` is a real field the form invites you to fill with exactly a shop name, placeholder "CellphoneS, TopZone..." (`DeviceFormView.swift:1144-1149`), stored on the device (`Models.swift:411`).
- The local Thiết bị filter is the same four fields (`DevicesScreen.swift:113-119`).
- The attachment predicate searches `extractedText` **only** — `fileName` and `description` are excluded on purpose (`search.sql:72-91`, comment at `:73-76`).

**The shop is the one thing the app stores and cannot find.** `[judgement]` This is the largest single friction in the task, because it is the only route that closes with no recovery except scrolling a 50-device list.

### Route D — search that does reach a receipt

| # | action | evidence |
|---|---|---|
| 1 | magnifier on Tổng quan (or Thêm → Tìm kiếm) | `DashboardView.swift:127-133` |
| 2 | tap the search field (the drawer displays but nothing focuses it — no `@FocusState` in the file) `[judgement]` | `SearchScreen.swift:95-100` |
| 3 | type, tap the hit | `SearchScreen.swift:233-239` |
| 4 | tap **Mở tệp** in the sheet | `AttachmentSearchPreviewSheet.swift:122-124` |

**4 taps + a query.** So search is *never* a shortcut to a receipt on a device you already know (Route A is 3). It only pays when you cannot name the device — which is Route C, the one it cannot answer.

And the hit is a terminal view. `AttachmentSearchHit` carries `deviceId` (`Search.swift:107-118`) and the preview sheet uses it for exactly one thing — the chip `hit.filing.label` (`AttachmentSearchPreviewSheet.swift:87`), which prints the generic word "Đã gắn thiết bị". `[fact]` The owning device's name is never shown and there is no way to open it. From the hit to the device's strip: close (1), tab Thiết bị (2), device (3), tile (4) — **4 taps of backtracking, in a flow that already knows the id.**

---

## 2. Where the user hesitates (question 1)

Not "slow" — stop, re-read, back out, guess.

1. **The strip tile** (`AttachmentsSection.swift:185-202`). 64 pt of unlabelled image; identical glyphs for every PDF. *Which of these is the one I need?* — the exact question the task names, asked at the first surface the design puts in front of the user.
2. **The inbox row** (`InboxScreen.swift:289-334`). The one visible action is "Gán vào thiết bị", so *how do I just look at it?* becomes *do I have to file this to see it?* — and the answer is yes.
3. **The search prompt** (`SearchScreen.swift:99`). It promises "Thiết bị, gói đăng ký, wishlist, **hoá đơn**...". `[judgement]` A promise the default account cannot keep (§3) is worse than no promise: the user concludes the receipt is gone rather than unindexed.
4. **"Hộp thư đến" as a name** (`MoreScreen.swift:161`). It reads as "everything that arrived"; it means "everything not yet filed". A filed receipt leaving the inbox is correct in code and surprising in language.
5. **The search failure state** (`SearchScreen.swift:147-152`). `WVEmpty` with no action closure — no "Thử lại". The only retry is to edit the query so `.task(id: query)` fires again (`SearchScreen.swift:106`). `[judgement]` On a flaky connection this reads as "search is broken", not "try again".

---

## 3. What the app already knows and makes the user supply (question 2)

| the app holds | where | what the user has to do instead |
|---|---|---|
| `Device.purchasePlace` — "CellphoneS" | `Models.swift:411`, written at `DeviceFormView.swift:1144` | remember the device, or scroll the list |
| `Attachment.fileName` | `AttachmentMeta` (`Models.swift:1653`) | read it off tiles that don't print it |
| `Attachment.description` — "Ảnh hộp máy chụp lúc mở seal" | shown at `AttachmentsSection.swift:478-483`; edited via ⋯ → Sửa mô tả (`:511-515`) | retype its meaning into the search box, where it matches nothing |
| `Attachment.deviceId` on every search hit | `Search.swift:110-118` | back out and re-find the device |
| `extractedText` | written only by the AI scan (`ai_extract.go:215-231`) | — |

Two consequences worth stating plainly:

- **Search reaches attachments only through OCR text, and OCR text only exists after an opt-in AI scan.** `aiOptIn` defaults to `false` (`api/migrations/0003_user_ai_optin.sql`), and `SetAttachmentExtractedText` is called from exactly one place (`ai_extract.go:222`). The inbox capture sheet and the strip's add tile upload with `description: nil` and no extraction at all (`AttachmentsSection.swift:100-113`, `InboxCaptureSheet.swift:248-252`). So on a fresh account the "hoá đơn" group in search is structurally always empty — not because the account has no receipts, but because nothing has ever written the column. `08-search.png` is consistent with exactly this (5 results, no Hoá đơn group) though it cannot prove it, since an empty group renders as nothing (`Search.swift:179-186`). `[fact + judgement]`
- **The description field is the fix that already shipped, hidden.** A receipt with a description is identifiable in the section — but the strip doesn't print it and search doesn't index it. `[judgement]`

---

## 4. When it fails (question 3)

- **Offline / read failure on the device detail.** The strip prints red text under the tiles (`AttachmentsSection.swift:211-216`) and the section prints a red `Label` (`:343-349`); the retry is pull-to-refresh (`DeviceDetailView.swift:680-683`). No "Thử lại" button. `[fact]`
- **The alarming one:** a failed attachments read leaves `attachments == []`, so the strip renders **zero tiles and the dashed "Thêm" tile** (`AttachmentsSection.swift:205`; `canUpload` is `count < 5`, `:58`). `[judgement]` The device looks like it has no receipts *and* invites you to add one — the two worst readings of a network error, and the user may re-photograph a receipt they already own.
- **At 5/5** the add tile silently disappears (`if model.canUpload`, `:205`) with no copy saying why. Filing an inbox item to that device is handled well by contrast: red `5/5` in the picker (`InboxDevicePickerSheet.swift:165-167`) and a 409 alert naming both ways out (`:70-84`).
- **Second attempt.** On the strip it is 2 taps per wrong tile, and each re-downloads the blob. In search it is "edit the query" because the failure state has no retry. In the inbox there is no first attempt — the file cannot be opened at all.
- **The outcome that has no path at all:** handing the file to someone. `QLPreviewSheet` deliberately ships no share sheet — "sharing would copy the decrypted file out of the app's sandbox, which is a separate decision" (`AttachmentPreview.swift:117-118`), and the share certificate's "never shown" list includes "Ảnh hoá đơn và mọi file đính kèm" (`ShareLinks.swift:175`). `[fact]` If "I need the invoice" means "I need to send it to my employer", the answer is no, and that is a product decision, not a bug — see §6.

---

## 5. The count, in one place

| route | taps to see the file | fields | screens | decisions | when it goes wrong |
|---|---|---|---|---|---|
| A device known, 1 receipt | **3** | 0 | 2 + preview | 1 — which tile | — |
| A device known, 5 receipts, worst case | 11 (3 + 4×2) | 0 | 2 + preview | 5 — every tile | +2 taps and a re-download per wrong tile |
| B inbox (unfiled) | **2, then no path** | 0 | 2 | 2 — is it even here? / file it to see it? | file it first: 7 taps, and the row leaves the inbox |
| C shop only | 2 + typing → **0 results** | 1 | 1 | 2 — which entry / do I believe "no results"? | no recovery except scrolling the list |
| D search hit (OCR'd file only) | 4 | 1 | 1 + sheet + preview | 2 — which hit / backtrack or give up | +4 taps to reach the owning device |

The happy path is genuinely good: **three taps, no fields, two screens, and the user never leaves the flow.** The friction is entirely in the branches — and the branches are where the memory is weak, which is the whole reason search exists. Route D is the only route that both leaves the flow and comes back (sheet → tab → device), and Route B cannot reach the outcome from where it starts at all.

---

## 6. Three changes, ranked by friction removed

No redesign; nothing here contradicts `WARRLY-visual-direction.md`. The strip (§9.1) and the search row's layout (§8.8) are left alone. Nothing AI-shaped is proposed: `WARRLY-ai-input-analysis.md` already owns image and text parsing, and none of the three changes below needs a model.

### 1. Index the three columns the app already holds — `purchasePlace`, `fileName`, `description`

Server-only: extend `SearchDevices` to `purchasePlace` (`search.sql:34-45`) and `SearchAttachments` to `fileName` / `description` alongside `extractedText` (`:72-91`), each with the identical `lower(public.wv_unaccent(...))` expression and the matching GIN index in one migration (the byte-for-byte rule at `search.sql:29-32` applies). No client change: the query, the row and the sheet already exist.

**Saves:** Route C goes from *no path* to *4 taps + a query* (magnifier → field → the laptop → its tile) — one tap more than Route A, which is the fair price of not remembering the device; today that memory is the entry fee and there is no alternative. It also makes the `hoá đơn` group non-empty on accounts that never enabled AI, so a receipt can be found by its filename or its description alone. Removes the only case in this task with no completion path at all.

### 2. Tap an inbox row to preview it, read-only

The bytes are already fetchable by id and the inbox already has an authenticated client; `QLPreviewSheet(client:attachment:)` is the same component the strip uses. Wrap the thumbnail + title block in a button, keep "Gán vào thiết bị" and the `...` menu exactly where they are (`InboxScreen.swift:295-329`). Nothing in §9 is touched — the inbox was never one of the eight screens ("Inbox — not captured", `WARRLY-visual-direction.md:806`).

**Saves:** 7 taps → 2 for "which of these files is this one", and stops the file having to leave the inbox (or be filed to the wrong device) just to be looked at.

### 3. Name the device on a search receipt hit, and let it open

The hit already carries `deviceId`; the sheet prints a generic chip instead (`AttachmentSearchPreviewSheet.swift:87`). Add the device name to the hit (one join in `SearchAttachments`) and make that chip open the device. This is inside the preview sheet, not the §8.8 row, so the "filing state as the second line" spec stands.

**Saves:** 4 taps of backtracking plus the re-find of the device, per receipt found by content. Ranks third only because it is worth little until change 1 gives search something to return.

**Not proposed, and why:** captions under the strip tiles would answer "which of these" directly, and they are the obvious fix — but §9.1 freezes that component, so it is the owner's call, not a UX tweak I can rank. A share/export path for one receipt is the honest answer to "I need the invoice" in its *hand-it-over* sense, but `AttachmentPreview.swift:117-118` says that is a deliberate privacy decision; it needs a consent design, not a button.

---

## 7. What I could not tell from the code

- **Which tile is a guess in practice.** The screenshots are demo-account shots with one receipt (`02-device-detail.png`). A 5-receipt device — the cap at `AttachmentsSection.swift:58` — was not photographed, so the worst-case tile hunt is arithmetic, not observation.
- **Whether the search field autofocuses.** There is no `@FocusState` in `SearchScreen.swift`; SwiftUI's `.navigationBarDrawer(displayMode: .always)` is documented as visible-but-unfocused, which is why I count tap 2 in Route D. Not confirmed on device.
- **How long a preview actually takes.** No network trace is in the repo; the "each guess re-downloads" claim rests on there being no cache in `QLPreviewSheet.load()` (`AttachmentPreview.swift:207-230`), not on a measurement.
- **Whether `purchasePlace` is populated on real accounts.** The AI draft fills it (`ai_extract.go:60`) and the form prompts for it (`DeviceFormView.swift:1144`), but I have no production data. If it is usually blank, change 1's shop case is worth less than I have claimed and the `fileName` half carries it.
