package files

import (
	"errors"
	"strings"

	"github.com/gabriel-vasile/mimetype"
)

// AllowedMIMEs is the strict whitelist for attachment uploads, mirroring
// website/src/lib/services/attachments.ts. SVG / HTML / JS are deliberately
// rejected — they can carry executable content even when "rendered as image".
var AllowedMIMEs = map[string]struct{}{
	"image/jpeg":      {},
	"image/png":       {},
	"image/webp":      {},
	"image/gif":       {},
	"image/heic":      {},
	"application/pdf": {},
}

// HEIF detection in the upstream library may report image/heif/heic-sequence
// or image/heif-sequence. Treat these as image/heic for whitelist purposes
// since they are visually equivalent for our use-case (warranty receipts).
var heifAliases = map[string]string{
	"image/heif":              "image/heic",
	"image/heic-sequence":     "image/heic",
	"image/heif-sequence":     "image/heic",
}

// DetectAndValidate inspects the leading bytes of buf to confirm the file
// matches one of the whitelisted MIME types AND that the declared
// Content-Type matches what the bytes actually look like. Returns the
// canonical MIME on success.
//
// `declared` is the client-provided Content-Type (e.g. from multipart
// header). It is normalised (strip parameters, lowercase) before compare.
func DetectAndValidate(buf []byte, declared string) (string, error) {
	if len(buf) == 0 {
		return "", errors.New("file trống")
	}
	declaredCT := normaliseCT(declared)

	mt := mimetype.Detect(buf).String()
	canonical := normaliseCT(mt)
	// HEIF aliases → HEIC.
	if alias, ok := heifAliases[canonical]; ok {
		canonical = alias
	}

	if _, ok := AllowedMIMEs[canonical]; !ok {
		return "", errors.New("Chỉ chấp nhận JPG/PNG/WEBP/GIF/HEIC hoặc PDF") //nolint:staticcheck // Vietnamese user-facing error
	}

	// If the client declared a type, it must match the magic bytes.
	if declaredCT != "" && declaredCT != canonical {
		// Tolerate the same HEIF aliases on the client side.
		if alias, ok := heifAliases[declaredCT]; ok && alias == canonical {
			return canonical, nil
		}
		return "", errors.New("Nội dung file không khớp định dạng khai báo") //nolint:staticcheck // Vietnamese user-facing error
	}
	return canonical, nil
}

func normaliseCT(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	if i := strings.IndexByte(s, ';'); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	return s
}
