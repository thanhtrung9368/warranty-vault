# Warrly — Competitor Gap Report

**Scope:** 8 researcher clusters, ~70 products (dedicated warranty apps, home inventory, subscription trackers, receipt vaults, Vietnamese market, manufacturer/retailer portals, cross-cutting capabilities, 2025–26 AI entrants). Duplicates collapsed across clusters; counts are distinct products observed, not market share.

**Ranking rule:** (user value × how often the feature appears) ÷ effort. Two adjustments, stated openly: features central to Warrly's four pillars (devices, warranties, subscriptions, wishlist) are weighted above features that are only table stakes for home-inventory apps; and a shared root cause (capture) outranks a downstream symptom even when the effort is higher.

**Effort:** S ≤ 3 days · M ≤ 2 weeks · L ≤ 6 weeks · XL > 6 weeks, for one small team shipping Go + web + iOS + Android.

---

## 1. Verdict

Warrly has built a genuinely solid vault — encrypted attachments, push on three transports, resale math, return-window countdown, subscription cycles and an audit screen — and none of that is the problem. The competitive set has moved the bar from "store the end date" to three things Warrly cannot do: get the receipt without the user typing (forwarding aliases, Gmail/IMAP pull, barcode and serial-plate scanning), let a second person maintain the record (household accounts with roles, not expiring read-only links), and do something useful when the device actually breaks (a claim case with a ticket number and an SLA clock, a coverage verdict, a drafted letter). Warrly is behind less on feature count than on the *shape of its data*: `Warranty` is a dates-and-cost row rather than a contract (no cap, deductible, exclusions, region, activation, buy-by window, part-level clocks), and `Device` is a row rather than a history (no claim, repair, service, or ownership-transfer record). It is genuinely ahead on Vietnamese retail reality — the 1-đổi-1 return window, the resale pair, the handover certificate, VND-first costs and bilingual UI — but that advantage has a short half-life: ChecQ already ships Vietnamese, Thiki already combines devices, subscriptions and a shared workspace, and the VN retailers' own white-labels (KOOLMAN/AKITO, eWarranty) already own the claim-status moment. If only three things ship this year, they should be email-in ingestion, household accounts, and a claim/repair case record; configurable reminders are the cheap multiplier that makes all three feel finished.

---

## 2. Ranked gaps

| # | Gap | Seen in | Effort | Why it ranks here |
|---|---|---|---|---|
| 1 | Email-in ingestion: per-user forwarding alias + Gmail/IMAP pull | ≈13 · Vault, Shoeboxed, Expensify, Hubdoc, Evernote, Itemtopia, WarrantyHub | L | Capture is the root cause of empty vaults; every other feature depends on the vault having data. |
| 2 | Barcode / QR / serial-plate scanning to fill model + serial | ≈14 · CoverKeep, MyWrntee, Sortly, Nest Egg, Scanlily, MovingBox | S–M | The serial is claim-critical and absent from receipts; native APIs make this cheap. |
| 3 | Configurable, multi-stage reminder schedules (devices + subscriptions) | 9 clear + 3 fixed multi-stage · MyWrntee, Nodvera, Wrnty, WarrantyHub, Subby, TrackMySubs | S | Fixed 7/30 cannot serve a 14-day exchange, a 90-day accessory, or a 2-year appliance. Highest value per day of work in the report. |
| 4 | Claim / repair case record with status, ticket, SLA clock, repair history | ≈14 · MyWrntee, Warranty Book, FPT, CellphoneS, TGDD, LG, Xiaomi, Apple | M | `BROKEN` has nowhere to put the ticket, the promise, or the outcome — the exact moment the product exists for. |
| 5 | Household accounts with invites, roles and co-editing | ≈18 · HomeZada, Sortly, Itemtopia, AllKeep, MISA, Thiki, Rocket Money, Hubdoc | L | Most-repeated gap in the survey; a read-only expiring link cannot carry shared bookkeeping. |
| 6 | Insurance-ready PDF pack: schedule + photos + values + manifest | ≈18 · HomeZada, AllKeep, Sortly, MovingBox, Asset Vault, Wrnty, MyWrntee | M | An adjuster accepts a document, not a JSON tree or a ZIP of encrypted blobs. |
| 7 | AI coverage assessment + drafted claim letter (Vietnamese) | 4 · CoverKeep, AI Warranty Wallet, WarrantyHub, ChecQ | M | After a break the hard part is the verdict and the letter, not the date. Anthropic plumbing already exists. |
| 8 | Warranty contract terms: scope, cap, deductible, exclusions, region, transferability, part-level clocks | ≈9 · TGDD, CellphoneS, AppleCare+, Samsung Care+, Xiaomi, AIWW, WarrantyHub | M | "When does it end" ≠ "will this be covered and what will I pay"; `max(endDate)` hides the short, real clock. |
| 9 | Activation status + extended-cover buy-by deadline | ≈9 · Samsung, Sony, LG, Xiaomi, KOOLMAN, eWarranty, AppleCare+, Samsung Care+ | S | Unactivated device = refused claim; missed 30/60-day window = option gone forever. Two fields, two reminders. |
| 10 | Zalo OA / ZNS notification channel | 5 · eWarranty.vn, CellphoneS, FPT, Samsung, Sony | M | VN users read Zalo and ignore push/email; brands already notify claim status through ZNS. |
| 11 | Serial → brand warranty lookup, with mismatch flag | ≈9 · Samsung, Apple, ASUS, Dell, HP, Sony, CellphoneS, FPT | M | Grey-market/pre-activated dates differ from the invoice; the typed date can be wrong. Deep-link only — no public APIs. |
| 12 | Capture-first inbox: store a receipt before assigning it to a device | ≈6 · Expensify, Shoeboxed, Hubdoc, Paperless-ngx, Receipt Hog, ChecQ | M | At the counter the user doesn't know the device row; forcing that choice is why receipts are abandoned. |
| 13 | Full-text search over the text inside stored receipts/documents | 5 · Paperless-ngx, Keepfolio, Shoeboxed, Evernote, AllKeep | M | Warrly discards OCR text; "which receipt was the 65W charger" is unanswerable today. |
| 14 | Pre-service handover checklist per device | 2 · FPT Shop, CellphoneS | S | Retailers refuse locked devices and wipe data; cheap, VN-specific, prevents a wasted trip. |
| 15 | Share-sheet / "open in" import from Mail, Files, Photos | 3 · Keepfolio, MyWrntee, WarrantyHub | S | The receipt is already open in Mail; leaving that context is where capture dies. |
| 16 | Per-item currency with FX conversion into one base total | ≈7 · Bobby, TrackMySubs, Subly, Money Lover, WTRS, Your BillBox | M | USD subscriptions and xách tay devices make VND-only totals wrong; `/stats` headline number breaks. |
| 17 | Subscription lifecycle: trial as its own state + cancellation playbook/status | ≈7 · Subby, TrackMySubs, Hiatus, Revolut, Rocket Money, Outflow | S–M | Trial conversion is the expensive mistake; knowing a sub exists is the easy half. |
| 18 | Widgets / Siri / Spotlight / quick actions | ≈8 · MyWrntee, Warranty Tracker: Scanner, AIWW, Outflow | S–M | A deadline must surface without opening the app; the cheapest retention surface on both platforms. |
| 19 | Maintenance schedule + service history per device | ≈12 · HomeZada, HomeBinder, Itemtopia, Sortly, Hippo, WarrantyHub, HomeAIQ | M | Post-warranty retention, and service proof for claims/resale. Demand in VN still unproven. |
| 20 | Bulk capture: multi-row add, one receipt → many drafts, one photo → many items | ≈12 · MyWrntee, Keepfolio, AllKeep, Encircle, Asset Vault, MovingBox, Scanlily | M | Setup is where trackers die; one deliberate act per item caps accounts at three devices. |

### 1. Email-in ingestion

The receipt for anything bought online arrives as an email with a PDF attached, and Warrly's only automated input is a photo the user must first find, download, and upload. Thirteen products accept a forward (Shoeboxed, Expensify, Hubdoc, Evernote, Vault, Your BillBox, Itemtopia) and four pull the mailbox directly (Paperless-ngx IMAP rules, Fetch Rewards, Receipt Hog, WarrantyHub Gmail). The smallest useful slice is one alias per user (`<handle>@in.warrly.app`), accept attachments and body, dedupe, drop into a draft inbox; Vault's magic-link-before-signup is the growth version, not v1. This is first because every other gap in this report is worthless on an empty vault, and the vault stays empty precisely because capture costs a detour.

### 2. Barcode / serial-plate scanning

The serial or IMEI is not on the receipt; it is on the box or the device. It is also the first thing a service centre asks for, the key every brand lookup uses, and the field users mistype. Fourteen products scan it — CoverKeep, MyWrntee, WarrantyKeeper (Nodvera), Warranty Tracker: Scanner, Warranty Book, Nest Egg, Sortly, Itemtopia, Scanlily, MovingBox, HomeAIQ. Warrly has OCR for receipts only and a `serialNumber` field that must be typed. Native `DataScannerViewController`/AVFoundation on iOS and ML Kit on Android make this a small feature. Leave the UPC product-database lookup (Nest Egg, Scanlily) to phase two — coverage in Vietnam is patchy and it should not block the serial capture.

### 3. Configurable reminder schedules

A 14-day exchange window, a 3-month accessory warranty, and a 10-year appliance do not share a 7/30-day schedule. Nine products let the user choose lead days per item (MyWrntee 30/14/7/1, Nodvera 30/15/7/3/1, Wrnty per-item, WarrantyHub custom multi-stage, Covered, Subby and TrackMySubs on the subscription side); three more at least fire 30/7/1 or 30/7/0. Warrly fires exactly 7 and 30 for everything, and the repo treats that as deliberate. That was defensible when the app only tracked warranty end dates; it stops being defensible the moment the return window, activation deadline, and buy-by window exist, because each has a different horizon. Smallest slice: `leadDays[]` on device/warranty and subscription, defaults 30/7, cron reads the array, clients render a multi-select.

### 4. Claim / repair case record

The moment after "sắp hết hạn" is the product's whole reason to exist, and Warrly has a `BROKEN` status with nowhere to put the ticket number, the promised date, the loaner, or the outcome. Fourteen products have some form of it; the Vietnamese retailers are the most concrete — FPT's repair-status lookup, CellphoneS's "tình trạng bảo hành - sửa chữa", TGDD's 15-day repair ceiling that converts a slow repair into a swap. The repo already has `docs/SPEC-WARRANTY-CLAIM.md`, whose schema is better than the roadmap's (device-owned, status vs. outcome, paused warranty clock under Điều 30.2.c). Read it before scheduling. The smallest shippable slice is `WarrantyClaim` + "day 12 of 15" countdown + ticket number, not the entire spec.

### 5. Household accounts

Eighteen products across five clusters let a second person in — and it is the one gap Warrly's sharing model cannot express: a read-only, 30-day, single-device link is a receipt, not a collaborator. In a Vietnamese household the buyer, the receipt-keeper, and the person paying the subscription are often three different people; MISA and Money Lover already train users to expect shared ledgers, and AI Warranty & Expenses uses join-code groups. Build invite-by-email with viewer/editor roles, a shared device list, and a per-row "added by" audit. It is L because every query, endpoint, and client changes — and it is the difference between a personal vault and the household record the product claims to be.

### 6. Insurance-ready PDF pack

Warrly's ZIP with blobs is a better backup than most competitors and a worse claims document than all of them: an adjuster wants one PDF with photos, values, dates, and totals grouped by room or category, not a JSON tree plus a folder of encrypted files. Eighteen products ship a version — HomeZada, AllKeep, Sortly, MovingBox, Asset Vault, KeepTrack, Wrnty, MyWrntee. Reuse the backup query and the image pipeline: server-side PDF, one row per device with thumbnail, purchase date/price, serial, warranty status, a totals page, and `manifest.csv` in the ZIP. Copy AllKeep's "missing photo / missing value" flags — they turn the report into a to-do list.

### 7. AI coverage check + drafted claim letter

A reminder tells the user the date; it does not tell them whether a cracked screen is covered, what the excess is, or what to write. CoverKeep, AI Warranty Wallet and WarrantyHub generate a coverage verdict and a pre-filled letter; no competitor evidences Vietnamese output. Warrly already has the Anthropic client, the per-user opt-in gate, and the device facts — the missing pieces are structured warranty terms (#8) and a Vietnamese letter template. Keep the OCR precedent: draft only, user sends, never auto-submit.

### 8. Warranty contract terms

Today `Warranty` is type/provider/dates/cost/phone/address, so the app can say when cover ends but never what it covers. The VN plans are contracts with economics: TGDD caps payout at the original retail price, charges a 25% deductible on a total-loss replacement and allows a 30-day no-claim refund; CellphoneS pays up to 90% of repair with a 10% replacement fee; AppleCare+ charges 799,000 VND for screen/back glass but 2,649,000 VND for other damage; Xiaomi excludes cosmetic damage entirely. Worse, `max(endDate)` means a 10-year motor or panel clock hides the 24-month whole-unit clock, so the reminder fires eight years late. Add `scope`, `cap`, `deductible`, `exclusions`, `region`, `transferable`, `claimsAllowed/Used`, and drive reminders from the earliest relevant clock. This is the highest-value data-model change after #1.

### 9. Activation status + buy-by deadline

In Vietnam the warranty often starts with a retailer action, not the invoice: Samsung, Sony, LG and Xiaomi all gate on e-warranty activation, and an unactivated device can be refused at the counter even with a valid receipt. Separately, AppleCare+ (60 days) and Samsung Care+ (30 days) must be bought inside a window that closes forever. Neither date exists in Warrly. Two fields and two reminders: `activatedAt` / `activationRequired`, and `extendedCoverBuyBy`. Caveat from §6: the exact windows are not verified for every brand, so store them as user-entered values with a source note rather than asserting them.

### 10. Zalo OA / ZNS channel

Push and email are the wrong primary channel for this market. eWarranty.vn notifies claim status through ZNS, and CellphoneS, FPT, Samsung and Sony all run Zalo OA support; Vietnamese users read Zalo and ignore an unused app's notification tray. Warrly has web push, APNs and FCM — none of which survives an uninstalled app or a revoked permission. A Zalo OA with a follow→link flow and ZNS templates for expiry, return window and claim status is M effort (verification, template approval, per-message cost) and is the highest-leverage localisation move after Vietnamese UI.

### 11. Serial → brand warranty lookup

Every manufacturer portal answers a question Warrly currently guesses at: what does the brand think the end date is. Nine products/portals do it, and in Vietnam it matters more because grey-market and pre-activated devices often start the clock before the invoice. There is no public API (the researcher probed; all are HTML forms), so the buildable version is a per-brand deep link with the serial copied, a "brand says X on date Y" capture, a mismatch flag against the typed date, and a re-check reminder. Treat it as guided verification, not integration — the value is the stored comparison, not a live fetch.

### 12. Capture-first inbox

At the counter the user knows they bought something but not which device row it belongs to — or there is no row yet (gift, second-hand, household purchase). Requiring device selection at upload is why receipts get abandoned. Five ingestion products separate capture from filing (Expensify, Shoeboxed, Hubdoc, Paperless-ngx, Receipt Hog). The change is a `Document`/`Receipt` row with nullable `deviceId`, an inbox screen, and "file to device" later. It also gives the OCR draft somewhere to live before confirmation, and it is a prerequisite for #1 feeling pleasant rather than just possible.

### 13. Full-text OCR search

Warrly runs OCR once, returns a draft, and throws the text away, so the only searchable things are the fields the user typed. The questions people actually ask are "which receipt was the 65W charger" and "where is the invoice with the extended-care plan". Five products index document text — Paperless-ngx most thoroughly, plus Keepfolio, Shoeboxed, Evernote and AllKeep. Persist extracted text in a `tsvector` (or a trigram index consistent with the existing unaccent setup) and add it to the cross-entity search response. Watch the privacy story: the text is derived from an encrypted blob, so either store it encrypted or document the trade-off.

### 14. Pre-service handover checklist

FPT Shop refuses locked devices and wipes data during service; CellphoneS has the same intake rules. A user who drives to the centre with a passcode on the phone, no backup and no invoice loses a trip and possibly data. Two retailers document the rules; no global competitor packages them. Generate a checklist per device at claim time: sign out of iCloud/Google/Mi, remove all passcodes, back up, bring invoice plus box with matching IMEI, photograph condition, list accessories. S effort, distinctly Vietnamese, and it pairs directly with #4.

### 15. Share-sheet import

A PDF receipt usually arrives inside Mail; making the user leave that context, open Warrly and re-find the file is where capture dies. Three products document an OS share/open-in path (Keepfolio, MyWrntee, WarrantyHub). iOS Share Extension + Android `ACTION_SEND` + web share target, all routed into the capture-first inbox. Verify the clients don't already have it — the survey could not confirm, and I did not read the iOS/Android intake code.

### 16. Per-item currency with FX

Netflix, Spotify, iCloud, ChatGPT and Adobe bill in USD; xách tay devices are bought abroad. Adding 4.99 to 199,000 produces a number nobody can act on, and the monthly-equivalent and warranty-cost totals are the headline of `/stats`. Seven products do per-item currency with conversion (Bobby, TrackMySubs, Subly, Money Lover, WTRS, Your BillBox, Expensify). Warrly's schema has a `currency` column on `Subscription` that the write path defaults to VND, and every total is hard-coded `...Vnd` — the field is decorative. This is the one gap where the current data model is not just missing a feature but actively producing a wrong number.

### 17. Subscription trial state + cancellation path

A trial that converts while the user is still deciding is the expensive mistake, and a renewal date cannot express "free until 12 Nov, then 260k/month". Subby and TrackMySubs model trials as their own object; Hiatus and Revolut alert before conversion. Separately, knowing a subscription exists is the easy half — Rocket Money, Hiatus and Outflow ship cancellation paths and status. Warrly already has `CUSTOM` cycles and renewal pushes, so `trialEndsAt` + `convertsToPrice` is a small extension, not a new module; the cancellation playbook is content work (store vs. web vs. phone, per top VN service) plus a `cancelBy` date and a status field.

### 18. Widgets / Siri / Spotlight

Expiry is a date the user must notice before it passes; a widget reaches them without opening the app, and it is the retention surface these products lean on. Eight products ship widgets, Siri shortcuts or Spotlight, with MyWrntee the deepest. Warrly has native iOS and Android clients and no widget, watch app or voice surface. Start with one iOS WidgetKit widget (next three expiries plus days) and one Android Glance widget, then App Intents/Spotlight for "when does X warranty end". A watch app is optional and L.

### 19. Maintenance / service history

After the warranty ends, upkeep is the only recurring reason to open an ownership app, and a service log is what a claim or a resale buyer asks for. Twelve products have some form (HomeZada, HomeBinder, Itemtopia, Sortly, Hippo, Asset Vault, WarrantyHub, HomeAIQ, Thiki, Scanlily). Warrly has a spec — `docs/SPEC-MAINTENANCE-SCHEDULES.md` — that recommends deferring because VN demand was unproven. The competitor evidence now tips the *supply* side, not the *demand* side, so keep it at 19 and validate with five to ten users before building. When built, put schedules on the device (like `WishlistItem.reminderIntervalDays`), not on `Reminder`.

### 20. Bulk capture

Setup is where trackers die: after a move or a shopping trip the user holds ten receipts, and ten separate create-device-plus-upload flows is why accounts stall at three devices. Twelve products attack this — multi-row forms (MyWrntee, Keepfolio), one receipt → many items (Asset Vault, ChecQ), one photo → many items (AllKeep, MovingBox, Scanlily), narrated video (Scanlily). Warrly's OCR returns exactly one draft. Start with the cheap 80%: a multi-row add form and one receipt → multiple drafts. Leave video and LiDAR to the home-inventory apps.

**Below the line (real, ranked but not scheduled):** current value/depreciation and net resale after retailer fees (≈12; blocked on a price source); location/room/property field + filter (≈13; cheap but low value for a 50-device list, and the doorway to scope creep); ownership-transfer paperwork for resale (4; pairs with the handover certificate); price-change alerts (2); CSV/XLSX import (5); duplicate receipt detection (3); printable QR labels that open the existing share page (5); refund/promo-expiry dates (1); subscription invoice attachment (1); upcoming-charges calendar (3); guided multi-shot scanner (3); offline write queue (2); recall monitoring (5 — real safety value, but no Vietnamese recall source was found, so it would launch US-only).

---

## 3. Table stakes Warrly already meets

Do not spend roadmap on any of this; it is the entry ticket, not a differentiator.

- **Capture/storage:** receipt OCR draft (including PDF, serial and warranty months), AES-256-GCM attachments with per-file keys, 5 MB/5 files per device, image downscale, editable description.
- **Tracking:** up to 5 warranties per device, effective end, statuses, resale pair + profit/loss, return-window countdown, catalogs, diacritic-insensitive Vietnamese search, cross-entity search.
- **Nudging:** 7/30 warranty push, dismiss + hidden list + restore, renewal/target/check-in pushes on web push, APNs and FCM.
- **Money:** five billing cycles incl. lifetime/custom, payment history, monthly-equivalent math, audit screen, stats/forecast, wishlist target price + history + purchase→device.
- **Sharing/export:** read-only share link with hashed one-time token, handover certificate, service directory, JSON/ZIP backup with blobs, CSV export.
- **Platform:** vi/en/follow-device, iOS and Android app locks, theme, PWA install and offline document read, account/auth/session/delete-account.

---

## 4. Where Warrly is ahead

1. **Vietnamese retail mechanics.** The return window ("1 đổi 1"), resale pair, handover certificate and VND-first costs model what VN retailers actually enforce. No global competitor has these. **Expires in 12–24 months:** ChecQ already localises into Vietnamese, and the VN white-labels (KOOLMAN/AKITO, eWarranty) already own claim status inside the retailer's own system.
2. **Integrated scope across four pillars.** One app for devices, warranties, subscriptions and wishlist; a household does not want four apps. **Expires fastest:** Thiki (devices + subscriptions + shared workspace) and Covered (warranty + return + subscriptions) are already close, and every AI-native entrant is adding subscriptions.
3. **Multi-platform native + web + PWA with push on all three transports.** Most competitors are iOS-only; Vietnam is Android-heavy. **Expires in 18–24 months:** the survey under-covered Android, so Android-first local entrants may already be there.
4. **Encryption and backup honesty.** Per-file AES-256-GCM, ZIP with blobs, self-describing version, import of both shapes, missing-blob list. Most consumer trackers are account-locked or CSV-only. **Expires slowly, but it is not a purchase driver** — "encrypted" is becoming a claim every competitor makes.
5. **No ads, no data sale.** Fetch and Receipt Hog monetise purchase data; Warrly's stance is a real trust advantage for receipts. **Expires with pricing pressure** — the moment a free tier is funded by data, it is gone.
6. **A service directory that refuses to invent phone numbers.** This is honesty, not a feature. Keep it, but pair it with the serial deep links (#11) so the user still reaches the right page.
7. **App lock + tri-state language.** Small, real, copyable in weeks.

**Blunt summary:** the "ahead" list is mostly local-market positioning and trust choices, not technical moats. The one durable advantage available is the integrated household record — and Warrly cannot claim it until #5 ships.

---

## 5. Deliberately not worth building

- **Brand hotline and dealer phone numbers, tap-to-call** (Warranty Book). Numbers rot, a wrong number is a liability, and migration `0012` deliberately stores the vendor's own lookup URL instead. Deep-link to the service page; do not become a phone book.
- **Generic home inventory:** video walkthroughs, LiDAR room scans, paint colours, pantry expiry, moving manifests, room templates, QR label trees (HomeZada, MovingBox, Asset Vault, Sortly, AllKeep). Different job, years of head start, and it dilutes the device/warranty promise. A single optional `location` field is the only piece worth taking — and it is below the line.
- **A full no-account, local-only mode** (Keepfolio, Nodvera, WarrantyProof, Warrnty). It kills push, share links, handover, cross-device stats and the household record — the things Warrly is actually for. The salvageable piece is the offline *write queue*, not a local-only product.
- **Bank-linked subscription detection** (Rocket Money, Hiatus, Revolut, Monzo). No open banking or Plaid in Vietnam, high privacy/regulatory cost, and the user value is reachable with a statement CSV import at 20% of the effort.
- **Agentic cancellation or bill negotiation** (Pine, Rocket Money). Liability, no phone-agent economics in VN, and most local services cancel in-app. Ship the playbook and links (#17), not the agent.
- **Physical mail scanning, SMS receipt ingest, desktop scanner/watched folder** (Shoeboxed, Expensify, Paperless-ngx, Evernote). No VN market: receipts are paper at the counter or email. The email path (#1) covers the real case.
- **Selling purchase data or running ads** (Fetch, Receipt Hog). Trust is the product; this is the one shortcut that would destroy #4's advantage.
- **A parts price database** (FPT, Xiaomi). Prices vary by centre and change constantly; deep-link to the published list instead.
- **MCP / public API for AI agents** (Vault, Sortly). One product, no demand evidence, and the auth surface is a new attack surface. Revisit when a general assistant is the primary interface.
- **Address/property enrichment** (Hint). Home-maintenance-first, not a device tracker, and it depends on public property data that does not exist in Vietnam.
- **Credit-card extended-warranty and statutory warranty databases** (AIWW, CoverKeep, Warranty Tracker: Receipt Scan). VN card benefits are thin and issuer-specific; VN law does not set a general minimum warranty (the repo's own claim spec verified Điều 30.1: by agreement). A small brand→typical-months table labelled "estimate" is fine; a jurisdiction database is not.

---

## 6. Confidence

**Strong — primary sources.** Feature claims come from App Store/Play listings, vendor help centres and official policy pages. The Vietnamese retailer mechanics (FPT, CellphoneS, TGDD, Samsung, Sony, LG, Xiaomi, Apple, ASUS, Dell, HP) were read from the companies' own pages, and the legal point about warranty clocks pausing was read from the Công báo text of Luật 19/2023/QH15 in `docs/SPEC-WARRANTY-CLAIM.md`. On the Warrly side I verified in the repo: 20 tables and none for claim/repair, household/invite, location, or email ingestion; `currency` exists on `Subscription` but is defaulted to VND and all totals are `...Vnd`; `reminderIntervalDays` exists only on `WishlistItem`, not for warranty reminders; `openapi.yaml` has no `location` field. That makes #5, #8, #12, #13, #16 and #3 confirmed gaps rather than inferred ones.

**Medium — vendor copy, not tested.** Every competitor feature is the vendor's own listing; the researcher explicitly did not test whether any of them work well. Counts are approximate and deduped by hand: WarrantyHub and Warranty Tracker: AI Coverage are the same product; KOOLMAN/AKITO is one white-label binary; the Ukrainian "Warranty Keeper" Product Hunt listing may be a different product from C-Point's. Effort estimates are mine, not researched.

**Thin — one source or secondary only.** Centriq is dead and its features come from a competitor's migration page. Hint rests on one Fortune article. Receipto rests on a third-party Product Hunt mirror. Retreat rests on a Show HN post and a client-rendered site. Thiki's "AI memory" tagline conflicts with its App Store copy. Shopee is title-level evidence only; TikTok Shop deadlines come from a GHN logistics blog, not TikTok; Lazada is absent (redirect loop). Samsung Care+ VN details come from a 2021 global article; AppleCare+ VN prices from a 2023 VnExpress piece; TGDD policy pages returned HTTP 500. HomeZada prices are Wayback snapshots; Sortly and Encircle pricing pages render client-side; HomeBinder's native app is unconfirmed.

**Could not be confirmed, and it matters.** No Vietnamese recall source exists in the survey (US CPSC and AU only), so recall monitoring would launch US-only — which is why it sits below the line. No public warranty APIs exist, so #11 is deep links plus manual capture, not integration. No consumer app was confirmed to *file* a claim itself; AIWW generates a letter, Dyrect is B2B. No Android widget evidence exists because Play pages rendered empty. No competitor evidences Vietnamese claim-letter output — that is Warrly's opening. And the "no one serves Vietnamese" inference is partly wrong: ChecQ ships 33 languages including Vietnamese, so Warrly's advantage is depth (VND, retailer mechanics, bilingual copy), not mere presence.

**Warrly-side caveats.** The brief says bilingual vi/en, but the checked-in `CLAUDE.md` still says Vietnamese-only and lists i18n as deliberately out of scope; migration `0014_user_locale` exists, so the repo is mid-migration. I used the brief. I did not read the iOS/Android intake code, so share-sheet import (#15) may already partly exist; likewise I could not confirm whether mobile has any offline write queue. The repo currently treats per-user reminder lead time as deliberately not built — this report argues that decision is now wrong; if the owner disagrees, #3 drops to roughly #12 and the rest stands. The repo also already has a spec for the claim case (#4) and one for maintenance (#19, recommended deferral); this report agrees with the first and keeps the second at 19 for the same demand-evidence reason.

**What would change the ranking.** A working email-in prototype already in a branch would drop #1 and lift #12/#13. A decision that households are out of scope would drop #5 and weaken #4's and #6's value. A Vietnamese recall feed would lift recall into the top half. Evidence that the fixed 7/30 schedule is a deliberate product bet that survives the return-window/activation realities would drop #3.
