# pdfpack — the insurance-pack document builder

`pdfpack` turns the data the service resolved into the PDF returned by
`GET /api/v1/insurance-pack`. It owns layout, pagination, the Vietnamese copy,
the image budget and the manifest. It does NOT touch the database, decrypt files
or know about HTTP.

## Library choice

**`github.com/signintech/gopdf` v0.38.2 — MIT.** It is a pure-Go PDF writer with
TrueType embedding/subsetting, explicit page handling and image embedding. The
builder measures every string (`SplitTextWithWordWrap` + `MeasureTextWidth`)
before drawing it, which is what makes overflow a layout decision instead of a
corrupt document.

Alternatives considered:

* **`github.com/go-pdf/fpdf`** (MIT, maintained fork of `jung-kurt/gofpdf`) — a
  strong table API, but its UTF-8 subsetting writes a single identity
  `/ToUnicode` range (`<0000> <FFFF> <0000>`). That is valid PDF, but the common
  Go text extractors used to verify output decode the range one byte at a time
  and turn `ệ` into `£`, so this repo could not assert the Vietnamese text layer
  in a Go test without a bespoke extractor.
* **`github.com/jung-kurt/gofpdf`** — archived; avoided for a new dependency.
* **`github.com/johnfercher/maroto`** — a higher-level layout library built on
  gofpdf; its template model hides the explicit page breaks this document needs.
* **`github.com/pdfcpu/pdfcpu`** — excellent for manipulating existing PDFs, not
  a document-generation API.
* **`github.com/unidoc/unipdf`** — commercial licence; not suitable here.

`gopdf` pulls `github.com/phpdave11/gofpdi` (MIT) for PDF import support, which
this package does not use; it is a transitive cost of the module.

The tests use **`github.com/ledongthuc/pdf`** (BSD-3-Clause, a fork of
`rsc.io/pdf`) only to read the text layer back out. It writes one `bfrange` per
glyph, which the extractor decodes correctly. `pdftext/` exists for tests; the
server never imports it.

## Font

**Noto Sans Regular + Bold**, vendored under `fonts/` with the full
**SIL Open Font License 1.1** text (`fonts/OFL.txt`) and source notes
(`fonts/README.md`). Noto Sans covers every Vietnamese precomposed character
(`ệ`, `đ`, `ộ`, `ữ`, `ỹ`, …). The PDF built-in Helvetica/Times are WinAnsi and
cannot represent them at all, which is the reason this directory exists. gopdf
embeds only the glyphs actually used by a document.

## Image budget

| Limit | Value | Why |
|---|---|---|
| Images per device | **2** | The write path allows five attachments per device. Two is the legible proof set (typically receipt + product/box); the rest stay in the manifest with a reason. |
| Images per document | **100** | 2 × 50 active devices, the per-account active ceiling. `includeSold=true` can address 500 devices; past this budget those images are listed, not embedded, so one request stays bounded. |
| Longest side | **1200 px** | The upload pipeline already caps at 1600 px. 1200 px is ~150 dpi at the 120 mm print width and keeps a 100-image document in the low tens of MB. Every image is re-encoded to JPEG (quality 82, quality 65 if the result is > 1.5 MB) on a white background so PNG transparency does not print black. |
| Decoded pixels | **24 MP** | Checked with `image.DecodeConfig` before the full decode, so a 5 MB PNG describing a gigapixel canvas is rejected as unreadable instead of exhausting memory. |

HEIC and PDF can never be embedded: HEIC has no pure-Go decoder (the upload path
does not resize it either) and a PDF is not an image. Both are written to the
manifest with an explicit note. A missing blob, a decrypt failure or an
undecodable image gets `UNREADABLE` in the manifest; none of them fail the
document.

## Language

The document is **always Vietnamese**, even when the request carries `?lang=en`:
an adjuster did not choose a language in Warrly. The strings therefore live in
`vietnamese.go`, not in `internal/i18n/catalog.go`. See the package comment in
`document.go`.
