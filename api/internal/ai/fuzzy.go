package ai

import (
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// Normalize folds a string for diacritic-insensitive matching: lowercase, strip
// Vietnamese tone/diacritic marks, map đ→d, collapse whitespace, drop
// punctuation. "Thế Giới Di Động" and "the gioi di dong" normalize equal —
// directly mitigating Vietnamese-diacritic OCR errors during catalog mapping.
func Normalize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	// đ/Đ are not handled by NFD decomposition; map explicitly first.
	s = strings.NewReplacer("đ", "d", "Đ", "d").Replace(s)

	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	folded, _, err := transform.String(t, s)
	if err != nil {
		folded = s
	}

	var b strings.Builder
	prevSpace := false
	for _, r := range folded {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			prevSpace = false
		case unicode.IsSpace(r):
			if !prevSpace {
				b.WriteRune(' ')
				prevSpace = true
			}
		default:
			// drop punctuation
		}
	}
	return strings.TrimSpace(b.String())
}

// MatchScore returns a 0..1 similarity between two raw strings after
// normalization: 1.0 on exact normalized equality, a high score on substring
// containment, otherwise a token-overlap (Jaccard) ratio. Cheap and
// dependency-free — good enough to map free-text to a small curated catalog.
func MatchScore(a, b string) float64 {
	na, nb := Normalize(a), Normalize(b)
	if na == "" || nb == "" {
		return 0
	}
	if na == nb {
		return 1
	}
	if strings.Contains(na, nb) || strings.Contains(nb, na) {
		return 0.9
	}
	ta := strings.Fields(na)
	tb := strings.Fields(nb)
	set := make(map[string]bool, len(ta))
	for _, t := range ta {
		set[t] = true
	}
	inter := 0
	for _, t := range tb {
		if set[t] {
			inter++
		}
	}
	union := len(set)
	for _, t := range tb {
		if !set[t] {
			union++
		}
	}
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}
