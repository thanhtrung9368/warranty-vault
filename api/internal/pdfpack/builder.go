package pdfpack

import (
	"fmt"
	"strings"
	"time"

	"github.com/signintech/gopdf"
)

// Page geometry (millimetres). A4 landscape is the natural shape for an
// insurance schedule: ten columns fit without shrinking the text to unreadable
// sizes, and the same page can show a receipt image next to the device facts.
const (
	pageWidth    = 297.0
	pageHeight   = 210.0
	marginX      = 14.0
	contentWidth = pageWidth - 2*marginX // 269
	topY         = 16.0
	bottomY      = 190.0
	footerLineY  = 196.0
	footerTextY  = 197.0
)

const (
	bodySize       = 9.0
	bodyLineHeight = 4.0
	smallSize      = 8.0
	smallLine      = 3.6
	tableSize      = 7.2
	tableLine      = 3.1
	tablePadX      = 1.2
	tablePadY      = 1.0
)

type rgb struct{ r, g, b uint8 }

var (
	colorInk      = rgb{30, 41, 59}
	colorMuted    = rgb{100, 116, 139}
	colorAccent   = rgb{30, 64, 120}
	colorLine     = rgb{203, 213, 225}
	colorHeader   = rgb{226, 232, 240}
	colorAlt      = rgb{248, 250, 252}
	colorWhite    = rgb{255, 255, 255}
	colorSoftBlue = rgb{239, 246, 255}
)

type builder struct {
	pdf     *gopdf.GoPdf
	doc     Document
	y       float64
	section string
	err     error
}

// Build renders doc as a complete PDF. It never panics on user input: all text
// is sanitised, measured and wrapped, and an unreasonably long string is
// truncated with a visible ellipsis instead of being allowed to run off a page.
func Build(doc Document) ([]byte, error) {
	if doc.GeneratedAt.IsZero() {
		doc.GeneratedAt = time.Now()
	}
	pdf := &gopdf.GoPdf{}
	pdf.Start(gopdf.Config{
		Unit:     gopdf.UnitMM,
		PageSize: gopdf.Rect{W: pageWidth, H: pageHeight},
	})
	pdf.SetMargins(marginX, topY, marginX, pageHeight-bottomY)
	pdf.SetInfo(gopdf.PdfInfo{
		Title:        docTitle,
		Author:       "Warrly",
		Subject:      docSubtitle,
		Creator:      "Warrly",
		Producer:     "Warrly",
		CreationDate: doc.GeneratedAt,
	})

	b := &builder{pdf: pdf, doc: doc}
	if err := addFonts(pdf); err != nil {
		return nil, err
	}

	pdf.AddPage()
	b.y = topY
	b.drawCover()

	if len(doc.Devices) == 0 {
		b.drawEmpty()
	} else {
		b.newPage()
		b.drawSchedule()
		for i := range doc.Devices {
			b.newPage()
			b.drawDevice(i)
		}
		b.newPage()
		b.drawManifest()
	}
	if b.err != nil {
		return nil, b.err
	}
	b.drawFooters()
	if b.err != nil {
		return nil, b.err
	}

	raw, err := pdf.GetBytesPdfReturnErr()
	if err != nil {
		return nil, fmt.Errorf("compile pdf: %w", err)
	}
	return raw, nil
}

// ---- primitives ------------------------------------------------------------

func (b *builder) fail(err error) {
	if b.err == nil && err != nil {
		b.err = err
	}
}

func (b *builder) setFont(bold bool, size float64) {
	if b.err != nil {
		return
	}
	style := fontNormal
	if bold {
		style = fontBold
	}
	b.fail(b.pdf.SetFont(fontFamily, style, size))
}

func (b *builder) textColor(c rgb) {
	if b.err != nil {
		return
	}
	b.pdf.SetTextColor(c.r, c.g, c.b)
}

func (b *builder) fillColor(c rgb) {
	if b.err != nil {
		return
	}
	b.pdf.SetFillColor(c.r, c.g, c.b)
}

func (b *builder) strokeColor(c rgb) {
	if b.err != nil {
		return
	}
	b.pdf.SetStrokeColor(c.r, c.g, c.b)
}

// drawText draws one already-wrapped line. Callers that pass user text must use
// lines() first; this function does not wrap.
func (b *builder) drawText(text string, x, y, w, h float64, bold bool, size float64, align int, c rgb) {
	if b.err != nil || text == "" {
		return
	}
	b.setFont(bold, size)
	b.textColor(c)
	b.pdf.SetXY(x, y)
	b.fail(b.pdf.CellWithOption(&gopdf.Rect{W: w, H: h}, text, gopdf.CellOption{
		Align: align | gopdf.Top,
		Float: gopdf.Right,
	}))
}

func (b *builder) rect(x, y, w, h float64, fill *rgb, stroke *rgb) {
	if b.err != nil {
		return
	}
	b.pdf.SetLineWidth(0.2)
	if fill != nil {
		b.fillColor(*fill)
	}
	if stroke != nil {
		b.strokeColor(*stroke)
	}
	switch {
	case fill != nil && stroke != nil:
		b.pdf.RectFromUpperLeftWithStyle(x, y, w, h, "FD")
	case fill != nil:
		b.pdf.RectFromUpperLeftWithStyle(x, y, w, h, "F")
	case stroke != nil:
		b.pdf.RectFromUpperLeftWithStyle(x, y, w, h, "D")
	}
}

func (b *builder) line(x1, y1, x2, y2 float64, c rgb) {
	if b.err != nil {
		return
	}
	b.strokeColor(c)
	b.pdf.SetLineWidth(0.2)
	b.pdf.Line(x1, y1, x2, y2)
}

// newPage starts a page that will carry its own section heading. It does not
// draw a continuation line; the section heading itself is the first thing drawn.
func (b *builder) newPage() {
	if b.err != nil {
		return
	}
	b.pdf.AddPage()
	b.y = topY
}

// addPage starts a page in the middle of a section and labels it as a
// continuation so a reader who prints the document knows nothing was lost.
func (b *builder) addPage() {
	b.newPage()
	if b.section == "" {
		return
	}
	b.textColor(colorMuted)
	b.setFont(false, smallSize)
	b.drawText(strings.TrimSpace(b.section+" · "+continueLabel), marginX, topY, contentWidth, smallLine, false, smallSize, gopdf.Right, colorMuted)
	b.line(marginX, topY+smallLine+0.6, pageWidth-marginX, topY+smallLine+0.6, colorLine)
	b.y = topY + smallLine + 2.2
}

func (b *builder) ensureSpace(h float64) {
	if b.err != nil {
		return
	}
	if b.y+h > bottomY {
		b.addPage()
	}
}

// lines wraps sanitised text at the current font. It never returns nil for
// non-empty input; a pathological run of whitespace becomes one empty line.
func (b *builder) lines(text string, width float64) []string {
	text = sanitizeText(text)
	if text == "" {
		return []string{""}
	}
	wrapped, err := b.pdf.SplitTextWithWordWrap(text, width)
	if err != nil {
		// ErrEmptyString for whitespace-only input is not an error to surface;
		// everything else is a font/measurement failure worth reporting.
		if text == "" || strings.TrimSpace(text) == "" {
			return []string{""}
		}
		b.fail(fmt.Errorf("wrap text: %w", err))
		return []string{text}
	}
	if len(wrapped) == 0 {
		return []string{""}
	}
	return wrapped
}

// clipLines keeps at most max lines and makes the loss visible. Removing the
// last characters from the final kept line is what turns "the rest is on another
// page" into an honest "there was more here" when there is no other page (table
// cells, where the detail page carries the full value).
func (b *builder) clipLines(lines []string, maxLines int, width float64) []string {
	if maxLines <= 0 || len(lines) <= maxLines {
		return lines
	}
	out := append([]string(nil), lines[:maxLines]...)
	out[maxLines-1] = b.ellipsize(out[maxLines-1], width)
	return out
}

func (b *builder) ellipsize(line string, width float64) string {
	runes := []rune(strings.TrimRight(line, " "))
	if len(runes) == 0 {
		return "…"
	}
	for len(runes) > 0 {
		candidate := strings.TrimRight(string(runes), " ") + "…"
		w, err := b.pdf.MeasureTextWidth(candidate)
		if err != nil {
			b.fail(fmt.Errorf("measure truncated text: %w", err))
			return candidate
		}
		if w <= width {
			return candidate
		}
		runes = runes[:len(runes)-1]
	}
	return "…"
}

// ---- cover -----------------------------------------------------------------

func (b *builder) drawCover() {
	b.rect(0, 0, pageWidth, 44, &colorAccent, nil)
	b.drawText(docTitle, marginX, 9, contentWidth, 14, true, 23, gopdf.Left, colorWhite)
	b.drawText(docSubtitle, marginX, 26, contentWidth, 8, false, 10.5, gopdf.Left, colorWhite)

	b.y = 56
	b.coverField(docOwner, valueOr(b.doc.Account.DisplayName, notRecorded), true, 13, 9, 2)
	b.coverField(docEmail, valueOr(b.doc.Account.Email, notRecorded), false, 10, 7, 1)
	generated := fmt.Sprintf("%s (%s)", formatDateTime(b.doc.GeneratedAt), docTimezone)
	b.coverField(docGeneratedAt, generated, false, 10, 9, 1)

	b.line(marginX, b.y, pageWidth-marginX, b.y, colorLine)
	b.y += 5

	b.drawParagraph(docProvenance, false, bodySize, colorInk, 0)
	b.y += 2
	b.drawParagraph(docDisclaimer, false, smallSize, colorMuted, 0)
	b.y += 6

	stats := b.summary()
	if len(b.doc.Devices) > 0 {
		boxH := 12.0 + float64(len(stats))*5
		b.rect(marginX, b.y, contentWidth, boxH, &colorSoftBlue, &colorLine)
		b.y += 4
		for _, line := range stats {
			b.drawText(line, marginX+4, b.y, contentWidth-8, 5, false, 9.2, gopdf.Left, colorInk)
			b.y += 5
		}
		b.y += 4
	}
}

type coverStats struct {
	devices      int
	sold         int
	attachments  int
	embedded     int
	notEmbedded  int
	totalVND     int64
	unknownVND   int
	soldTotalVND int64
	soldWithVND  int
}

func (b *builder) summary() []string {
	s := b.stats()
	lines := []string{fmt.Sprintf("Số thiết bị: %d", s.devices)}
	if b.doc.IncludeSold && s.sold > 0 {
		lines[0] = fmt.Sprintf("Số thiết bị: %d (trong đó %d đã bán)", s.devices, s.sold)
	}
	lines = append(lines, "Tổng giá mua đã quy đổi: "+formatVNDAmount(s.totalVND))
	if s.unknownVND > 0 {
		lines = append(lines, fmt.Sprintf("%d thiết bị không có giá trị VND xác định nên không được cộng vào tổng.", s.unknownVND))
	}
	if s.soldWithVND > 0 {
		lines = append(lines, "Tổng giá bán đã ghi: "+formatVNDAmount(s.soldTotalVND))
	}
	lines = append(lines, fmt.Sprintf("Tệp đính kèm: %d · Ảnh nhúng: %d · Chỉ liệt kê: %d", s.attachments, s.embedded, s.notEmbedded))
	if !b.doc.IncludeSold {
		lines = append(lines, "Không bao gồm thiết bị đã bán.")
	}
	return lines
}

func (b *builder) stats() coverStats {
	var s coverStats
	s.devices = len(b.doc.Devices)
	for _, d := range b.doc.Devices {
		if d.Status == "SOLD" {
			s.sold++
			if d.SoldPriceVND != nil {
				s.soldTotalVND += *d.SoldPriceVND
				s.soldWithVND++
			}
		}
		if d.PurchasePriceVND != nil {
			s.totalVND += *d.PurchasePriceVND
		} else {
			s.unknownVND++
		}
		s.attachments += len(d.Attachments)
	}
	for _, d := range b.doc.Devices {
		for _, a := range d.Attachments {
			if a.Status == ManifestEmbedded {
				s.embedded++
			} else {
				s.notEmbedded++
			}
		}
	}
	return s
}

// coverField draws a label/value pair where the value may wrap (a display name
// is user input and can be 80 characters). It advances b.y past the taller of the
// wrapped value and the requested minimum row height.
func (b *builder) coverField(label, value string, bold bool, size, minH float64, maxLines int) {
	start := b.y
	b.drawText(label, marginX, start, 40, 5, true, 8.4, gopdf.Left, colorMuted)
	b.drawParagraphAt(value, marginX+40, start, contentWidth-40, bold, size, colorInk, maxLines)
	if b.y < start+minH {
		b.y = start + minH
	}
}

func (b *builder) drawEmpty() {
	b.ensureSpace(50)
	y := b.y + 6
	b.rect(marginX, y, contentWidth, 42, &colorSoftBlue, &colorLine)
	b.drawText(emptyTitle, marginX+8, y+8, contentWidth-16, 9, true, 14, gopdf.Left, colorAccent)
	b.drawParagraphAt(emptyBody, marginX+8, y+20, contentWidth-16, false, 9.2, colorInk, 3)
}

// ---- schedule --------------------------------------------------------------

type tableColumn struct {
	header string
	width  float64
	align  int
}

type tableSpec struct {
	columns  []tableColumn
	rows     [][]string
	totals   []string
	maxLines int
	size     float64
}

func (b *builder) drawSchedule() {
	b.section = sectionSchedule
	b.drawSectionHeading("1", sectionSchedule)
	b.drawParagraph(scheduleIntro, false, smallSize, colorMuted, 0)
	b.y += 2

	cols := []tableColumn{
		{header: scheduleHeaders[0], width: 8, align: gopdf.Center},
		{header: scheduleHeaders[1], width: 44, align: gopdf.Left},
		{header: scheduleHeaders[2], width: 22, align: gopdf.Left},
		{header: scheduleHeaders[3], width: 27, align: gopdf.Left},
		{header: scheduleHeaders[4], width: 31, align: gopdf.Left},
		{header: scheduleHeaders[5], width: 21, align: gopdf.Left},
		{header: scheduleHeaders[6], width: 27, align: gopdf.Right},
		{header: scheduleHeaders[7], width: 28, align: gopdf.Right},
		{header: scheduleHeaders[8], width: 22, align: gopdf.Left},
		{header: scheduleHeaders[9], width: 39, align: gopdf.Left},
	}

	rows := make([][]string, 0, len(b.doc.Devices))
	for i, d := range b.doc.Devices {
		status := deviceStatusLabel(d.Status)
		if d.Status == "SOLD" {
			status = b.soldSummary(d)
		}
		rows = append(rows, []string{
			fmt.Sprintf("%d", i+1),
			valueOr(d.Name, notRecorded),
			dash(d.Brand),
			dash(d.Model),
			dash(d.SerialNumber),
			formatDate(d.PurchaseDate),
			formatMoney(d.PurchasePrice, d.Currency),
			formatVND(d.PurchasePriceVND),
			formatWarrantyEnd(d.EffectiveWarrantyEnd),
			status,
		})
	}

	s := b.stats()
	totals := []string{"", fmt.Sprintf("%s (%d thiết bị)", scheduleTotalName, len(b.doc.Devices)), "", "", "", "", "", formatVNDAmount(s.totalVND), "", ""}

	b.drawTable(tableSpec{
		columns:  cols,
		rows:     rows,
		totals:   totals,
		maxLines: 3,
		size:     tableSize,
	})

	b.y += 2
	if s.unknownVND > 0 {
		b.drawParagraph(fmt.Sprintf("%d thiết bị không có tỷ giá nên không được cộng vào tổng. Giá trị VND của chúng hiển thị là \"%s\".", s.unknownVND, noVND), false, smallSize, colorMuted, 0)
	}
}

func (b *builder) soldSummary(d Device) string {
	parts := []string{deviceStatusLabel("SOLD")}
	if d.SoldAt != nil {
		parts = append(parts, formatDate(d.SoldAt))
	}
	if d.SoldPrice != nil {
		parts = append(parts, formatMoney(*d.SoldPrice, d.Currency))
	}
	return strings.Join(parts, "\n")
}

func (b *builder) drawTable(spec tableSpec) {
	if b.err != nil {
		return
	}
	if len(spec.columns) == 0 {
		return
	}
	b.setFont(false, spec.size)
	headerLines := b.cellLines(spec.columns, mapHeader(spec.columns), spec.size)
	headerH := b.rowHeight(headerLines, spec.size, 2)
	b.ensureSpace(headerH + 4)
	b.drawTableHeader(spec, headerLines, headerH)

	for i, row := range spec.rows {
		cellLines := b.cellLines(spec.columns, row, spec.size)
		h := b.rowHeight(cellLines, spec.size, spec.maxLines)
		if b.y+h > bottomY {
			b.addPage()
			b.drawTableHeader(spec, headerLines, headerH)
		}
		fill := colorWhite
		if i%2 == 1 {
			fill = colorAlt
		}
		b.drawTableRow(spec, cellLines, h, spec.size, false, fill)
	}

	if spec.totals != nil {
		b.setFont(true, spec.size)
		cellLines := b.cellLinesBold(spec.columns, spec.totals, spec.size)
		h := b.rowHeight(cellLines, spec.size, 2)
		if b.y+h > bottomY {
			b.addPage()
			b.drawTableHeader(spec, headerLines, headerH)
		}
		b.drawTableRow(spec, cellLines, h, spec.size, true, colorHeader)
	}
}

func mapHeader(cols []tableColumn) []string {
	out := make([]string, len(cols))
	for i, c := range cols {
		out[i] = c.header
	}
	return out
}

func (b *builder) cellLines(cols []tableColumn, row []string, size float64) [][]string {
	return b.cellLinesWithFont(cols, row, size, false)
}

func (b *builder) cellLinesBold(cols []tableColumn, row []string, size float64) [][]string {
	return b.cellLinesWithFont(cols, row, size, true)
}

func (b *builder) cellLinesWithFont(cols []tableColumn, row []string, size float64, bold bool) [][]string {
	b.setFont(bold, size)
	out := make([][]string, len(cols))
	for i := range cols {
		value := ""
		if i < len(row) {
			value = row[i]
		}
		out[i] = b.lines(value, cols[i].width-2*tablePadX)
	}
	return out
}

func (b *builder) rowHeight(cells [][]string, size float64, maxLines int) float64 {
	max := 1
	for _, lines := range cells {
		if maxLines > 0 && len(lines) > maxLines {
			max = maxLines
			continue
		}
		if len(lines) > max {
			max = len(lines)
		}
	}
	return float64(max)*lineHeightFor(size) + 2*tablePadY
}

func (b *builder) drawTableHeader(spec tableSpec, lines [][]string, h float64) {
	b.rect(marginX, b.y, contentWidth, h, &colorHeader, nil)
	b.drawCells(spec, lines, h, spec.size, true)
	b.grid(spec, h)
	b.y += h
}

func (b *builder) drawTableRow(spec tableSpec, lines [][]string, h float64, size float64, bold bool, fill rgb) {
	b.rect(marginX, b.y, contentWidth, h, &fill, nil)
	b.setFont(bold, size)
	for i, col := range spec.columns {
		x := b.columnX(spec, i)
		cell := b.clipLines(lines[i], spec.maxLines, col.width-2*tablePadX)
		yy := b.y + tablePadY
		for _, line := range cell {
			b.drawText(line, x+tablePadX, yy, col.width-2*tablePadX, lineHeightFor(size), bold, size, col.align, colorInk)
			yy += lineHeightFor(size)
		}
	}
	b.grid(spec, h)
	b.y += h
}

func (b *builder) drawCells(spec tableSpec, lines [][]string, h float64, size float64, bold bool) {
	for i, col := range spec.columns {
		x := b.columnX(spec, i)
		cell := b.clipLines(lines[i], 2, col.width-2*tablePadX)
		yy := b.y + tablePadY
		for _, line := range cell {
			b.drawText(line, x+tablePadX, yy, col.width-2*tablePadX, lineHeightFor(size), bold, size, col.align, colorInk)
			yy += lineHeightFor(size)
		}
	}
}

func (b *builder) grid(spec tableSpec, h float64) {
	x := marginX
	b.line(x, b.y+h, x+contentWidth, b.y+h, colorLine)
	for i := 0; i <= len(spec.columns); i++ {
		b.line(x, b.y, x, b.y+h, colorLine)
		if i < len(spec.columns) {
			x += spec.columns[i].width
		}
	}
}

func (b *builder) columnX(spec tableSpec, index int) float64 {
	x := marginX
	for i := 0; i < index; i++ {
		x += spec.columns[i].width
	}
	return x
}

func lineHeightFor(size float64) float64 {
	return size * 25.4 / 72 * 1.28
}

func dash(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return "—"
	}
	return v
}

func formatWarrantyEnd(t *time.Time) string {
	if t == nil || t.IsZero() {
		return noWarrantyEnd
	}
	return formatDate(t)
}

// ---- device ----------------------------------------------------------------

func (b *builder) drawDevice(index int) {
	d := b.doc.Devices[index]
	b.section = joinNonEmpty(sectionDevice, d.Name)
	b.drawText(fmt.Sprintf("2. %s · thiết bị %d/%d", sectionDevice, index+1, len(b.doc.Devices)), marginX, b.y, contentWidth, smallLine, false, smallSize, gopdf.Left, colorMuted)
	b.y += smallLine + 1.2
	b.drawParagraphAt(valueOr(d.Name, notRecorded), marginX, b.y, contentWidth, true, 16, colorAccent, 3)
	b.y += 2
	b.line(marginX, b.y, pageWidth-marginX, b.y, colorLine)
	b.y += 4

	b.drawSubheading(sectionFacts)
	b.drawFacts(b.deviceFacts(d))
	b.y += 2

	b.drawSubheading(fmt.Sprintf("%s (%d)", sectionWarranty, len(d.Warranties)))
	if len(d.Warranties) == 0 {
		b.drawParagraph(noWarranty, false, bodySize, colorMuted, 0)
	} else {
		for i, w := range d.Warranties {
			b.drawWarranty(i+1, w, d.Currency)
		}
	}
	b.y += 1

	b.drawSubheading(fmt.Sprintf("%s (%d)", sectionClaims, len(d.Claims)))
	if len(d.Claims) == 0 {
		b.drawParagraph(noClaims, false, bodySize, colorMuted, 0)
	} else {
		for i, c := range d.Claims {
			b.drawClaim(i+1, c)
		}
	}
	b.y += 1

	b.drawImages(d)
}

func (b *builder) deviceFacts(d Device) [][2]string {
	facts := [][2]string{
		{"Hãng", valueOr(d.Brand, notRecorded)},
		{"Model", valueOr(d.Model, notRecorded)},
		{"Số serial", valueOr(d.SerialNumber, notRecorded)},
		{"Ngày mua", formatDate(d.PurchaseDate)},
		{"Giá mua", formatMoney(d.PurchasePrice, d.Currency)},
		{"Giá mua (VND)", formatVND(d.PurchasePriceVND)},
		{"Bảo hành đến", formatWarrantyEnd(d.EffectiveWarrantyEnd)},
		{"Tình trạng", deviceStatusLabel(d.Status)},
	}
	if d.Status == "SOLD" || d.SoldAt != nil || d.SoldPrice != nil {
		facts = append(facts,
			[2]string{"Ngày bán", formatDate(d.SoldAt)},
			[2]string{"Giá bán", soldPriceText(d)},
			[2]string{"Giá bán (VND)", formatVND(d.SoldPriceVND)},
		)
	}
	return facts
}

func soldPriceText(d Device) string {
	if d.SoldPrice == nil {
		return notRecorded
	}
	return formatMoney(*d.SoldPrice, d.Currency)
}

// drawFacts lays out label/value pairs in two columns. Each pair measures its
// value first and breaks the page before drawing, so a long free-text value
// cannot run past the footer.
func (b *builder) drawFacts(facts [][2]string) {
	colW := (contentWidth - 6) / 2
	labelW := 33.0
	valueW := colW - labelW
	rowGap := 1.0
	i := 0
	for i < len(facts) {
		// Compute the height of this row (one or two pairs side by side).
		type pairLines struct {
			label string
			lines []string
		}
		row := make([]pairLines, 0, 2)
		maxLines := 1
		for j := 0; j < 2 && i+j < len(facts); j++ {
			f := facts[i+j]
			b.setFont(false, 8.8)
			lines := b.lines(f[1], valueW)
			// A fact is a short field, but legacy rows can exceed the write-path
			// caps. Keep the row bounded and make the cut visible; the prose
			// sections below still carry the full text for fields that need it.
			lines = b.clipLines(lines, 6, valueW)
			if len(lines) > maxLines {
				maxLines = len(lines)
			}
			row = append(row, pairLines{label: f[0], lines: lines})
		}
		lineH := lineHeightFor(8.8)
		h := float64(maxLines)*lineH + rowGap
		b.ensureSpace(h)
		for j, p := range row {
			x := marginX + float64(j)*(colW+6)
			b.drawText(p.label, x, b.y, labelW, lineH, true, 8.2, gopdf.Left, colorMuted)
			yy := b.y
			for _, line := range p.lines {
				b.drawText(line, x+labelW, yy, valueW, lineH, false, 8.8, gopdf.Left, colorInk)
				yy += lineH
			}
		}
		b.y += h
		i += 2
	}
}

func (b *builder) drawWarranty(index int, w Warranty, currency string) {
	title := fmt.Sprintf("%d. %s", index, warrantyTypeLabel(w.Type))
	status := "Không rõ hạn"
	if w.EndDate != nil && !w.EndDate.IsZero() {
		if w.EndDate.After(b.doc.GeneratedAt) {
			status = "Còn hiệu lực"
		} else {
			status = "Đã hết hạn"
		}
	}
	b.ensureSpace(34)
	b.drawCardTitle(title, status)

	facts := [][2]string{
		{"Nhà cung cấp", valueOr(w.Provider, notRecorded)},
		{"Thời hạn", formatDateRange(w.StartDate, w.EndDate)},
		{"Số tháng", fmt.Sprintf("%d tháng", w.Months)},
		{"Giá trị gói", formatMoneyPtr(w.Cost, currency)},
		{"Bộ phận", valueOr(w.Component, "Toàn bộ thiết bị")},
		{"Số lần yêu cầu", claimsUsage(w.ClaimsAllowed, w.ClaimsUsed)},
		{"Mức trần", formatMoneyPtr(w.Cap, currency)},
		{"Khấu trừ", formatMoneyPtr(w.Deductible, currency)},
		{"Khu vực", valueOr(w.Region, notRecorded)},
		{"Chuyển nhượng", yesNoUnknown(w.Transferable)},
		{"Nơi bảo hành", valueOr(w.Address, notRecorded)},
		{"Điện thoại", valueOr(w.Phone, notRecorded)},
	}
	b.drawFacts(facts)
	b.drawProse("Phạm vi bảo hành", valueOr(w.Scope, notRecorded))
	b.drawProse("Điều khoản loại trừ", valueOr(w.Exclusions, notRecorded))
	b.drawProse("Ghi chú", valueOr(w.Notes, notRecorded))
	b.cardEnd()
}

func (b *builder) drawClaim(index int, c Claim) {
	title := fmt.Sprintf("%d. %s", index, claimStatusLabel(c.Status))
	right := "Mở " + formatDate(c.OpenedAt)
	if c.ClosedAt != nil {
		right += " · Đóng " + formatDate(c.ClosedAt)
	}
	b.ensureSpace(28)
	b.drawCardTitle(title, right)

	facts := [][2]string{
		{"Mã phiếu", valueOr(c.TicketNumber, notRecorded)},
		{"Nơi sửa", valueOr(c.ServiceCenter, notRecorded)},
		{"Chi phí (VND)", formatVNDPtrInt(c.Cost)},
		{"Bảo hành trả", coveredLabel(c.CoveredByWarranty)},
	}
	b.drawFacts(facts)
	b.drawProse("Lỗi", valueOr(c.Issue, notRecorded))
	b.drawProse("Chẩn đoán", valueOr(c.Diagnosis, notRecorded))
	b.drawProse("Kết quả", valueOr(c.Outcome, notRecorded))
	b.cardEnd()
}

func formatVNDPtrInt(p *int32) string {
	if p == nil {
		return notRecorded
	}
	return formatVNDAmount(int64(*p))
}

func (b *builder) drawCardTitle(title, right string) {
	b.ensureSpace(10)
	b.line(marginX, b.y, pageWidth-marginX, b.y, colorLine)
	b.y += 3
	b.drawText(title, marginX, b.y, contentWidth-70, 6, true, 10.5, gopdf.Left, colorAccent)
	b.drawText(right, pageWidth-marginX-80, b.y, 80, 6, false, 8, gopdf.Right, colorMuted)
	b.y += 6
}

func (b *builder) cardEnd() {
	b.y += 2
	b.line(marginX+8, b.y, pageWidth-marginX, b.y, colorLine)
	b.y += 3
}

// drawSubheading is a small section title inside a device page.
func (b *builder) drawSubheading(title string) {
	b.ensureSpace(11)
	b.y += 2
	b.drawText(title, marginX, b.y, contentWidth, 6, true, 11, gopdf.Left, colorAccent)
	b.y += 7
}

func (b *builder) drawSectionHeading(number, title string) {
	b.ensureSpace(16)
	b.rect(marginX, b.y+0.6, 2.2, 7.6, &colorAccent, nil)
	b.drawText(number+". "+title, marginX+5, b.y, contentWidth-5, 10, true, 15, gopdf.Left, colorAccent)
	b.y += 12
}

func (b *builder) drawProse(label, value string) {
	if label != "" {
		// Keep the label with at least the first line of its value.
		b.ensureSpace(lineHeightFor(8.8) + 4.8)
		b.drawText(label, marginX, b.y, contentWidth, 4.6, true, 8.4, gopdf.Left, colorMuted)
		b.y += 4.8
	}
	b.drawParagraph(value, false, 8.8, colorInk, 0)
	b.y += 1.2
}

// drawParagraph wraps and draws text, moving to a continuation page line by line
// when needed. maxLines<=0 means "as many lines as the text needs"; a positive
// value truncates with an ellipsis and is used where a fixed box is being filled
// (the empty-account notice).
func (b *builder) drawParagraph(text string, bold bool, size float64, c rgb, maxLines int) {
	b.drawParagraphAt(text, marginX, b.y, contentWidth, bold, size, c, maxLines)
}

func (b *builder) drawParagraphAt(text string, x, y, width float64, bold bool, size float64, c rgb, maxLines int) {
	b.setFont(bold, size)
	lineH := lineHeightFor(size)
	lines := b.lines(text, width)
	if maxLines > 0 && len(lines) > maxLines {
		lines = b.clipLines(lines, maxLines, width)
	}
	b.y = y
	for _, line := range lines {
		b.ensureSpace(lineH)
		b.drawText(line, x, b.y, width, lineH, bold, size, gopdf.Left, c)
		b.y += lineH
	}
}

// ---- images ----------------------------------------------------------------

func (b *builder) drawImages(d Device) {
	// The heading is drawn here, not by drawDevice, so it cannot be orphaned at
	// the bottom of a page while the first image row moves to the next one.
	const (
		boxW   = 130.0
		boxH   = 66.0
		gapX   = 9.0
		capGap = 1.4
	)
	if len(d.Images) == 0 {
		b.ensureSpace(22)
		b.drawSubheading(fmt.Sprintf("%s (0 ảnh được nhúng)", sectionImages))
		b.drawParagraph(noImages, false, bodySize, colorInk, 0)
		if len(d.Attachments) == 0 {
			b.drawParagraph(noAttachments, false, smallSize, colorMuted, 0)
		} else {
			b.drawParagraph(noImagesHint, false, smallSize, colorMuted, 0)
		}
		return
	}
	b.ensureSpace(boxH + 18)
	b.drawSubheading(fmt.Sprintf("%s (%d ảnh được nhúng)", sectionImages, len(d.Images)))
	for i := 0; i < len(d.Images); i += 2 {
		b.ensureSpace(boxH + 14)
		for j := 0; j < 2 && i+j < len(d.Images); j++ {
			img := d.Images[i+j]
			x := marginX + float64(j)*(boxW+gapX)
			y := b.y
			b.rect(x, y, boxW, boxH, &colorWhite, &colorLine)
			if len(img.Data) > 0 && img.Width > 0 && img.Height > 0 {
				holder, err := gopdf.ImageHolderByBytes(img.Data)
				if err != nil {
					b.fail(fmt.Errorf("read image %q: %w", img.FileName, err))
					continue
				}
				w, h := fitWithin(float64(img.Width), float64(img.Height), boxW-2, boxH-2)
				ix := x + (boxW-w)/2
				iy := y + (boxH-h)/2
				b.fail(b.pdf.ImageByHolder(holder, ix, iy, &gopdf.Rect{W: w, H: h}))
			}
			capY := y + boxH + capGap
			label := fmt.Sprintf("Ảnh %d: %s", i+j+1, valueOr(img.FileName, notRecorded))
			b.setFont(true, 7.8)
			b.textColor(colorInk)
			capLines := b.clipLines(b.lines(label, boxW), 1, boxW)
			b.drawText(capLines[0], x, capY, boxW, 3.6, true, 7.8, gopdf.Left, colorInk)
			if strings.TrimSpace(img.Description) != "" {
				desc := b.clipLines(b.lines(img.Description, boxW), 2, boxW)
				yy := capY + 3.8
				for _, line := range desc {
					b.drawText(line, x, yy, boxW, 3.4, false, 7.4, gopdf.Left, colorMuted)
					yy += 3.4
				}
			}
		}
		b.y += boxH + 14
	}
	if len(d.Attachments) > len(d.Images) {
		b.drawParagraph(noImagesHint, false, smallSize, colorMuted, 0)
	}
}

func fitWithin(srcW, srcH, maxW, maxH float64) (float64, float64) {
	if srcW <= 0 || srcH <= 0 {
		return 0, 0
	}
	scale := maxW / srcW
	if h := maxH / srcH; h < scale {
		scale = h
	}
	if scale > 1 {
		// Never upscale: a 300 px receipt screenshot stays small and sharp
		// instead of being blown up into a blurry half-page image.
		scale = 1
	}
	return srcW * scale, srcH * scale
}

// ---- manifest --------------------------------------------------------------

func (b *builder) drawManifest() {
	b.section = sectionManifest
	b.drawSectionHeading("3", sectionManifest)
	b.drawParagraph(manifestIntro, false, smallSize, colorMuted, 0)
	b.y += 2

	cols := []tableColumn{
		{header: manifestHeaders[0], width: 8, align: gopdf.Center},
		{header: manifestHeaders[1], width: 48, align: gopdf.Left},
		{header: manifestHeaders[2], width: 70, align: gopdf.Left},
		{header: manifestHeaders[3], width: 33, align: gopdf.Left},
		{header: manifestHeaders[4], width: 110, align: gopdf.Left},
	}
	rows := make([][]string, 0)
	n := 0
	for _, d := range b.doc.Devices {
		for _, a := range d.Attachments {
			n++
			name := valueOr(a.FileName, notRecorded)
			if strings.TrimSpace(a.Description) != "" {
				name += "\n" + sanitizeText(a.Description)
			}
			rows = append(rows, []string{
				fmt.Sprintf("%d", n),
				valueOr(d.Name, notRecorded),
				name,
				fileTypeLabel(a.FileType),
				manifestStatusText(a.Status, a.FileType),
			})
		}
	}
	if len(rows) == 0 {
		b.drawParagraph(manifestEmpty, false, bodySize, colorInk, 0)
	} else {
		b.drawTable(tableSpec{columns: cols, rows: rows, maxLines: 3, size: tableSize})
	}
	b.y += 3
	b.drawParagraph(manifestFootnote, false, 7.6, colorMuted, 0)
}

func fileTypeLabel(mime string) string {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/jpeg":
		return "JPEG (image/jpeg)"
	case "image/png":
		return "PNG (image/png)"
	case "image/gif":
		return "GIF (image/gif)"
	case "image/webp":
		return "WEBP (image/webp)"
	case "image/heic":
		return "HEIC (image/heic)"
	case "application/pdf":
		return "PDF (application/pdf)"
	case "":
		return notRecorded
	default:
		return mime
	}
}

// ---- footer ----------------------------------------------------------------

func (b *builder) drawFooters() {
	if b.err != nil {
		return
	}
	total := b.pdf.GetNumberOfPages()
	for i := 1; i <= total; i++ {
		b.fail(b.pdf.SetPage(i))
		if b.err != nil {
			return
		}
		b.line(marginX, footerLineY, pageWidth-marginX, footerLineY, colorLine)
		b.drawText(footerTitle, marginX, footerTextY, contentWidth-40, 4, false, 7, gopdf.Left, colorMuted)
		b.drawText(fmt.Sprintf("Trang %d/%d", i, total), pageWidth-marginX-40, footerTextY, 40, 4, false, 7, gopdf.Right, colorMuted)
	}
	b.fail(b.pdf.SetPage(total))
}
