# Wide-window proxy (not the Duo inner panel)

These two shots are **not** iPhone Duo screenshots. They are the same build
running on an iPad (A16, iOS 27.0, window 820 pt wide) purely as a proxy that
can render the `.regular`/`.wide` branch of
`App/DesignSystem/AdaptiveLayout.swift` — the branch the Duo's 669 pt inner
panel would take. The Duo's inner panel cannot be driven on this toolchain; see
`../README.md`.

What they demonstrate:

* `wide-overview-820pt.png` — the single reading column stops at
  `WVLayout.readableMaxWidth` (620 pt) and is centred in the 820 pt window, so
  rows do not stretch across the display. The `sidebarAdaptable` shell is
  phone-only, so on iPad this stays the ordinary five-item tab bar.
* `wide-devices-820pt.png` — same cap on a pushed list screen; seven device
  rows, no clipped titles, no value truncation. Taken from the earlier build of
  this branch, before the shell was made phone-only; the row layout is what it
  demonstrates and that did not change.

Known caveat: on iPad the New-device form (`WV_QA_NEW_DEVICE=1`) never leaves
its spinner at any window width — reproduced with and without the shell change,
so it predates this slice and is out of scope here.
