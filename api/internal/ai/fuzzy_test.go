package ai

import "testing"

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"Thế Giới Di Động":  "the gioi di dong",
		"  Điện  Máy XANH ": "dien may xanh",
		"Apple®":            "apple",
		"Samsung, Inc.":     "samsung inc",
		"đồng hồ":           "dong ho",
	}
	for in, want := range cases {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMatchScore(t *testing.T) {
	// Diacritic-insensitive exact match (the core OCR-error mitigation).
	if s := MatchScore("the gioi di dong", "Thế Giới Di Động"); s != 1 {
		t.Errorf("expected exact match (1.0), got %v", s)
	}
	// Containment scores high.
	if s := MatchScore("Apple Store", "Apple"); s < 0.85 {
		t.Errorf("expected containment high score, got %v", s)
	}
	// Unrelated strings score low.
	if s := MatchScore("Samsung", "Thế Giới Di Động"); s >= 0.5 {
		t.Errorf("expected low score for unrelated, got %v", s)
	}
	// Empty is zero.
	if s := MatchScore("", "Apple"); s != 0 {
		t.Errorf("expected 0 for empty, got %v", s)
	}
}
