package pdfpack

import (
	_ "embed"
	"fmt"

	"github.com/signintech/gopdf"
)

// The fonts are vendored, not read from the host. See fonts/README.md for the
// upstream URL, the copyright line and the SIL OFL 1.1 licence text (OFL.txt).
//
//go:embed fonts/NotoSans-Regular.ttf
var notoSansRegular []byte

//go:embed fonts/NotoSans-Bold.ttf
var notoSansBold []byte

const (
	fontFamily = "notosans"
	fontNormal = ""
	fontBold   = "B"
)

// addFonts embeds both styles into the document. Styles are registered by the
// style string gopdf uses ("B" for bold), so SetFont(fontFamily, fontBold, size)
// works everywhere below.
func addFonts(pdf *gopdf.GoPdf) error {
	if err := pdf.AddTTFFontData(fontFamily, notoSansRegular); err != nil {
		return fmt.Errorf("embed regular font: %w", err)
	}
	if err := pdf.AddTTFFontDataWithOption(fontFamily, notoSansBold, gopdf.TtfOption{
		Style:                     gopdf.Bold,
		OnGlyphNotFoundSubstitute: gopdf.DefaultOnGlyphNotFoundSubstitute,
	}); err != nil {
		return fmt.Errorf("embed bold font: %w", err)
	}
	return nil
}
