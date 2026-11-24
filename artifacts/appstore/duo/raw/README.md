# iPhone Duo — raw capture notes

Raw, unedited simulator screenshots for the Duo layout slice (branch
`feat/duo-layout`, based on `6de7c10`). Nothing here is an App Store
screenshot yet: no crop, no scale, no frame, no localisation pass.

## Device

`iPhone Duo` (UDID `4E0075B4-50C7-4071-B743-FB663C844E36`), iOS 27.1
(24A94232), Xcode 27.2 (27B52). The device type is
`com.apple.CoreSimulator.SimDeviceType.iPhone-Duo` (`iPhone19,4`, product class
`V68`). It exposes **two panels**:

| panel | `simctl io` display | pixels | points | role |
|---|---|---|---|---|
| outer (folded) | `--display=1` | 1398×2034 | 466×678 @3x | cover display |
| inner (unfolded) | `--display=3` | 2007×2853 | 669×951 @3x | main display |

Measured from inside the app on the **outer** panel:

```
UIScreen.main.bounds = 466×678, scale 3
app window content   = 382×644      (safeAreaInsets: top 0, left 0,
                                     bottom 34, right 84)
horizontalSizeClass  = compact, verticalSizeClass = regular, idiom = phone
UIScreen.screens.count = 1
```

The 84 pt right inset is the camera/hinge strip the system keeps clear on the
cover panel; the tab bar and the navigation-bar glyphs are drawn inside it.
Content is laid out in the remaining 382 pt, which is narrower than an iPhone
SE 3 (375 pt) only by 7 pt — hence the compact-tier rules in
`App/DesignSystem/AdaptiveLayout.swift`.

## What could not be captured, and why

**There are no inner-display screenshots.** The inner panel renders nothing at
all in this toolchain: it is powered (`simctl io … enumerate` reports
`Power state: On`) but its framebuffer is uniformly black, including for
SpringBoard itself. The evidence is `inner-display-framebuffer-empty.png`
(2007×2853, all-black).

Checked, in order:

* `xcrun simctl io <udid> screenshot --display=3` → black, before and after
  launching the app (`UIScreen.screens.count == 1` inside the app, so no app
  can draw there).
* `xcrun simctl io <udid> screenConfig --display=3 power on|off` → no change.
* `xcrun simctl io <udid> screenConfig --display=1 geometry 2007x2853` →
  `No mode found that supports size 2007x2853`; only 1398×2034 is a valid mode.
* Folding is a host-GUI action on this device type, and no host GUI is
  installed: `Simulator.app` is absent from Xcode 27.2 (`DeviceHub.app` is a
  device manager), and neither CoreSimulator, DeviceKit, SimulatorKit nor
  `simctl` contains any fold/unfold/posture control.
* HID injection (`idb_companion` 1.1.8) loads SimulatorKit for gestures but
  does not route touch to the active panel of this two-display device; taps
  produced `hid succeeded` and no UI change on the outer panel either. It was
  used for nothing here and removed.

So every screenshot below is the **outer** panel. For the regular-width
(inner-like) layout, `proxy-wide-ipad/` shows the same code path rendered on
an iPad window (820 pt, `.regular` tier) — see its own note.

## Files

Captured from the final build (`xcodebuild build … -destination "platform=iOS
Simulator,id=4E0075B4-…"`, Debug, `CODE_SIGNING_ALLOWED=NO`), installed with
`xcrun simctl install`, launched with a DEBUG-only QA token
(`SIMCTL_CHILD_WV_QA_TOKEN=<token>`, `WV_QA_NO_ADS=1`, `WV_QA_TAB=<0–4>`) against
a throwaway Go API + Postgres database (`wv_duo_qa`) seeded with 7 devices, 4
subscriptions, 3 wishlist items and 4 essentials. No account data belongs to a
real user.

| file | screen | how it was opened |
|---|---|---|
| `outer-00-overview-before-row-fix.png` | Overview, **before** this slice (`6de7c10` build) | `WV_QA_TAB=0`; kept only to show the truncated `còn 26…` deadline |
| `outer-01-overview.png` | Overview | `WV_QA_TAB=0` |
| `outer-02-devices.png` | Devices | `WV_QA_TAB=1` |
| `outer-03-device-detail.png` | Device detail | `WV_QA_TAB=1`, `WV_QA_DEVICE_ID` |
| `outer-04-subscriptions.png` | Subscriptions | `WV_QA_TAB=2` |
| `outer-05-subscription-detail.png` | Subscription detail | `WV_QA_TAB=2`, `WV_QA_SUBSCRIPTION_ID` |
| `outer-06-wishlist.png` | Wishlist (incl. the Essentials door) | `WV_QA_TAB=3` |
| `outer-07-more.png` | More | `WV_QA_TAB=4` |
| `outer-08-device-form.png` | New device form | `WV_QA_TAB=1`, `WV_QA_NEW_DEVICE=1` |
| `outer-09-subscription-form.png` | New subscription form | `WV_QA_TAB=2`, `WV_QA_NEW_SUBSCRIPTION=1` |
| `outer-10-subscription-audit.png` | Subscription audit | `WV_QA_TAB=2`, `WV_QA_SUBSCRIPTION_AUDIT=1` |
| `outer-11-login.png` | Login (signed out) | no `WV_QA_TOKEN` |

## Not captured at all

These have no debug launch hook and the simulator cannot be tapped, so they
were **not** photographed: Settings, Essentials (`StaplesView`) and its price
history sheet, the inbox, reminders, the action queue, claims, and every sheet
presented from a row. Their layout was reviewed in code only — they all sit on
`wvScreen()`, which is where the width cap and the bottom inset are applied,
so they inherit the same compact/regular behaviour.
