# Warrly — AI on the input side: image, typed text, cost, BYOK, and what "free" really means

**Status:** analysis only. No app code was changed to produce this document.
**Question (owner, verbatim):**

> **Chỗ nhập liệu:** Phân tích hình ảnh · Phân tích từ nội dung bạn đó nhập · Free thì tốt không free thì chắc cho user tự nhập key
>
> Follow-up: "có bên nào free không nhỉ"

**Evidence snapshot.** Repository `warranty-vault` at commit `7dd4b467b1473495cb1c63be2321fb43eb6c0db1` (2026-10-31 15:27 +0700), read at **2026-10-31 19:40–20:10 ICT**. The working tree was **dirty** while this was written (`ios/App/Features/Devices/DeviceFormView.swift` was being edited — its line numbers moved twice during the analysis). iOS line numbers below are therefore given with the symbol name so they can be re-found; treat them as accurate to ±10 lines, not as pins.
Every external claim was read on **2026-10-31**; prices and free-tier terms are quoted with that date because they move.

**Tagging.** `[fact]` = verifiable at the cited `file:line` or URL. `[judgement]` = my reasoning over those facts; argue with it. Anything I could not establish is in §7, not smoothed over.

---

## 0. The answer, before the detail

**Should it be free?** Yes — but not "free" in the sense of an unlimited free tier. A lifetime allowance of **20 extractions per account** costs **≈ $0.11 per user who maxes it out** (`[judgement]`, arithmetic in §3.4), which at 10,000 users all maxing it is **$1,080 one-time** — a rounding error next to the hosting bill. That is affordable and it is bounded. What is *not* affordable is an unlimited free tier: the per-user rate limit alone permits **14,400 scans/day ≈ $77/user/day** (`[judgement]`, §3.3), and one maximum-size PDF can cost **≈ 37× one photo** (`[judgement]`, §3.2) because page count is never checked. **And the obvious free provider is not usable**: Google's Gemini free tier explicitly uses your content to improve its products and tells you not to send personal data — which a receipt is (§5). Free is a solved problem; free *at someone else's* terms is not.

**Should BYOK exist?** Not as the owner probably means it. Server-side BYOK ("user types a key, we call the model with it") buys a cost saving we do not need at the scale where the cost is a rounding error, and in exchange we take custody of a credential we did not issue, plus key storage, rotation, deletion and — if the provider is user-selectable — an SSRF surface the repo does not have a guard for. **The one placement that is defensible is device-direct**: the key lives in the Keychain, the device calls the provider, and we never see it. That placement is also the *only* version where a user-chosen OpenAI-compatible endpoint is safe. **And it saves no privacy at all for images**, because the image has already been decrypted by our server before the device gets the bytes (§4.3) — which is precisely why the opt-in exists.

**So what is the right answer?** Free tier + typed-text parsing + **on-device OCR**, in that order. On-device is the only genuinely free option that is also compatible with the privacy contract, because it is the only one where the receipt never leaves the phone (§5.3). The honest caveat: its Vietnamese accuracy is unmeasured, and that is the single experiment this document asks for.

---

## 1. What exists today, precisely

### 1.1 The server pipeline

| Piece | Where | What it actually does |
|---|---|---|
| Anthropic client | `api/internal/ai/client.go:36-50` | `NewFromEnv` reads `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`; empty key ⇒ `Enabled() == false` (`client.go:53`). Default model `claude-haiku-4-5-20251001` (`client.go:19`). |
| Prompt + schema | `api/internal/ai/extract.go:51-64` (Vietnamese system prompt, 2,050 chars), `:68-93` (one forced tool `emit_receipt`) | Fields: `name, brand, model, serialNumber, purchaseDate, purchasePrice, purchasePlace, warrantyMonths, category, confidence, extractedText`. Bounds are stated in the prompt: `warrantyMonths` 0–120, price as plain VND integer, serial verbatim. |
| The call | `extract.go:141-216` | `max_tokens 4096` (`:167`), image as `image` block or PDF as `document` block (`:152-157`), `cache_control: ephemeral` on the **tool** (`:92`) and on the **system** prompt (`:171`). |
| Response parsing | `extract.go:133-135`, `:219-234` | `messageResp` carries **only `Content`** — `usage` is not parsed, so the service cannot currently report what a call cost. |
| Type gate | `extract.go:267-269` | JPEG/PNG/WEBP + `application/pdf`. GIF/HEIC refused before any paid call. |
| Service | `api/internal/services/ai_extract.go:150-231` | Gate → decrypt → type check → model → catalog → draft. **Never writes a Device.** |
| Gate | `api/internal/services/ai_gate.go:48-62` | Two conditions, one place: server key present, `User.aiOptIn` true. |
| Catalog mapping | `ai_extract.go:250-317` + `api/internal/ai/fuzzy.go:16-83` | Fuzzy match at `matchThreshold = 0.82` (`ai_extract.go:22`). **`Normalize` is diacritic-insensitive and maps `đ→d`** (`fuzzy.go:12-19`), so `the gioi di dong` scores 1.0 against `Thế Giới Di Động`. |
| Draft bounds | `ai_extract.go:42-52`, `:323-346` | `warrantyMonths` clamped to [0,120], serial dropped if > 120 bytes; a dropped value is reported in `unmatched`, never silently passed. |
| Persistence | `ai_extract.go:220-228` | When the request names an `attachmentId`, the OCR transcript is stored **plaintext** on `Attachment.extractedText` (migration `0019_attachment_extracted_text.sql`) so `GET /api/v1/search` can match it. Best-effort. |
| HTTP | `api/internal/handlers/ai.go:38-45` | `POST /api/v1/ai/extract-receipt`, `POST /api/v1/ai/assess-claim`, `GET`/`PUT /api/v1/ai/opt-in`, all `requireUser`. |
| Handler gate + rate limit | `ai.go:94` → `api/internal/ratelimit/helpers.go:102-104` | 10 requests / 60 s / user on bucket `ai:extract:user:<id>`; a **separate** bucket from claim assessment. |
| Error mapping | `ai.go:194-218`, `ai_extract.go:433-444` | 400 `bad_input` · 403 `ai_optin_required` · 404 `not_found` · 429 `ai_rate_limited` · 502 `ai_upstream` · 503 `feature_disabled`. |

### 1.2 The contract

`openapi.yaml:2967-3053` documents the endpoint, both request shapes, and the two gates (403/503). `openapi.yaml:3163+` documents the opt-in pair. The privacy sentence in the contract is explicit that the OCR text is plaintext in Postgres while the blob stays AES-256-GCM (`openapi.yaml:2997-3004`).

### 1.3 The iOS client — what the button actually does

- The OCR entry point is a **`Menu` guarded by `if !isEditing && aiEnabled`** in `DeviceFormView.swift` (~`:811`): "Chụp hoặc chọn ảnh" / "Chọn tệp PDF", caption "Chọn ảnh (JPG/PNG/WEBP/HEIC) hoặc tệp PDF để tự điền — vẫn kiểm tra lại trước khi lưu". `[fact]`
- `handleScan` (~`:1587`) accepts the payload, re-encodes anything not JPEG/PNG/WEBP/PDF as JPEG, and refuses what the endpoint cannot take. `[fact]`
- `scan(...)` (~`:1670`) is the single path for both photo and PDF: **upload first** (`uploadAttachment(deviceId: nil, ...)`), then `extractReceipt(attachmentId:)`. A failed extraction leaves the upload in the inbox on purpose. `[fact]`
- `applyDraft` (~`:1787`) maps the draft onto form state; it is the only place the draft touches the UI. `[fact]`
- The client's request shapes and the reason upload-then-extract exists are documented at `ReceiptExtract.swift:3-20` and `Endpoints.swift:520-540`: only the `attachmentId` branch can persist the transcript. `[fact]`
- `aiEnabled` comes from `GET /api/v1/ai/opt-in` on appear (`DeviceFormView.swift`, symbol `if !isEditing, let v = try? await client.getAIOptIn()`, ~`:1513`) and the toggle lives in Settings (`SettingsView.swift:385-430`), with the disclosure footer at `SettingsView.swift:230`. `[fact]`
- The disclosure copy, which §9 of the visual direction forbids shortening (`docs/handoff/WARRLY-visual-direction.md:694-726`): **"Khi bật, ảnh hoá đơn (đã giải mã) và thông tin lần sửa chữa sẽ được gửi tới dịch vụ AI bên thứ ba để tự điền thông tin hoặc đánh giá bảo hành. Bạn luôn kiểm tra lại trước khi lưu. Mặc định tắt."** `[fact]`
- The web client has the same flow through a server action (`website/src/app/actions/ai.ts:58-82`), also upload-then-extract. `[fact]`

### 1.4 What the owner asked for, mapped onto what is built

| Owner's ask | Built? | Evidence |
|---|---|---|
| **Phân tích hình ảnh** (parse an image) | **Yes, and more than asked.** Photo + PDF, 11 fields including IMEI and warranty months, fuzzy catalog binding, duplicate-serial warnings, transcript search, confirm-before-save. | §1.1; `ai_extract.go:150-231`; `openapi.yaml:2967` |
| **Phân tích từ nội dung bạn đó nhập** (parse typed text) | **No. Nothing exists.** No endpoint, no prompt, no client entry point: `grep -rn "parse-text\|parseText\|ParseText\|parse_text\|extract-text" api/ ios/ website/src` → **0 hits**, and the AI surface is the four routes above. | `ai.go:38-45`; the grep |
| **Free thì tốt** (free if possible) | **Not measured, not capped.** No `usage` parsing, no per-user counter, no table. | `extract.go:133-135`; no AI-usage table in `api/migrations/` (latest: `0024_utc_timestamp_baseline.sql`) |
| **Cho user tự nhập key** (bring your own key) | **No.** The only credential is the server's env var. | `client.go:36-50` |

So: **one of the three asks is already built, and better than the ask.** The interesting work is the other two, and neither is a rewrite of the first.

### 1.5 What is genuinely missing

1. **No cost visibility.** `messageResp` ignores `usage` (`extract.go:133-135`), so nobody — including the owner — knows what a scan costs today. Every number in §3 is derived, not measured.
2. **No budget.** The only ceiling is 10 requests/60 s (`helpers.go:102-104`), which is a burst guard, not a spend guard.
3. **No text path.** §2.
4. **No client-side crypto.** `grep -r CryptoKit ios/` → 0 hits; `GET /api/files/{id}` returns **decrypted** bytes (`Endpoints.swift:620-635`). This matters for BYOK (§4.3).

---

## 2. The text-input feature

### 2.1 It is the same feature, on a different contract

The owner's sentence: *"mua iPhone 15 Pro 256GB ở CellphoneS ngày 15/3, bảo hành 12 tháng, 28 triệu"*.

The **output** is identical to image parsing: the same fields, the same `DraftDevice`, the same catalog mapping. The **input contract** is not, and pretending otherwise is how this ships broken:

| Dimension | Receipt image | Typed sentence |
|---|---|---|
| **What the model is doing** | Transcribing + locating. The instruction is "read what is printed, null when unsure" (`extract.go:54-55`). | Interpreting + normalising. "28 triệu" → `28000000`; "15/3" → a date with **no year**; "ở CellphoneS" → a store; "bảo hành 12 tháng" → a duration that starts at the purchase date. None of that is on any receipt. |
| **Failure mode** | Empty or partial draft. The image was blurry; `confidence: low`; fields come back null. The UI already has language for this. | **Confidently wrong.** Typed text always parses into *something*, so the model never returns an empty draft — it returns a plausible draft with an invented year. A wrong `purchaseDate` silently moves the warranty end date by up to 11 months, which is the one number this app exists to get right. |
| **Trust model** | The image is decrypted by our server to be sent (`ai_extract.go:172`). It leaves the box, which is exactly why `aiOptIn` exists and defaults OFF (`ai_gate.go:48-62`, migration `0003_user_ai_optin`). | The text is typed by the user, in our request, and is usually a paraphrase of data they are about to save anyway. The third-party transfer is smaller and more obviously consensual. |
| **Ambiguity that needs a *rule*, not a model** | Almost none: OCR either reads the digits or it does not. | `15/3` (dd/mm vs mm/dd), missing year, "28tr5", "1 tỷ 2", no-diacritics input. Each needs a stated rule. |

### 2.2 What to share

Share everything downstream of the model call, because it is already generic:

- **The tool schema** (`extract.go:68-93`) — it is the *output* contract. Reuse verbatim; do not fork it.
- **`DraftDevice`** (`ai_extract.go:78-108`) and therefore the client's `applyDraft` (`DeviceFormView.swift:~1787`) — a new input needs **zero new rendering** on iOS. That is the whole reason to build text input this way.
- **The catalog mapper** (`ai_extract.go:250-317`, `fuzzy.go`) — and note it is *better* suited to typed text than to OCR: users type "cellphones" without diacritics or capitals, and `Normalize` folds exactly that (`fuzzy.go:12-19`). This is a real asset, not a hopeful one.
- **The draft sanity bounds** (`ai_extract.go:42-52`) — 0–120 months, serial ≤ 120 bytes.
- **The gate and its codes** — see 2.3 for the one thing that should differ.
- **Confirm-before-save.** Both paths return a draft, never a write. `[fact]`

### 2.3 What must **not** be shared

1. **The system prompt.** The receipt prompt's core rule — "CHỈ điền trường nào nhìn thấy rõ trên tài liệu" (`extract.go:54`) — is wrong for typed input, where the value is precisely *not* written down. A second prompt (`systemPromptText`) is required, with three Vietnamese-specific rules the image prompt has no reason to contain:
   - **Money in words:** `28 triệu` → `28000000`; `28tr5` → `28500000`; `1 tỷ 2` → `1200000000`; `500k` → `500000`. A receipt never says "triệu".
   - **Date without a year:** take the **most recent occurrence that is not in the future** (month/day in the past ⇒ this year; in the future ⇒ last year), and **emit a warning** through the existing `warnings` channel (`ai_extract.go:74-77`) saying the year was inferred. Not `unmatched` — the value *is* used, it just needs review. That distinction is exactly what `unmatched` vs `warnings` was built for.
   - **`extractedText` is meaningless here.** Set it null and stop persisting it; there is no attachment to own it (`ai_extract.go:96-100`).
2. **The media-type validation** (`ai_extract.go:189-191`, `handlers/ai.go:153-164`) — no file, no MIME, no base64. Instead: a **length bound** (proposal: 1–500 runes; a sentence, not an essay) enforced before the model call, mirroring the existing "refuse before paying" discipline.
3. **The rate-limit bucket.** A separate bucket (`ai:text:user:<id>`), for the same reason `ai:assess` is separate from `ai:extract` (`helpers.go:106-111`): a text parse is cheap and should not eat the user's image quota, and vice versa.
4. **The prompt-cache assumption.** See §3.5 — caching is currently a no-op, so do not design around it for either path.
5. **The consent copy.** The shipped disclosure says *"ảnh hoá đơn (đã giải mã) … sẽ được gửi tới dịch vụ AI bên thứ ba"* (`SettingsView.swift:230`). Typed text is not an image. **Keep one switch** (two consents for one feature is a worse privacy UX and more places to drift), but the footer must gain the typed-text case. That is a legal string; §9 forbids shortening it, not extending it — **owner sign-off required** (§7).

### 2.4 Concrete shape

```
POST /api/v1/ai/parse-text        (requireUser, 10 req/60 s on bucket ai:text, 1 credit)
body  { "text": "mua iPhone 15 Pro 256GB ở CellphoneS ngày 15/3, bảo hành 12 tháng, 28 triệu" }
200   { "draft": DraftDevice }    ← identical schema to extract-receipt
```

- New: `api/internal/ai/parse_text.go` (prompt + the same `emit_receipt` tool shape), `services.ParseText`, one handler in `handlers/ai.go`, one openapi path, one iOS call + a text box in the existing OCR `Menu` (`DeviceFormView.swift:~811`).
- Reuse: `buildDraft`, `matchBrand/Store/Category`, `DeviceSerialWarnings`, `GetAIOptIn`, all error codes.
- iOS UI: a "Dán nội dung bạn nhập" item in the existing menu, a `TextEditor` sheet, then the same `applyDraft` + the same draft notes under the button. No new screens.

`[judgement]` on all of §2.4 — it is a design, not a measurement.

---

## 3. The cost analysis

### 3.1 What one call is made of

Three components, each priced from published rates:

| Component | Tokens | Basis |
|---|---|---|
| Tool schema + system prompt | **≈ 1,300** (computed below at 1,300; the honest figure is ≈ 1,380) `[judgement]` | Prompt = 2,050 Vietnamese characters (`extract.go:51-64`) ≈ 820 tokens at ~2.5 chars/token. Tool block = 1,477 characters of Go source (`extract.go:68-93`) ≈ 560 tokens. **Total ≈ 1,380 — the arithmetic below uses 1,300, so every figure is ~3% optimistic.** This is an estimate: I have no tokenizer (§7). |
| Image | **1,564** `[fact]`-derived | Claude bills `⌈w/28⌉ × ⌈h/28⌉` visual tokens, capped at **1,568** on the standard tier ([vision docs](https://platform.claude.com/docs/en/build-with-claude/vision#resolution-and-token-cost), read 2026-10-31). The app downscales to **1600 px** before encryption (`api/internal/files/resize.go:18`), so a 1600×1200 photo is resized by the API to 1270×952 = **1,564 tokens** `[judgement: computed with Anthropic's published reference resize implementation]`. Any phone-camera photo lands at the cap regardless of megapixels; a small crop does not (800×600 = 638). |
| Output | **≈ 500** `[judgement]` | The extracted fields + a transcript capped at 8,000 runes (`ai_extract.go:51`), but `max_tokens` is 4,096 (`extract.go:167`) and only actual output is billed. 300–1,000 is the realistic band. |

Rates ([Haiku 4.5 overview](https://platform.claude.com/docs/en/models/haiku-4-5/overview), read 2026-10-31): **$1 / MTok input, $5 / MTok output.** The model in the repo is `claude-haiku-4-5-20251001` (`client.go:19`), now listed as **Legacy** on that page — a deprecation clock is running.

### 3.2 The arithmetic

**One photo receipt** (in = 1,300 + 1,564 = 2,864; out = 500):

```
input   2,864 × $1/1e6   = $0.002864
output    500 × $5/1e6   = $0.002500
                        ≈ $0.00536   ≈ 140 VND @ 26,000 VND/USD   [judgement on the FX rate]
```

Band across realistic outputs: **$0.0044 – $0.0079** per photo.

**One typed sentence** — no image, so ≈ $0.0025–$0.0030. **About half a photo.** `[judgement]`

**PDFs are the cliff.** A `document` block is rasterised server-side: each page costs **1,500–3,000 text tokens _plus_ its own image tokens** ([PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support), read 2026-10-31). Realistic total is **~3,000–4,500 tokens per page**, not 1,500. Page count is **not pre-checked** — the code says so (`extract.go:258-262`: "Page count is NOT pre-checked"). The 5 MB attachment cap (`services/attachments.go:26`) bounds bytes, not pages.

The binding limit is therefore **not the file size but the 200K context window** (`claude-haiku-4-5` is a 200K model — [Haiku 4.5 overview](https://platform.claude.com/docs/en/models/haiku-4-5/overview)). At ~4,500 tokens/page the window fills at **~43 pages**, and a longer PDF is rejected upstream — which our code maps to **502 `ai_upstream`** (`extract.go:211-213` → `ai.go:207-208`), not to a cheaper call. That produces a hard ceiling:

| Document | Input tokens | Cost |
|---|---|---|
| 1-page PDF | ~4,300–5,800 | **$0.007–$0.011** |
| 3-page PDF | ~10,300–14,800 | **$0.013–$0.017** |
| 10-page PDF | ~31,300–46,300 | **$0.034–$0.049** |
| **~43-page PDF (context limit)** | ~195,000 | **≈ $0.20** |

`[judgement]`, computed from the per-page band. **One maximum-size PDF costs ≈ 37 photos**, and a 10-page warranty booklet costs 6–9. Nothing in the code prevents either.

### 3.3 At 10, 1,000, 10,000 users

Assumption: **3 extractions per user per month** (a user scans when they add a device, not weekly). `[judgement]` — stated because there is no telemetry (§7).

| Users | Calls/month | Cost/month |
|---|---|---|
| 10 | 30 | **$0.16** |
| 1,000 | 3,000 | **$16.08** |
| 10,000 | 30,000 | **$160.80** |
| 10,000 at 10 scans/user | 100,000 | **$536.00** |

**Where it stops being a rounding error.** The marginal cost is irrelevant until it competes with the rest of the bill. A Go+Postgres box for this service is order-of-magnitude **$20–40/month** `[judgement]`. So:

- At **1,000 users** extraction is ~$16/month — smaller than the VPS. Rounding error. ✅
- At **10,000 users** it is ~$161/month — **4–8× the hosting bill**, and the largest single line item. ❌
- In **photo terms** the crossover is around **5,000–7,000 scans/month**.
- **But the crossover moves down sharply the moment PDFs are in play**, because one PDF is worth 6–37 photos (§3.2). One PDF a day across 100 users adds ~$6–$60/month on its own. Photo volume is predictable; PDF volume is not, and that is the argument for the 5-credit multiplier in §3.4.

**The abuse ceiling is the real number.** 10 requests/60 s (`helpers.go:102-104`) = **14,400 calls/day = $77/user/day** at the photo price. Nothing stops one account from doing that for a month. The rate limiter is a burst guard; it is not a budget.

### 3.4 Free-tier proposal

**20 credits per account, lifetime. No monthly reset.**

- 1 credit = one photo or one typed sentence. **5 credits = one PDF** (to blunt the cliff above).
- Worst case per user who maxes it: 20 photos ≈ **$0.11**; or 4 maximum-size PDFs ≈ **$0.80** `[judgement]`.
- At 10,000 users all maxing it with photos: **$1,080 one-time.** With the pathological all-PDF case: ~$8,000 — which is why the PDF credit multiplier is part of the proposal, not an optimisation.
- **Why lifetime, not per-day or per-month.** Extraction is a *first-session* feature: a user scans the receipts they already have, then types or adds manually. A monthly reset bills you for users who stopped using it, teaches users to burn quota, and turns a one-time cost into a subscription-shaped one — with no subscription revenue to pay for it.
- **What happens at zero.** There is **no payment rail in this repo** (`grep -rni stripe api/ website/src` → **0 hits**; `SubscriptionPayment` in `0001_initial.sql:215` is the user's own record of what they pay *for software subscriptions*, not a billing integration), so zero cannot mean a paywall. It must mean: the credit count is visible in Settings and next to the button ("Còn 3 lượt"); at zero the button is disabled with an explanation and **the manual form still works**; no dead end. BYOK would be the only escape hatch, which is one more reason it is ranked below (§4.6).
- **Enforcement must be in Postgres**, not in `ratelimit`: that package is a **fixed-window counter whose memory backend is per-process** (`ratelimit/ratelimit.go:13-16`; `RATE_LIMITER=memory` is the default per `CLAUDE.md`), so a quota enforced only there resets on every deploy.
- One table or one column is enough: `AiUsage(userId, creditsUsed)` incremented **before** the model call and refunded on a `feature_disabled`/`bad_input` refusal, so a user never pays for a request that never reached the model.

### 3.5 Two findings that change the cost model

**(a) The prompt cache is almost certainly doing nothing.** `extract.go` sets `cache_control: ephemeral` on both the tool (`:92`) and the system prompt (`:171`), and the comment at `:48-50` claims repeated uploads only pay for the variable image. But Haiku 4.5's **minimum cacheable prompt is 4,096 tokens** ([prompt caching, cache limitations](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#cache-limitations), read 2026-10-31) — and the cached prefix here is the tool schema + system prompt ≈ **1,300 tokens** `[judgement]`. Prompts under the minimum "are processed without caching, and no error is returned". So the savings the comment assumes are not happening. **Verifiable in one request**: read `usage.cache_read_input_tokens` from any live call. If it is 0, the cache is a no-op. §3's numbers assume it is 0; if I am wrong, the input side is ~45% cheaper and nothing else changes.

**(b) A model swap is a bigger lever than BYOK.** `claude-haiku-5-5` is **$0.10 / $0.50 per MTok** — one-tenth the price — and its minimum cacheable prompt is **512 tokens**, so the existing `cache_control` would start working ([Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [pricing](https://platform.claude.com/docs/en/about-claude/pricing), read 2026-10-31). Offsetting: its tokenizer inflates the same text by "approximately 30 percent", and as a 4.7+ model it sits on the **high-resolution** tier (2,576 px / 4,784 tokens), so a 1600×1200 receipt jumps from 1,564 to **2,494** visual tokens. Net for one photo:

```
input  (1,300×1.3) + 2,494 = 4,184 → $0.000418
output   500×1.3 = 650     → $0.000325
                            ≈ $0.00074     ≈ 7× cheaper than today   [judgement]
```

**One env var (`ANTHROPIC_MODEL`) for a ~7× cost cut**, conditional on extraction quality surviving the model change — which is a measurement, not an assumption (§7). Given that, BYOK's cost argument is thin: the cheaper model already moves the bill by more than BYOK would, for one line.

### 3.6 The three-line fix that unblocks everything

`messageResp` should carry `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`), and `ExtractReceipt` should log it with `request_id`. Without that, every number in this section stays an estimate and no free tier can be tuned. This is smaller than any feature in §6 and should ride with the first one.

---

## 4. BYOK

### 4.1 Where the key can live

| Placement | Blast radius on leak | What we become |
|---|---|---|
| **A. Keychain on device**, provider called by the app | One user's key, on one device. Device compromise or an unencrypted backup. `KeychainStore.swift` already exists (`:4`, `:51` — currently `kSecAttrAccessibleAfterFirstUnlock`) but that flag lands in encrypted backups; a BYOK key needs `…ThisDeviceOnly`. `[fact]`/`[judgement]` | Nothing. We never hold it. |
| **B. Sent per request** to our endpoint, used, dropped | Every hop that touches the body: our handler, any proxy, any APM, any crash report. Transient custody, permanent risk. | A credential processor. |
| **C. Stored server-side per user** | A DB dump plus our key-encryption secret = **all users' provider keys**. Rotation, deletion, breach notification, and a support surface ("I entered a new key and it still fails"). | A credential custodian. |

`[judgement]` throughout; the ordering is the point. C is the worst and the one the owner's sentence most likely implies ("cho user tự nhập key" = the server uses it).

### 4.2 Who makes the call

**There are two call paths, not three.** The brief asks for three; the third one is not a separate path but the same two crossed with a storage decision. Being precise about this is what makes the recommendation in §4.6 defensible:

- **Device-direct (placement A).** Key never reaches us, request never counts against our rate limit or budget — and it is also the only version where a user-chosen **OpenAI-compatible base URL** is safe, because the device makes the request and SSRF is not our problem.
- **Server proxy (placements B and C).** The difference between B and C is *when* we stop holding the key, not *who calls*; the trust properties are the same while the request is in flight. Key stays off the device, and the image can keep using the existing decrypt path — but we hold a credential we did not issue, and if the provider/base URL is user-selectable, **our server becomes an SSRF proxy**: `POST` to `http://169.254.169.254/…` or an internal host, with an `Authorization` header the attacker chose. `[judgement]` Nothing in `api/` guards against that today — there is no outbound-URL allowlist anywhere in the AI path (`client.go:21` hardcodes one endpoint precisely because nothing else was needed).

### 4.3 What breaks — and a correction to the brief

The brief asks: "With a BYOK key, does the image still go through our API? If no, the app needs its own attachment decryption path, which does not exist."

**The second clause is not quite right, and the correction matters.** The app does **not** need its own crypto: `GET /api/files/{id}` already returns **decrypted** bytes (`Endpoints.swift:620-635` — "Decrypted bytes of an attachment"), and the app has **zero** CryptoKit/`SymmetricKey` usage (`grep -r CryptoKit ios/` → 0). So the device-direct image path is buildable today: download the decrypted bytes, then `POST` them to the provider from the phone.

**But that does not improve privacy at all.** The plaintext was decrypted **on our server** and streamed over the wire; the server still sees every image. The encryption-at-rest design (`FILE_MASTER_KEY` server-side only — `CLAUDE.md`, `api/internal/files/`) guarantees we are always in the plaintext path.

**Consequences:**

- **Server-side BYOK (B/C) for images:** the image still transits our API in plaintext. **The only gain is money.** The opt-in flag must stay — the disclosure would still be true. `[judgement]`
- **Device-direct BYOK (A) for images:** the image does *not* go through us **only if** the user picks a photo that was never uploaded. Any receipt already in the inbox has already been through the decrypt path. So "device-direct saves privacy" is true for *new* scans and false for *existing* attachments. That asymmetry is a product lie waiting to happen unless the copy is precise.
- **Typed text under BYOK** has none of these problems: there is no blob. Text is the one input where device-direct BYOK is clean.

### 4.4 Which provider

- **Anthropic only.** One adapter, one schema (the existing forced tool call), one set of error codes. Cheap to build, useless to a user who has an OpenAI key.
- **Any OpenAI-compatible endpoint.** Vastly more useful — it covers OpenAI, Groq, Together, OpenRouter, a local Ollama, an internal gateway — and vastly more surface: different vision payload shapes, different JSON-schema enforcement (many endpoints ignore `tool_choice`), different error envelopes, and the SSRF problem above. It also multiplies the "which model actually works" support burden across providers we cannot test. `[judgement]`

`[judgement]` If BYOK is ever built: **Anthropic-only in the server placement; anything-goes in the device placement**, because that is where the user's own infrastructure choice stops being our security problem.

### 4.5 Abuse — the key must never be logged

A user-supplied key on a public endpoint is a credential in a request body. What the repo does today, exactly:

- ✅ **Request logger does not log bodies or headers.** `httpx.Logging` (`api/internal/httpx/middleware.go:57-72`) logs method, path, status, bytes, duration, request id, remote — nothing else. `[fact]`
- ✅ **Query strings are not logged** (`middleware.go:90` states it), so a key must still never go in the URL — that comment is a promise, not a guarantee.
- ✅ **There is already a redaction precedent**: `RedactPath` strips a share token from a path before logging (`middleware.go:92-117`). A BYOK key needs the same treatment *by construction*: header or body only, never a path or query.
- ⚠️ **Error paths are the leak.** `writeAIError` does `slog.Error("ai handler error", "err", err)` (`handlers/ai.go:216`). If a key ever ends up inside an error value (a wrapped upstream request, a debug dump), it lands in the log. Any BYOK handler must **scrub before logging** and must never include the provider's request URL or headers in an error.
- ⚠️ **iOS errors are safe but only by accident.** `APIError` decodes `{error, message, fieldErrors}` (`Errors.swift:3-21`) and never keeps the raw body; `APIClient` has no `print`/`NSLog` calls (`[fact]`). That must be preserved: a key must never be part of a *response* the app can echo into a crash report.
- **Honest failure mode:** the user pastes a key, it is wrong or expired, and every extraction fails with the provider's 401 mapped to our `ai_upstream` 502 (`ai_extract.go:439-440`) — *unless* a distinct code is added, which it must be, or the user cannot tell "your key is wrong" from "the provider is down". New code: `ai_byok_invalid` → 400 with copy that points at the key field and nothing else.

### 4.6 Recommendation: not now, and never server-side

**BYOK is the wrong answer for this architecture, for four independent reasons:**

1. **The money it saves is a rounding error at the scale where it would be built.** §3.3: $16/month at 1,000 users. A model swap (§3.5b) cuts more, for one env var.
2. **It cannot buy privacy.** §4.3 — the image is decrypted server-side by design. BYOK's best claim ("your data stays yours") is false for the one input that matters.
3. **Server-side custody is expensive in a way that does not show up in the cost table**: encrypted storage, rotation, deletion, breach surface, SSRF, per-provider adapters, and a new support class ("my key doesn't work" is now a ticket we own).
4. **A free tier already covers the honest need.** The user who runs out of 20 credits is a user who has added 20 devices — a power user, and the right person to give a BYOK escape hatch *later*, in the device-direct form only.

**What to do instead:** free lifetime credits (§3.4) + typed-text input (§2) + the on-device path (§5.3). If BYOK ever ships, ship **placement A only** — Keychain, device-direct, Anthropic-only — and say plainly in the copy that a photo already in the inbox has already passed through our server.

---

## 5. Free is not the same as usable

The owner's follow-up has a real answer, and it is uncomfortable: **free exists, and the largest free tier cannot be used for this feature.** The decisive column is not price or quota — it is what the provider does with the receipt.

### 5.1 The candidates

All read **2026-10-31**.

| Provider / path | Vision? | Vietnamese? | Free limit (as of 2026-10-31) | **Trains on your data?** | Commercial use | Verdict for this workload |
|---|---|---|---|---|---|---|
| **Google Gemini API — free tier** | Yes | Yes | No static public number any more: limits are **per project**, shown only in AI Studio, and Google states they "are not guaranteed" ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)) | **Yes.** Free tier: **"Content used to improve our products"** (verbatim, [pricing](https://ai.google.dev/gemini-api/docs/pricing)); the free-services section of the terms adds that reviewers may read and process API inputs/outputs and tells developers not to submit sensitive, confidential or personal information ([terms](https://ai.google.dev/gemini-api/terms), read in a translated locale — see §7) | Allowed, but the terms impose an **18+ / no-minor-app** condition | ❌ **Disqualified.** A receipt carries a name, a shop, a price, a serial. Google's own terms tell us not to send it. |
| **OpenRouter — `:free` models** | Model-dependent | Model-dependent | Free models exist; rate limits vary by model | Not guaranteeable: training is **per provider**, there are **separate settings for paid and free models**, and free routes can include providers that train ([privacy docs](https://openrouter.ai/docs/features/privacy-and-logging)) | Varies | ❌ Not usable as a *privacy claim*. The one thing we need is the one thing it cannot promise. |
| **Cloudflare Workers AI** | Yes (`@cf/meta/llama-3.2-11b-vision-instruct` etc.) | **Unproven** — must be measured | **10,000 Neurons/day**, then requests **fail with an error**; paid overage $0.011/1,000 Neurons ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)) | **No.** Verbatim: "**Zero data retention** … Cloudflare **does not use Customer Content processed by Workers AI to train AI models**" ([data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)) | Yes | ⚠️ **The only hosted free tier whose terms pass.** ~**280 receipts/day** free `[judgement]`; quality unknown. |
| **Groq** | Yes (OCR / image-recognition models) | Unproven | Free tier exists; limits are **org-level** RPM/RPD/TPM ([rate limits](https://console.groq.com/docs/rate-limits)) | **Not established**: the page I read commits to *retention* limits ("By default, Groq does not retain customer data for inference requests"), not to *no training* ([your data](https://console.groq.com/docs/your-data)) | Unclear | ⚠️ Cannot recommend until the DPA is read. Not a "no" — an "unverified". |
| **Mistral free tier** | Yes | Unproven | **Could not read**: `mistral.ai/terms` and `docs.mistral.ai/…/tier/` returned JS-only shells to the fetch | **Unknown** | Unknown | ❓ Not established. Do not plan around it. |
| **OpenAI API** | Yes | Yes | **Not verified** — I did not read OpenAI's pricing page; I know of no free API tier, but that is memory, not evidence | Not verified here (API data is not used for training by default under its business terms — **memory, not read today**) | Yes | ⏭️ Excluded: already the paid baseline, and the question is about *free*. |
| **Apple on-device: Vision OCR + rule-based parser** | Yes (OCR only) | **Unverified for Vietnamese** — Apple does not publish the static list; `supportedRecognitionLanguages(for:revision:)` returns it at runtime, so this is a one-line check in the spike | **Free forever.** No network, no quota | **Nothing leaves the device.** No transfer at all | Yes | ✅ **The only unambiguously usable "free".** See §5.3. |
| **Apple on-device: Foundation Models** (`SystemLanguageModel`) | Text-only (needs OCR in front) | **Vietnamese is in the supported locale set** — per a third-party matrix as of iOS 26.1, **not** an Apple statement I read; Apple says query `supportsLocale(_:)` at runtime | Free; **requires Apple Intelligence-capable device and region** | Nothing leaves the device | Yes | ✅ Viable on capable devices; availability is the catch. |

Notes on the two that matter most:

- **Google's disqualifier is a term, not a number.** Even if the free tier gave 1,000 requests/day forever, the published terms state that content sent to the free tier is used to improve Google's products, that human reviewers may read and process API inputs and outputs, and that developers should not send sensitive, confidential or personal information. A receipt is personal information. This is not a preference; it is the one input to this feature that we cannot hand over for free. `[fact + judgement]`
- **Cloudflare's free number means something concrete.** 10,000 Neurons/day ÷ ~35.6 Neurons per receipt (2,500 input tokens at 4,410/M + 400 output at 61,493/M) ≈ **281 receipts/day ≈ 8,400/month**, hard-stopped, on **our** Cloudflare account, not per user. That is enough to make the feature free for roughly the first few hundred users if each scans a couple of times — and no more. Paid overage works out to **≈ $0.0004 per receipt**, ~13× cheaper than Haiku 4.5. `[judgement, derived from cited price rows]`
  The open question is the only one that matters: **can Llama 3.2 11B Vision read a Vietnamese thermal receipt?** Unmeasured. If yes, Cloudflare is a better *and* cheaper primary than Anthropic; if no, it is not a candidate.

**Latency, which the table cannot hold** `[judgement, unmeasured]` — the tap expects an answer in a couple of seconds:

| Path | Expected wait | Why it matters |
|---|---|---|
| On-device Vision OCR | ~0.1–0.5 s | Feels instant; works in a shop basement with no signal — the actual place a receipt is photographed. |
| Cloudflare Workers AI (11B vision) | ~1–4 s, cold starts possible | Acceptable, but a cold start on a 2-second expectation is a bad first impression. |
| Gemini / Groq | ~1–3 s | Comparable; neither is disqualified on latency. |
| Anthropic Haiku 4.5 (today) | ~2–5 s for an image + a 500-token draft `[judgement]` | Already at the edge of the expectation, and the client shows a spinner (`DeviceFormView.swift`, `Đang quét hoá đơn…`). |

None of these is a disqualifier. The point is that **on-device is the fastest option as well as the freest**, which is not the usual trade-off.

### 5.2 What the table actually says

Three different kinds of "free", and only two are usable:

1. **Free but trains on your data** (Gemini free). Cheapest, fastest, and probably the strongest Vietnamese of the set (unmeasured here) — and unusable. **A free tier that reserves the right to learn from the receipt is not free; it is paid for with the user's data, and we would be the ones spending it.**
2. **Free and does not train, but the quota is ours and small** (Cloudflare Workers AI; Groq unverified). Usable for early users; not a strategy at 10,000.
3. **Free because it never leaves the phone** (Apple on-device). The only one that scales to any number of users at zero marginal cost *and* improves the privacy story rather than spending it.

### 5.3 On-device, in detail — the option that changes the answer

**Why it is the right answer and not a compromise:** today the opt-in exists for exactly one reason — the decrypted image leaves the box (`ai_gate.go:48-62`, migration `0003_user_ai_optin`). If the receipt is read on the phone, **that reason disappears for the image path**, and the strongest privacy claim in the product gets stronger instead of weaker.

Two tiers, and the second is not needed for the first to ship:

**Tier 1 — Vision OCR + a rule-based parser (no model at all).**
`VNRecognizeTextRequest` runs fully on-device and returns text + bounding boxes. A deterministic parser can then take the fields that are *shaped*:
- **Price**: `28.990.000đ`, `28,990,000 VND`, `28.990.000` — a digit-grouping regex. High reliability.
- **Date**: `15/03/2026`, `15-03-26`, `15.03.2026` — Vietnamese receipts put the date near the top or near the total. Medium reliability.
- **Serial/IMEI**: 15-digit IMEI with a Luhn check. **A claim that is easy to get wrong:** the checksum exists **server-side only** — `luhnValid` in `api/internal/services/serial_validation.go:204-209`; the iOS helper explicitly refuses to do it ("It does not guess, upcase, validate a Luhn checksum or enforce a length" — `SerialScanText.swift:23`), and `DeviceWarnings.swift:43` only *renders* the server's `IMEI_CHECKSUM` code. So Step 3 needs ~15 lines of Swift (a direct port of `luhnValid`) — negligible, but it is **new code**, and without it an on-device IMEI can only be length-checked. With the port, precision is very high, because a misread digit fails Luhn.
- **Shop**: match against the curated `Store` catalog with the **existing** diacritic-insensitive matcher (`fuzzy.go:16-83`) — the same function, running locally on a small list.
- **Product name/brand/category**: the weak part. A rule-based parser cannot reliably split "iPhone 15 Pro 256GB" from a receipt. **This is where a model helps — and it is also where the fields are least critical**, because the user has to confirm the name anyway, and it is the field they will always check.

So Tier 1 plausibly fills **four of the fields — price, date, IMEI, shop — with zero cost and zero data movement**, leaving the user to type the name. That is a *worse draft* than the server call and a *better product*, because it works offline, costs nothing, needs no consent, and cannot leak.

**Tier 2 — Foundation Models for the rest.**
`SystemLanguageModel` with guided generation (`@Generable`) over the OCR text, on-device. Vietnamese appears in the supported-locale set per a third-party matrix as of iOS 26.1 — **not** something I read in Apple's docs — and the same source notes, citing Apple's research, that quality varies by language and is generally worse for non-English. Availability also depends on device **and region** (Apple's `SystemLanguageModel` page). So this must be `supportsLocale`/`availability`-gated at runtime, with Tier 1 as the fallback on every device that does not qualify.

**What it costs:** nothing per user; engineering time only. **What it would change:** the Settings disclosure (`SettingsView.swift:230`) would need a new sentence for the local path — §9 forbids *shortening* the existing one, and the existing one must stay for the server path and for claim assessment. Two disclosures, one switch, no lie.

**The measurement that decides it** (§7): 30 real Vietnamese receipts, run through Tier 1, scoring per field against hand-verified truth. If price + IMEI + date clear ~90% and the shop clears ~70%, ship Tier 1 as the default and demote the server call to "fill in the name".

### 5.4 Verdict

- **Is there a free option?** Yes, two: **on-device** (unlimited, private, free) and **Cloudflare Workers AI's free allocation** (~280 receipts/day, no training, hard stop).
- **Is the best-known free tier usable?** **No.** Gemini's free tier is free because Google learns from what you send it, and its terms tell developers not to send personal data — which a receipt is. `[fact]`
- **What does it cost in privacy rather than money?** Gemini's free tier costs the receipt. Workers AI's costs nothing in privacy but caps at ~280/day and depends on a model whose Vietnamese quality is unmeasured. On-device costs nothing at all, and is the only option that removes the transfer instead of moving it.
- **Therefore:** do not pick a paid option because "the free ones are unusable" — that conclusion is false. Pick **on-device first**, keep Anthropic as the paid fallback for the fields on-device cannot do, and treat Cloudflare as a *cost* optimisation to evaluate only if Vietnamese OCR quality on their vision model clears the bar.

---

## 6. Ranked build order — three steps, each shippable alone

*This is a build order, not a provider ranking. §5 answers **who should do the extraction**; these are the three increments, ordered by dependency and by how little each one can break. Step 1 is the prerequisite for measuring anything at all; Step 2 is the owner's explicit ask and the cheapest win; Step 3 is the experiment that decides the provider question in §5.*

### Step 1 — Make the cost visible and bounded *(server only; no user-visible change until the cap)*

- Parse `usage` in `messageResp` (`extract.go:133-135`) and log tokens per call with `request_id`.
- Add the per-account credit counter in Postgres (20 lifetime; PDF = 5), incremented before the call and refunded on refusal; expose `GET /api/v1/ai/usage`.
- Enforce it next to `checkAIGate` (`ai_gate.go:48-62`) so both AI features share one budget rule, exactly as they already share the gate.
- **Ships alone:** yes. Nothing changes for a user with credits left; the owner gets the first real cost number, which every later decision needs.
- **Why first:** §3.6. Without it, the free-tier number in §3.4 is a guess and the abuse ceiling in §3.3 is unmeasured.

### Step 2 — Typed-text parsing *(server + iOS)*

- `POST /api/v1/ai/parse-text` (§2.4), new prompt, same tool schema, same `DraftDevice`, 1 credit, own rate-limit bucket.
- iOS: one item in the existing OCR `Menu` (`DeviceFormView.swift:~811`), one `TextEditor` sheet, reuse `applyDraft` (`~:1787`).
- **Ships alone:** yes — it is additive, and a user who never opens it is unaffected.
- **Why second:** it is the owner's explicit ask, it costs about half a photo, and it reuses every downstream piece that already exists. It is the highest value-per-hour item on this list.

### Step 3 — On-device OCR spike, behind a flag *(iOS only)*

- `VNRecognizeTextRequest` on the picked photo; Tier-1 rule-based extraction for **price, date, IMEI (Luhn), store (existing fuzzy matcher)**; show the draft with **no network call**.
- Measure on 30 real receipts before deciding anything. Then optionally Tier 2 (`SystemLanguageModel`) for name/brand on capable devices.
- **Ships alone:** yes, behind a flag; if the accuracy is bad, delete it and nothing else moved.
- **Why third:** it is the only path that changes the privacy answer and the only "free" that scales (§5.3-5.4) — but it is a measurement, not a feature, until the number exists.

**Not in the top three:** BYOK (§4.6). Revisit only if Step 1's data shows real users exhausting 20 credits — and then only in the device-direct form.

---

## 7. What I could not determine

**Measurements I cannot take here**

1. **Exact prompt token count.** No tokenizer in this environment. 1,300 is an estimate from 2,050 Vietnamese characters + a JSON schema; ±30% is honest. This estimate is what makes the prompt-cache finding (§3.5a) a strong suspicion rather than a proof — though the gap to the 4,096-token minimum is large enough that the conclusion is unlikely to flip.
2. **Whether the prompt cache is actually working.** Requires one live call: read `usage.cache_read_input_tokens`. If non-zero, my cost figures are ~45% too high on the input side.
3. **Real scans per user per month.** No telemetry exists. The whole of §3.3 rests on "3 per user per month", which is an assumption.
4. **Vision's Vietnamese accuracy on real receipts.** Apple publishes no per-language accuracy, and thermal receipts are the hard case. Needs the 30-receipt test in Step 3.
5. **Whether Apple Intelligence / Foundation Models is available in Vietnam on the owner's target devices.** Apple's docs say availability depends on device **and region** and must be checked at runtime (`SystemLanguageModel.availability`); I could not establish the region matrix.
6. **Cloudflare's Llama 3.2 11B Vision on a Vietnamese receipt.** Unmeasured. This single number decides whether Workers AI is a cheap primary or a non-candidate.
7. **Whether Haiku 5.5 preserves extraction quality.** The ~7× saving (§3.5b) is real arithmetic on a real price list; whether the drafts stay good enough is an eval.

**Things I could not verify**

8. **Mistral's free-tier data terms** — the pages I fetched returned JS-only shells (2026-10-31). Listed as "not established", not as "no".
9. **Groq's no-training commitment** — their data page commits to retention limits; I did not find an explicit no-training sentence. Needs their DPA, not their marketing page.
10. **Gemini's terms were served to me in a translated locale** (`?hl=fi`), so the quoted English phrasing of "do not submit personal information" is my rendering; the pricing page's **"Content used to improve our products"** is verbatim English. The meaning is not in doubt, the exact English wording is.
11. **OpenAI's own pricing page** — not read. The row is marked "not verified" rather than asserted.
12. **Google Cloud Vision's free OCR tier** — a possible fourth candidate (optical character recognition only, so a different data regime from Gemini's free LLM tier), not evaluated here. If the on-device OCR quality turns out to be insufficient, this is the next thing to check: it would still keep the *interpretation* on our side.
13. **Anthropic's terms on a proxy holding a third party's key** — not read. If BYOK ever becomes a real plan, this is a legal question before it is an engineering one.
14. **Whether `GET /api/files/{id}` returning decrypted bytes is intended to be used by third-party clients** — the iOS code says it is (`Endpoints.swift:629-635`), but it is the pivot of the BYOK privacy argument in §4.3 and deserves an explicit decision.

**Decisions that are the owner's, not mine**

15. **The free allowance number** — 20 is my proposal; it is a product/pricing decision.
16. **Whether typed text shares the AI consent switch** — I recommend one switch and an extended footer (§2.3.5); the alternative is a second consent, which I think is worse. It is his call because it changes a legal string.
17. **The new consent copy** for typed text and (if Step 3 lands) for the on-device path. §9 of the visual direction forbids shortening the existing disclosure, not adding to it — but new privacy copy is the owner's to approve.
18. **Whether to switch `ANTHROPIC_MODEL` to a cheaper tier now** and accept a quality re-eval, versus after Step 1 gives real numbers. My read: after Step 1, because the eval needs the usage data anyway.
19. **VND/USD** — I used 26,000 for readability. The repo has an FX path (`api/internal/fx/`) but it is for device pricing, not this.
