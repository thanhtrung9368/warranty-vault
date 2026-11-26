# Warrly UI tests (XCUITest)

Black-box UI tests: they launch the **real app**, point it at a small mock API
that runs inside the test runner, and drive the UI. No backend, no database and
no production account is involved. The same bundle runs on an iOS Simulator and
on a physical iPhone.

```
ios/UITests/
├── MockAPIServer.swift       # NWListener HTTP/1.1 server on 127.0.0.1 + fixtures
├── UITestHelpers.swift       # shared base class: launch, sidebar-aware nav, bounded scrolls
├── WarrlySmokeTests.swift    # login → dashboard smoke test (attaches screenshot)
├── LoginScreenTests.swift    # a11y identifiers, empty/partial validation, mock login
├── DashboardSmokeTests.swift # deadline fixture rendered, no empty/error fallback
├── DevicePriceTests.swift    # listed vs charged vs reference rate, locked rate
├── AISettingsTests.swift     # consent layout split, opt-in toggle
├── PaywallTests.swift        # exactly one purchase CTA, trial terms only when eligible
├── DynamicTypeSmokeTests.swift # AX3 layout on Settings and device detail
└── README.md
```

The target is declared in `ios/project.yml` (`WarrlyUITests`, type
`bundle.ui-testing`, `TEST_TARGET_NAME: Warrly`) and is part of the `Warrly`
scheme's **test** action. `xcodegen generate` writes it into
`Warrly.xcodeproj`; the generated project is committed, like the app target.

## Launch contract

| Launch argument / environment | Meaning |
|---|---|
| `-ui-testing` | Required. Enables the test-only base URL path and resets persisted state at launch: Keychain token, remembered email, saved language, app-lock switch and ads consent. Also suppresses the UMP/ATT/ad-SDK sequence. |
| `WV_API_BASE_URL=http://localhost:<port>` | Test-only API base (read only with `-ui-testing`). The mock server's ephemeral port is on `MockAPIServer.baseURL`. `WV_BASE_URL` (the normal Debug/QA override) also works. |
| `WV_QA_TOKEN=<token>` | **DEBUG-only** existing QA hook: authenticates without the login form. Used by authenticated scenarios. The mock answers `GET /api/v1/auth/me` for any bearer. |
| `-AppleLanguages (vi)` / `-AppleLocale vi_VN` | Pins Vietnamese copy, so assertions are not machine-language dependent. |

The URL host must be `localhost`, not `127.0.0.1`: the app's ATS exception is
keyed by the hostname, and the production ATS configuration is deliberately not
widened for tests. The listener itself binds `127.0.0.1` only.

## Running

Simulator (build once, then run):

```bash
cd ios
xcodebuild build-for-testing \
  -project Warrly.xcodeproj -scheme Warrly \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/wv-uitest-dd \
  CODE_SIGNING_ALLOWED=NO

xcodebuild test-without-building \
  -project Warrly.xcodeproj -scheme Warrly \
  -destination 'platform=iOS Simulator,id=<SIMULATOR_UDID>' \
  -derivedDataPath /tmp/wv-uitest-dd \
  -only-testing:WarrlyUITests/WarrlySmokeTests \
  CODE_SIGNING_ALLOWED=NO
```

Drop `-only-testing:` to run all 14 tests (~15 min, the AX3 suites dominate), or
repeat it for each suite: `LoginScreenTests`, `DashboardSmokeTests`,
`DevicePriceTests`, `AISettingsTests`, `PaywallTests`, `DynamicTypeSmokeTests`.

Physical iPhone (signing is required; the target uses the app's team):

```bash
cd ios
xcodebuild test \
  -project Warrly.xcodeproj -scheme Warrly \
  -destination 'platform=iOS,id=<PHONE_UDID>' \
  -only-testing:WarrlyUITests/WarrlySmokeTests \
  -allowProvisioningUpdates
```

On a real iPhone the test bundle and the app both need the team's signing, which
is why the command above omits `CODE_SIGNING_ALLOWED=NO`.

`xcrun devicectl list devices` / Xcode's Devices window shows the UDID. The
runner app and the app under test are separate processes on the same device;
both talk over that device's loopback interface, so no Mac, no Duo and no LAN
access is needed. The phone only has to be unlocked and trusted by the Mac.

## Mock API coverage

Deterministic JSON matching `openapi.yaml`:

- `POST /api/v1/auth/login` — accepts `qa@warrly.test` + any non-empty password
- `GET /api/v1/auth/me`
- `GET /api/v1/devices`, `GET /api/v1/devices/{id}`
- `GET /api/v1/stats`
- `GET /api/v1/reminders`
- `GET /api/v1/subscriptions`
- `GET /api/v1/wishlist`
- `GET /api/v1/staples`
- `GET /api/v1/fx/rates?base=USD`
- `GET /api/v1/catalog`, `GET /api/v1/actions`, `GET /api/v1/inbox`,
  `GET /api/v1/push`, `GET /api/v1/ai/opt-in`
- `POST /api/v1/push/register`, `POST /api/v1/auth/logout`

Anything else answers `404` with the standard `{error, message}` envelope. The
fixtures are in `UITestFixtures`; the one device is `MacBook Pro QA` (USD, price
999, locked rate 26130) and the market FX table returns 26500 so the reference
rate can be distinguished from the locked one.

`MockAPIServer(scenario:)` switches the `/auth/me` Premium bit and is available
for scenario-specific fixtures. The paywall's StoreKit products and intro-offer
eligibility do **not** come from HTTP, so a test that needs a real purchase CTA
still needs a StoreKit configuration or an app-side fixture hook — neither is
part of this infrastructure yet.
