# Warrly iOS — what real apps put on screen one

**Status:** research note. Nothing in `ios/` was touched.
**What this is:** a check of Direction 1 (`WARRLY-login-redesign.md`) against
screenshots of apps that actually ship. That document reasons from Apple's
guidance and from measurements of our own screen; it contains **no observation of
any other product**. This one is only observation, and it contradicts the other
document in three places and confirms it in the rest.
**What this is not:** a re-ranking of the three directions, a new design, or a
proposal to change `api/`. Direction 1 is the baseline. Assume it ships as
specified in §6 of the other document; the question here is what the market says
about that specification.

**How to read this.** **[evidence]** means I looked at the attached image or the
named file and the claim is checkable in it. **[taste]** is my judgement.
**[assumption]** is a belief I could not verify from a screenshot and am flagging
rather than smuggling. Every screenshot discussed is in `login-research/shots/`.

**Capture dates.** Apple Support CDN assets and the live web pages were captured
**2026-10-31**. The MoMo screenshot is from a 2023 tutorial article and the Zalo
screenshot from a 2023 article — both are older than the rest and both are
third-party captures, tagged as such where they are used.

---

## 0. The four answers, in brief

1. **What they share with Direction 1 is mostly structural, not fashion.** No app
   in the sample has a card, a gradient, or a second competing primary action. The
   flat page is not a style — it is what everyone converged on. But the *centred
   mark* is also near-universal, and Direction 1 breaks that, which is the one
   place where it is the outlier rather than the moderniser.
2. **What Warrly doesn't do:** accept a phone number as an identity (5 of 7 field
   screens do), put the register link next to the action (5 of 5), centre the mark
   (5 of 5 single-column pictograms), and name the product in the title (3 of 6).
   Ranked in §4.2.
3. **Vietnam: phone is the identity, but "phone + OTP" is not universal.** MoMo
   has no password on screen at all; Zalo's web login has *no fields at all*;
   Shopee — the biggest e-commerce app in the country — uses
   `Email/Số điện thoại/Tên đăng nhập` **plus a password**, with SMS as a separate
   link. The norm is "phone as username", not "phone + OTP". §4.3.
4. **The flat page is real and common; the left-aligned pictogram is not.** Seven
   of seven form screens have no card. Netflix is essentially Direction 1 with a
   wordmark instead of a mark. But every single-column page that shows a pictogram
   centres it. §4.4.

---

## 1. What I actually saw

Fifteen screens across thirteen apps; the five utility listings are collapsed into
one row at the bottom.

| # | App | Screen | File | Eye lands on | Fields before first commit | Primary action | Gradient | Mark | Register link | Theme seen |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Apple** | Settings row, iOS 26, not signed in | `apple-01-settings-apple-account-ios26.png` | the row itself, first group of Settings | 0 | none — the row opens a sheet | none | 44 pt colour pictogram, **left**, inside the row | — | light |
| 2 | **Apple** | Apple Account sheet ("Forgot Password?" state), iOS 26 | `apple-02-account-sheet-forgot-password-ios26.png` | centred blue dot-ring, ~90 pt | 1 (email or phone) | `Continue` in a system sheet | none | ~90 pt, **centred**, inside a sheet | link inside the sheet | light |
| 3 | **Apple** | `account.apple.com/sign-in` | `apple-03-web-signin-desktop.png` | centred ~300 px multicolour dot-ring | 1 (`Email or Phone Number`) | **two** peers: `Continue` + black `Sign in with Passkey` | none | **centred** | none | light |
| 4 | **1Password** | `my.1password.com/signin` | `1password-01-web-signin.png` | the **QR card**, above the email field | 1 (email) — but QR first | small blue `Continue`, not full width | none | ~130 pt keyhole, left of the form column | `Create a new account` in the footer link row | light |
| 5 | **MoMo** | app login, phone | `momo-01-app-login-phone.jpg` | the empty phone field | 1 (`+84` picker + number) | `Tiếp tục`, full width, magenta | campaign banner art, not a page gradient | none on the form | none visible | light |
| 6 | **Shopee VN** | app login, from Shopee's own help centre | `shopee-vn-01-app-login-helpcentre.jpg` | centred orange bag logo | **2** (`Email/Số điện thoại/Tên đăng nhập` + `Mật khẩu`) | `Đăng nhập`, full width, **grey/disabled** | none | 44 pt, **centred** | `Đăng ký`, in the link row under the button | light |
| 7 | **Zalo** | web login, from a 2023 tutorial | `zalo-01-web-login-qr.png` | the QR code | **0** | none — the QR *is* the action | none | the logo is the QR placeholder | `Bạn chưa có tài khoản? Đăng ký ngay!` under the card | light |
| 8 | **Netflix** | `netflix.com/login` | `netflix-01-web-login.png` | the 32 pt left-aligned headline | 1 (`Email or mobile number`) | `Continue`, full width, red | dark red vignette, not a gradient band | **wordmark** ~20 pt, top-left | `get started with a new account` in the subhead | dark only |
| 9 | **Notion** | `notion.so/login` | `notion-01-web-login.png` | centred N logo | 1 (email) | `Continue`, full width, blue | none | 36 pt, **centred** | `New user? Sign up` under the provider tiles | light |
| 10 | **Linear** | `linear.app/login` | `linear-01-web-login.png` | centred white sphere | **0** | four stacked method buttons | none | 36 pt, **centred** | `Don't have an account? Sign up` centred | dark only |
| 11 | **Things 3, Bear, Streaks, Paprika 3, Flighty** | App Store lead screenshots | `appstore-01-lead-shots-utilities.jpg` | the app's actual content | — | — | — | app icon only | — | — |

### Tally

- **Cards around the form: 0 of 7.** Netflix, Notion, Linear, Shopee, MoMo,
  Zalo, 1Password — none wraps its form in a raised card. 1Password has a card, and
  it is the QR panel *above* the form, not the form. **[evidence]**
- **Gradients on the page: 0 of 11.** Netflix's near-black is a radial vignette
  behind a flat form; MoMo's pink is a campaign banner at the top of the screen with
  a white form below. Nothing paints a gradient *under the fields*. **[evidence]**
- **Fields before the first commit: 0 or 1 on 8 of 9 gated screens.** Only Shopee
  asks for two at once. **[evidence]**
- **Pictograms centred: 5 of 5 single-column pages** (Notion, Linear, Shopee, Apple
  web, Apple sheet). 1Password is a sixth pictogram and it is left of a two-column
  desktop form. The only top-left logo in the entire sample is Netflix's, and it is
  a **wordmark**. **[evidence]**
- **Register link placement: 5 of 5 adjacent to the primary action**, never pinned
  to the bottom edge of the screen. **[evidence]**
- **Title and button use different strings in 5 of the 6 screens that have both**
  (Netflix, Apple web, 1Password, Notion, Linear). Shopee is the one that repeats
  `Đăng nhập` in the nav bar and on the button. Three titles name the product:
  `Sign in to 1Password`, `Log in to your Notion account`, `Log in to Linear`.
  **[evidence]**

---

## 2. What I could not get, named

Being explicit, because a missing screenshot is not a missing fact and I do not
want the absences read as findings.

- **App Store and Play Store listings never show the login screen.** I pulled the
  full screenshot sets for Zalo, MoMo, Shopee, Grab, VNPAY and eight Vietnamese
  banks (Techcombank, MB, VCB Digibank, VPBank NEO, TPBank, BIDV, Zalopay,
  VNPAY). Every single shot is post-login marketing — balances, charts, mascots,
  "Asia-Pacific's Best Digital Banking App". See
  `appstore-02-lead-shots-vn-banks.jpg` and `playstore-01-zalo-contact-sheet.jpg`.
  **The login is the one screen nobody photographs on purpose.** That is itself
  worth knowing: there is no market convention being advertised, only one being
  shipped.
- **Grab.** No screenshot found. Its help centre is JS-only and returned 4 KB of
  nothing; its listing is marketing. Named, not covered.
- **VNPAY.** Play Store package id 404'd; App Store listing is marketing. Named,
  not covered.
- **Vietnamese banking app login screens.** Not obtained. The pre-auth screen of a
  Vietnamese bank app is the most likely place to find `username + password + OTP`
  in one place, and I could not see one.
- **Live capture of `chat.zalo.me` and `shopee.vn/buyer/login`.** Both returned a
  7.5 KB blank page to headless Chrome (anti-bot). The Zalo and Shopee images here
  are therefore *published* screenshots, not live captures — and the Shopee one is
  from Shopee's own help centre, which makes it the more trustworthy of the two.
- **Mobbin, Screenlane, Nicely Done.** Screenlane now redirects to a paywalled
  landing page ("Try 3 Days"); Mobbin is login-walled. Neither was usable.
- **Light/dark parity.** I could not verify it. Every static screenshot I have is
  single-theme. Netflix and Linear present a fixed dark first screen and have no
  light variant at all; everything else was light. **Do not read the "theme seen"
  column as "this app has only one theme."**
- **The Apple App Store's in-app sign-in sheet.** Not captured. The Apple Account
  sheet in `apple-02` is the same sheet in its "Forgot Password?" state, which is
  the closest verifiable thing; the email+password state could not be found in
  Apple's public assets.

---

## 3. The screens that taught me something

Four of the eleven are worth more than a table row.

### 3.1 Apple, the two shapes it uses for its own account

Apple never shows its users a full-screen login page on device. There are exactly
two shapes, and neither is a page:

**A row in Settings.** `apple-01`: the first group of Settings is the Apple Account
row — a **44 pt colour pictogram on the left**, the words `Apple Account`, a
**two-line explanation** ("Sign in to access your iCloud data, the App Store, Apple
services, and more."), and a chevron. That is the most-seen login entry point on
iOS, and its entire design is: small left-hand mark, name, *what you get*, tap.
**[evidence]**

**A sheet.** `apple-02`: tapping it opens a modal sheet with an X in the top-right
corner, a **centred ~90 pt dot-ring**, a **left-aligned 28 pt bold title**
(`Forgot Password?`), a grey explanatory sentence, then one field. Not a page. Not
a card. A sheet. **[evidence]**

The lesson for Warrly is narrow but real: **Apple puts a pictogram on the left only
inside a list row, and centres it whenever it is the top of a surface.** The sheet
is the closest thing Apple has to a login screen and it centres the mark.

### 3.2 Apple's web sign-in offers passkeys at parity, not as a link

`apple-03`: one field (`Email or Phone Number`), a legal paragraph, and then **two
buttons side by side** — a pale `Continue` and a black `Sign in with Passkey` with
a key glyph, plus a footnote that it "Requires a device with iCloud Keychain".
**[evidence]**

This is the strongest available evidence for the passkey argument the other
document makes from HIG text: Apple doesn't describe passkeys as an option, it
renders them as a **peer of Continue** on its own login page. Warrly cannot copy
this today (no WebAuthn in `api/`), and this note does not propose it. It is
recorded because it explains *why* a password-only screen will read as
behind-the-curve to anyone technical, even when it is otherwise well designed.

### 3.3 Vietnam, three different answers to the same question

**MoMo** (`momo-01`) — the wallet with tens of millions of users. The whole screen
is: a campaign banner, a white card with a `+84` country selector and an empty
phone field with a clear button, a full-width magenta `Tiếp tục`, and the **numeric
keypad already up**. There is no password field anywhere. **[evidence]**
*(Caveat: this is a 2023 third-party capture carrying a `fingo` watermark and a
`Việt | Eng` pill that are the article site's overlay, not MoMo's. The app chrome —
status bar, card, keypad — is real.)*

**Zalo** (`zalo-01`) — the messenger. The web login is a centred white card on pale
blue: a heading, two tabs (`VỚI MÃ QR` active, underlined | `VỚI SỐ ĐIỆN THOẠI`),
a QR code, the caption `Quét mã QR bằng Zalo để đăng nhập`, and
`Bạn chưa có tài khoản? Đăng ký ngay!`. **Zero input fields.** The default path is
to prove identity with a device that is already signed in. **[evidence]**
*(2023 third-party capture.)*

**Shopee** (`shopee-vn-01`) — the e-commerce app, and the most useful screenshot in
the set because it is from Shopee's own help centre. A nav bar with a back arrow, a
**centred** title `Đăng nhập`, and `Trợ giúp` on the right. A centred 44 pt orange
bag logo. Then `Email/Số điện thoại/Tên đăng nhập` and `Mật khẩu` — **a password
field** — with `Quên?` inside the password row. A full-width **grey (disabled)**
`Đăng nhập`. Then a row of two plain links: `Đăng ký` left, `Đăng nhập bằng SMS`
right. Then `Hoặc`, then three full-width social buttons: Google, Facebook, Apple.
**[evidence]**

That one screen contains the answer to question 3 and also the answer to "is the
two-field form dead": no. It also contains the two things Direction 1 does
differently and better — Shopee uses **in-field placeholders** (gone on the first
keystroke) and puts **the same string** on the nav title and the button.

### 3.4 Netflix is Direction 1

`netflix-01`: a `NETFLIX` wordmark about 20 pt tall in the top-left; a 32 pt
**left-aligned** headline `Enter your info to sign in`; a left-aligned grey
sub-line that also carries the register path (`Or get started with a new
account.`); **one** field with its label inside it; one full-width red `Continue`;
then `Get Help`, a reCAPTCHA line, and a footer of six links. No card, no centred
logo, no gradient band under the form. **[evidence]**

Strip the brand and this is Direction 1: flat page, left-aligned title at the
gutter, one commit, the register path subordinate. It is the only screen in the
sample that proves the composition works at global scale — and it is also the
sample's only **wordmark**, which matters in §4.4.

---

## 4. The four questions

### 4.1 What they share with Direction 1 — and is the agreement proof?

Direction 1 shares four things with the sample. They do not all mean the same
thing.

| Shared with Direction 1 | How universal | Why it is universal | Verdict |
|---|---|---|---|
| **No card; fields sit on the page** | 7 of 7 form screens | Nothing structural forces it. This is a genuine convergence — a card adds a second surface and a second edge to align, and every screen here decided the form *is* the page | **Right. Keep.** |
| **No gradient** | 11 of 11 | Gradients date a screen to a specific era of design tooling; nobody shipping in 2026 paints one under a form | **Right. Keep.** |
| **One primary action, nothing competing** | 11 of 11 | Subscription economics: the only thing on the screen that should look tappable is the way in | **Right. Keep.** |
| **Register is subordinate, never a second button** | 5 of 5 that have one | Sign-in is the returning-user path; new users are the minority on any app that has been installed | **Right. Keep.** |

None of those four is "everyone copied each other". They are the same answer
arrived at from the same constraint: **a login screen has exactly one job and every
decoration on it is a second job.** Direction 1 deleting the gradient, the centred
hero and the 66 pt dead CTA is not chasing a trend; it is removing things that
were never doing work.

But two other things in the sample are convention, not proof:

- **The centred mark.** 5 of 5 single-column pictograms are centred. That does not
  make centring *better*; it makes it *expected*. Direction 1 breaks it. See §4.4.
- **Labels inside the field.** 4 of the 6 field screens whose label state is
  legible (Netflix, Shopee, MoMo, Apple's web page) put the label in the field as a
  placeholder, where it vanishes on the first keystroke. Only 1Password and Notion
  put it above. Direction 1's labels-above is the minority position — and the
  correct one. See §6.

So: **the agreement is mostly earned, and the disagreements are mostly Direction 1
being right where the market is lazy.** The one exception is the mark.

### 4.2 What Warrly doesn't do that most of them do — ranked

Ranked by how much it matters **for a utility whose job is remembering warranties**,
which is a returning-user product with one account per person, used a few times a
month, on a phone, in Vietnam.

**1. Accept a phone number as the identity. (Highest.)**
5 of the 7 screens with a text field accept one: Apple (`Email or Phone Number`),
Netflix (`Email or mobile number`), Shopee (`Email/Số điện thoại/Tên đăng nhập`),
MoMo (phone only), Zalo (phone, via QR). Notion, Linear and 1Password are the
email-only exceptions, and all three are Western B2B/software products. Warrly's
first field takes an email and only an email, because
`POST /api/v1/auth/login` takes one.
**This is not a `LoginView` change and must not block the rebuild.** But it is the
largest single divergence in this document and §4.3 says why it matters more here
than in California.

**2. Put the register link next to the action. (Second.)**
Shopee puts `Đăng ký` in the link row directly under the button. Zalo puts it
directly under the card. Notion puts `New user? Sign up` under the provider tiles.
Netflix puts the register path in the sub-headline, above the field. **Nobody pins
it to the bottom edge of the screen.**
Direction 1 pins it to the safe-area bottom. In `login-redesign/d1-light.png` that
leaves **~327 pt of empty page — 39 % of the screen — between the coral button and
the footer**. The other document already names this as the direction's main risk
("the 40 % of empty screen below the button can read as unfinished"). The market
says the risk is real and the fix is free: move the line up, let the page end where
the content ends.

**3. Centre the mark. (Third.)**
5 of 5 single-column pictograms are centred. Direction 1's left-aligned 28 pt
pictogram is the only left-aligned pictogram in the sample. §4.4 has the detail.

**4. Give the screen a title that isn't the button. (Fourth.)**
`Đăng nhập` appears twice in Direction 1 — as the 34 pt title and on the coral
button. Shopee does the same, so it is not unprecedented; but 5 of 6 screens with
both use different strings, and 3 name the product
(`Sign in to 1Password`, `Log in to your Notion account`, `Log in to Linear`).
`Đăng nhập Warrly` costs one new localization key and is the cheapest way for the
first screen to say whose app it is. **[taste on the wording; evidence on the
frequency]**

**5. Offer a second method. (Fifth — and out of scope.)**
5 of 11 screens show more than one way in, and they are all *rows or tiles*, never a
text link: Notion has six tiles (Google, ChatGPT, Apple, Microsoft, **Passkey**,
SSO), Linear has four buttons (**passkey** last), Shopee has three social buttons
plus SMS, Apple pairs `Continue` with `Sign in with Passkey`, Zalo has two tabs.
Warrly has one, and cannot have more without backend work. Worth recording that
the *shape* of a method choice in 2026 is a list, not a link — if a second method
ever lands, it must not be a footnote.

**6. Say what the account is for. (Sixth — weak evidence.)**
Four screens carry a supporting line: Apple's Settings row ("Sign in to access your
iCloud data, the App Store, Apple services, and more."), Netflix ("Or get started
with a new account."), Notion ("Your AI workspace."), Apple's web page ("Manage
your Apple Account"). Four of eleven is not "most", and the other document's
argument that a person who installed the app does not need to be sold the app still
holds. **I would not add a line back.** But the Apple Settings row is worth noting
because it is the counter-example everyone reaches for: Apple *does* explain the
value, to a person who already owns the phone. **[taste]**

**Not a market pattern, but a Warrly-specific gap:** the **language control**. The
login screen is the only screen in the app that runs before a stored language
preference can be read, and Warrly is bilingual with English as the default, in a
market where the user is Vietnamese. Notion is the only app in the sample that
ships a control for this on the login page (`Language: English (US)` in the
footer); Apple, Netflix, Shopee and MoMo simply inherit the device locale, which
is the better answer. **Verify which one Direction 1 does.** If the first screen a
Vietnamese user ever sees is in English because English is the app's default
rather than the phone's language, that is a real defect and no screenshot in this
sample would excuse it. **[assumption — I did not read the localization path in
`ios/`]**

### 4.3 Is `phone + OTP` the norm in Vietnam where it is `email + password` in the West?

**Partly, and the part that is true is the part that matters.**

Plainly:

- **The phone number is the identity in Vietnam.** All three Vietnamese screens I
  saw lead with it. MoMo's only input is a `+84` number. Zalo's alternative to QR
  is labelled `VỚI SỐ ĐIỆN THOẠI` — "with phone number" — not "with email". Shopee's
  identifier field is `Email/Số điện thoại/Tên đăng nhập` — email is listed first
  but it is one of three, and the other two are phone and username.
  **[evidence]**
- **"OTP" is not the universal second step.** MoMo goes phone → OTP with no
  password. Zalo skips both and uses a QR code from an already-signed-in device.
  **Shopee — the country's largest e-commerce app — uses a password**, with
  `Đăng nhập bằng SMS` as a separate link. So the house style is not "passwordless";
  it is "**the username is a phone number**", and the secret behind it varies by
  category: wallets and messengers go passwordless, commerce keeps the password.
  **[evidence]**
- **The West is not purely email either.** Apple's field is `Email or Phone Number`
  and Netflix's is `Email or mobile number`. The genuinely email-only screens in
  this sample (Notion, Linear, 1Password) are software products, not consumer
  services. **[evidence]**

**What that means for a product launching in Vietnam.**

The screen is not the problem; the account is. Warrly's login takes an email and
its password reset sends a link to that email
(`api/internal/email/`, `POST /api/v1/auth/forgot-password`). For a Vietnamese
user, the email address is the **weakest** credential they own — often a Gmail
created once for a phone, checked rarely, and in many cases the thing they have
already lost when they install the app on a new phone. The phone number is the one
identifier that is always current, and it is the one Warrly does not ask for.

Three consequences, in order of cost:

1. **Free, today, screen-level:** do not let `Email` read as "email is the whole
   account". If nothing else changes, the label and the keyboard are the only
   places the screen can be honest about what it wants.
2. **Cheap, shortly after:** collect a phone number at registration and use it for
   account recovery. That is an API + schema change (`User.phone`, a reset flow
   over SMS), not a design change, and it fixes the path that will fail first in
   this market.
3. **Expensive, later:** accept a phone number in the identifier field
   (`Email hoặc số điện thoại`). It requires `POST /api/v1/auth/login` to resolve
   either. It is exactly what Apple, Netflix and Shopee do, and it is the natural
   end state — but it should not be attempted in the same release as the redesign.

**The blunt version:** shipping an email-only login into Vietnam is not
*wrong*, it is *foreign*. Nothing about it will fail in a demo. What will happen is
that the users who lose access are the ones whose email was a throwaway, and the
recovery mail is the thing that breaks. The login screen can be rebuilt without
touching this; the product cannot launch without deciding it.

### 4.4 Does any successful app actually look like the flat-page Direction 1?

**Yes — one, exactly, and one more in skeleton. Neither centres a pictogram, and
neither uses a card.**

**The flat page is the norm, not the exception.** Seven of seven form screens put
the fields straight on the page. The claim in the brief that successful apps
"centre a logo and a card" is **false about the card**: not one of the seven wraps
its form in one. 1Password's card is a QR panel above the form and is the whole
exception. If Direction 1 ships as a flat page with two fields on it, it is
indistinguishable in structure from Netflix, Notion, Linear, Shopee and MoMo.

**Netflix is Direction 1 with a wordmark.** Flat near-black page, 32 pt
left-aligned title at the gutter, left-aligned supporting line, one field, one
full-width button, register path subordinate, footer links. Every compositional
decision in Direction 1 is present. **[evidence]**

**Apple's account sheet is the same skeleton at a smaller size**: left-aligned bold
title, small centred mark, one field, one action. **[evidence]**

**The one thing Direction 1 does that no app in the sample does: left-align a
pictogram at the top of a page.** Look at what the sample does with marks:

| mark | where | geometry |
|---|---|---|
| Notion N | top of page | centred, 36 pt |
| Linear sphere | top of page | centred, 36 pt |
| Shopee bag | top of page | centred, 44 pt |
| Apple dot-ring (web) | top of page | centred, ~300 px |
| Apple dot-ring (sheet) | top of sheet | centred, ~90 pt |
| 1Password keyhole | beside a two-column desktop form | left of the form column |
| Netflix `NETFLIX` | top of page | **left**, and a **wordmark** |

The rule the sample follows is: **a pictogram is centred; a wordmark goes top-left.**
Direction 1 puts a 28 pt *pictogram* top-left above a left-aligned title. That exact
combination appears nowhere in eleven screens. It is not obviously wrong — it is
consistent with the app's own left-aligned grammar, which is the argument the other
document makes — but it is a bet, not a convention, and it is the one place where a
reviewer with a phone in their hand might say the screen looks "off" without being
able to say why.

Two honest hedges:

- It is a *minority* position, not an unheard-of one. Netflix proves a left-aligned
  top-of-page brand mark works.
- The cheapest correction is one line: **centre the mark and keep the title left**,
  which is what Shopee does (centred logo, then left-aligned content below). That
  is the composition with the most precedent in the sample that still keeps the
  title at the gutter.

---

## 5. Three things to change in the Direction 1 build

All three are inside `LoginView.swift` plus, for the third, one string. None of them
reopens the direction, the palette, the type scale or the choice of two fields.

### Change 1 — centre the 28 pt mark; keep the title left-aligned

**What:** the mark gets its own centred line at the top; `Đăng nhập Warrly` stays at
the 16 pt gutter below it. Mark-to-title gap stays 32 pt. Nothing else moves.

**Why:** 5 of 5 single-column pictograms in the sample are centred, and the only
left-aligned logo is a wordmark. Direction 1 is the sole left-aligned pictogram.
This is the one place where the redesign is not "modern" but "unusual", and it is
the kind of unusual that reads as a mistake rather than a decision.

**Cost:** one line (`frame(maxWidth: .infinity)` on the mark, `.center` alignment).
**Risk:** low. If the owner prefers the mark hard-left because that is the app's
grammar, this is reversible in one line and the rest of the screen is unaffected.

### Change 2 — move the register line from the bottom edge to directly under the button

**What:** `Chưa có tài khoản? **Tạo tài khoản**` sits 24 pt under the coral button,
in the scroll content, left-aligned at the gutter. The flexible spacer and the
bottom pin go. The footer is no longer a footer.

**Why:** every screen in the sample that has a register path puts it next to the
primary action — Shopee directly under the button, Zalo under the card, Notion
under the providers, Netflix in the sub-headline. None pins it to the bottom of the
screen. In `d1-light.png` the pin leaves ~327 pt — 39 % of the screen — of empty
page between the button and the line, which is exactly the "unfinished" feeling the
other document already lists as risk (a).

**Cost:** delete the spacer, change one padding. **This change deletes work; it
does not add any.** **Risk:** none — and it makes the screen shorter, so the
keyboard-up case gets easier.

### Change 3 — give the title a string that isn't the button's

**What:** title `Đăng nhập Warrly` (EN: `Sign in to Warrly`); button stays
`Đăng nhập` / `Sign in`.

**Why:** 5 of 6 screens with both use distinct strings; 3 name the product. Today
the screen says the same two words twice, which is the Shopee pattern and the least
informative one in the sample. It also costs Direction 1 nothing visually: same
34 pt, same gutter, same line count.

**Cost:** **two new localization keys** — this is the one change that breaks the
other document's "no new string" promise, and the owner should know that before
agreeing. `Localizable.xcstrings` is `ios/Sources/WarrlyKit/`, and the Vietnamese
key must be added with its English value in the same commit (`CLAUDE.md`).
**Risk:** low, but it is the only change here that touches a file outside
`LoginView.swift`.

**Not proposed, deliberately:** adding a second sign-in method, adding a "what you
get" line back, changing the two-field form to email-first, and adding a language
picker on the screen. The first needs `api/`; the second contradicts a decision the
other document argues well; the third is a *web* pattern (Netflix, Apple, Notion,
1Password, Linear are all web screens — the one native app login with a password,
Shopee, puts both fields on one page) and would cost the returning user a tap; the
fourth is better solved by reading the device locale.

---

## 6. The one thing Direction 1 gets right that the others do not

**Labels above the fields.**

The other document argues this from Apple's HIG. The market evidence says it
independently, from the other direction: of the six field screens whose label state
I can actually read, **four put the label inside the field as a placeholder** —
Netflix (`Email or mobile number`), Shopee (`Email/Số điện thoại/Tên đăng nhập` and
`Mật khẩu`), MoMo (no label at all, only the `+84` chip), and Apple's web page
(`Email or Phone Number`). Only **1Password** (`Email` above the field, no
placeholder) and **Notion** (`Email` above, placeholder below) do what Direction 1
does. Once the user types one character, the other four stop saying what the field
wants. **[evidence]**

So Direction 1 is not following the market here; it is ahead of it. Two
consequences worth stating:

1. **Do not let a reviewer talk this out of the build on the grounds that "no one
   else does it."** They don't, and they are wrong. The `login-ax3.png` failure in
   the other document is what the placeholder pattern degenerates into at large text
   sizes.
2. **It is also the cheapest possible differentiation.** The screen can be as plain
   as Netflix's and still be more legible than every field screen in this sample,
   for the cost of two 13 pt labels that already exist.

And the second thing it gets right, which is smaller but worth recording: **the
coral budget.** No app in the sample uses its brand colour for both the action and
the secondary links — Apple's web page keeps the passkey button black while
`Continue` is blue-tinted; Notion's links are grey; Netflix's links are white/grey;
Shopee's `Đăng ký` and `Đăng nhập bằng SMS` are the same blue as nothing else on the
screen. Direction 1's rule that `Quên mật khẩu?` and `Tạo tài khoản` get weight, not
colour, while coral belongs to one button, is the same discipline the whole sample
follows. **Cutting coral text from the login screen is not a loss of emphasis; it is
what every screen here already does.** **[evidence for the sample; taste for the
rule]**

---

## 7. Files

Screenshots used, all in `docs/handoff/login-research/shots/`:

| file | what it is | source |
|---|---|---|
| `apple-01-settings-apple-account-ios26.png` | Settings, not signed in, iOS 26 | Apple Support CDN — `cdsassets.apple.com/live/7WUAS350/images/apple-account/ios-26-iphone-17-pro-settings-apple-account-sign-in.png` (via support.apple.com/en-us/111001) |
| `apple-02-account-sheet-forgot-password-ios26.png` | Apple Account sheet, iOS 26 | Apple Support CDN — `…/ios-26-iphone-17-pro-forgot-password-account-locked.png` (via support.apple.com/en-us/102640) |
| `apple-03-web-signin-desktop.png` | `account.apple.com/sign-in` | live capture 2026-10-31, headless Chrome 1280×1000 @2× |
| `1password-01-web-signin.png` | `my.1password.com/signin` | live capture 2026-10-31, 1280×1000 @2× |
| `momo-01-app-login-phone.jpg` | MoMo app login (phone → `Tiếp tục`) | fingo.vn article screenshot, 2023; carries the site's watermark |
| `shopee-vn-01-app-login-helpcentre.jpg` | Shopee VN app login, three states | Shopee's own help centre — help.shopee.vn/portal/4/article/79623 |
| `zalo-01-web-login-qr.png` | Zalo web login, QR only | dienthoaivui.com.vn article screenshot, 2023 |
| `netflix-01-web-login.png` | `netflix.com/login` | live capture 2026-10-31, 430×932 @2× |
| `notion-01-web-login.png` | `notion.so/login` | live capture 2026-10-31, 430×932 @2× |
| `linear-01-web-login.png` | `linear.app/login` | live capture 2026-10-31, 430×932 @2× |
| `appstore-01-lead-shots-utilities.jpg` | Things 3, Bear, Streaks, Paprika 3, Flighty — lead App Store shot each | iTunes lookup API, 2026-10-31 |
| `appstore-02-lead-shots-vn-banks.jpg` | Techcombank, MB, VCB, VPBank, TPBank, BIDV, Zalopay, VNPAY — lead shot each | iTunes lookup API, 2026-10-31 — **evidence of the negative result**, not of any login screen |
| `playstore-01-zalo-contact-sheet.jpg`, `playstore-02-momo-contact-sheet.jpg` | Zalo / MoMo Play Store screenshot sets | play.google.com, `hl=vi&gl=VN`, 2026-10-31 — same negative result |

Live captures were made with headless Chrome at
`--window-size=430,932 --force-device-scale-factor=2` (mobile-width) or
`1280,1000` (desktop pages, where a 430 pt viewport crops the layout), which is why
the Apple and 1Password pages are archived at desktop width. The 430 pt captures of
Netflix, Notion and Linear are shown at phone width on purpose — they are being
compared to a 390 pt phone screen.

Sources:

- Apple Support, *Sign in to your Apple Account* — <https://support.apple.com/en-us/111001>
- Apple Support, *If you forgot your Apple Account password* — <https://support.apple.com/en-us/102640>
- Apple Account web sign-in — <https://account.apple.com/sign-in>
- 1Password web sign-in — <https://my.1password.com/signin>
- Netflix — <https://www.netflix.com/login>
- Notion — <https://www.notion.so/login>
- Linear — <https://linear.app/login>
- Shopee VN help centre, *Cách Đăng Nhập Tài Khoản Shopee* — <https://help.shopee.vn/portal/4/article/79623>
- MoMo login steps (screenshot source) — <https://fingo.vn/cach-dang-nhap-momo-khong-can-ma-xac-nhan>
- Zalo Web login (screenshot source) — <https://dienthoaivui.com.vn/cach-dang-nhap-zalo-website-tren-pc-dien-thoai-online/>

In this repository:

- `docs/handoff/WARRLY-login-redesign.md` — Direction 1, the design under test
- `docs/handoff/login-redesign/d1-light.png`, `d1-dark.png` — the rendered baseline
- `ios/App/Features/Auth/LoginView.swift` — the file under rebuild (not read for
  this note beyond the other document's measurements)
