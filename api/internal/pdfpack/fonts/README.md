# Noto Sans (subset)

`NotoSans-Regular.ttf` and `NotoSans-Bold.ttf` are the hinted static builds of
**Noto Sans** from the Noto project:

- upstream: <https://github.com/notofonts/notofonts.github.io/tree/main/fonts/NotoSans/hinted/ttf>
- copyright: Copyright 2022 The Noto Project Authors
- licence: **SIL Open Font License, Version 1.1** — the full text is in
  [`OFL.txt`](./OFL.txt)

The fonts are vendored (not downloaded at runtime) because the insurance pack is
a document that must render identically years later, on a server with no fonts
installed. Noto Sans was chosen because it covers every Vietnamese precomposed
character (`ệ`, `đ`, `ộ`, `ữ`, `ỹ`, …) and is permissively licensed. The PDF
builder embeds a subset of the glyphs actually used, so the two files do not
inflate every generated document by their full size.

Why not the PDF built-in Helvetica/Times: those use WinAnsi encoding, which has
no Vietnamese characters. `ệ` is not representable and comes out as `?` (or a
different character) in the produced document, which is exactly the failure this
directory exists to prevent.
