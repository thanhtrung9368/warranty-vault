// Package pdftext extracts the text layer of a generated PDF for assertions in
// tests. It is deliberately not imported by the server.
//
// The extractor uses ledongthuc/pdf (a BSD-licensed fork of rsc.io/pdf with
// /ToUnicode support). gopdf writes one bfrange per used glyph, which this
// extractor decodes correctly; that is why the insurance-pack tests can assert
// Vietnamese strings instead of only the PDF header.
package pdftext

import (
	"bytes"
	"fmt"

	pdf "github.com/ledongthuc/pdf"
)

// Extract returns the concatenated plain text of every page, separated by
// newlines. Page order is the document order.
func Extract(data []byte) (string, error) {
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("open pdf: %w", err)
	}
	var out bytes.Buffer
	for i := 1; i <= r.NumPage(); i++ {
		text, err := r.Page(i).GetPlainText(nil)
		if err != nil {
			return "", fmt.Errorf("extract page %d: %w", i, err)
		}
		out.WriteString(text)
		out.WriteByte('\n')
	}
	return out.String(), nil
}

// Pages returns the number of pages in the PDF without extracting text.
func Pages(data []byte) (int, error) {
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return 0, fmt.Errorf("open pdf: %w", err)
	}
	return r.NumPage(), nil
}
