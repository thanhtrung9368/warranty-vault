// Package i18n resolves the language of one request and renders user-facing
// strings in it.
//
// Scope of Phase 0 (docs/I18N_PLAN.md §3): this package is the MECHANISM. Only
// the auth slice plus the cron push bodies are in the catalog so far; every other
// user-facing string in api/ is still a Vietnamese literal and is deliberately
// left untouched. Phase 1 converts the rest with no change to this package —
// `i18n.T(ctx, "<Vietnamese literal>", args...)` at the call site plus one entry
// in catalog.go is the whole recipe.
//
// # Locale resolution
//
// Exactly this precedence, first match wins (docs/I18N_PLAN.md §2.2):
//
//  1. ?lang=vi|en      query parameter — wins over everything (tests, debugging)
//  2. Accept-Language  HTTP header, parsed and q-weighted by x/text/language
//  3. User.locale      the stored preference (migration 0014)
//  4. "en"             the default
//
// Levels 1 and 2 come from the request and are resolved by Middleware (level 2)
// and by From (level 1, read lazily so a handler cannot observe a stale value).
// Level 3 is attached by the auth middleware once the User row is known — see
// WithUserLocale. Level 4 is Default.
//
// An unsupported language is NOT a 400. `Accept-Language: fr` gets English, and
// so does a malformed header; the request simply falls through to the next level.
// That is the whole point of the confidence check in HeaderTag: a header that
// matches nothing must leave the decision to the stored preference rather than
// silently pinning the default.
//
// # Why the key is the Vietnamese string
//
// See the header comment in catalog.go.
package i18n

import (
	"context"
	"fmt"
	"strings"

	"golang.org/x/text/language"
)

// Tag identifies a supported language. The values are the ISO 639-1 codes, which
// are also what the `?lang=` parameter and the `User.locale` column store, so a
// tag crosses every boundary in the stack without translation.
type Tag string

const (
	// VI is Vietnamese — the source language. Every string in this repo was
	// written in it first (docs/I18N_PLAN.md §2.4).
	VI Tag = "vi"
	// EN is English — the translation.
	EN Tag = "en"
	// Default is served when no level of the precedence chain produces a
	// supported language. The owner asked for English as the product default.
	Default = EN
)

// Supported is the set of tags the service can render. Phase 1 does not change
// it; a third language would add one entry here, one tag->language.Tag entry in
// supportedTags, and one column in `messages`.
var Supported = []Tag{EN, VI}

// supportedTags pairs each Tag with the x/text tag used for Accept-Language
// matching. Kept next to Supported so the two cannot drift.
var supportedTags = map[Tag]language.Tag{
	EN: language.English,
	VI: language.Vietnamese,
}

// matcher is built once: language.NewMatcher is not free and the supported set
// never changes at runtime.
var matcher = newMatcher()

func newMatcher() language.Matcher {
	tags := make([]language.Tag, 0, len(Supported))
	for _, t := range Supported {
		tags = append(tags, supportedTags[t])
	}
	return language.NewMatcher(tags)
}

// IsSupported reports whether tag names a language the catalog can render.
// Callers validating a user-supplied value (PATCH /auth/me `locale`) use this;
// the resolver does not need it because it never produces an unsupported tag.
func IsSupported(tag Tag) bool {
	_, ok := supportedTags[tag]
	return ok
}

// Normalize maps a caller-supplied language identifier onto a supported Tag.
// It accepts what a client would plausibly send — "vi", "VI", "vi-VN",
// "en-US" — and reports false for anything else ("fr", "", "  "), which the
// caller turns into a validation error or a fall-through, never a panic.
//
// It is deliberately NOT used for the `?lang=` parameter: that one accepts the
// exact literals `vi` and `en` only, because the OpenAPI contract says so and
// because a debug switch should not have a permissive parser.
func Normalize(raw string) (Tag, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	// The value may be malformed (`User.locale` is free text at the DB level for
	// rows older than migration 0014, and a hand-written request can carry
	// anything) or carry subtags we ignore ("vi-VN-u-nu-latn"). The parser
	// reports both; neither is fatal, so the result is judged purely on whether
	// the matcher recognises the language.
	parsed, _ := language.Parse(raw)
	return matchOne(parsed)
}

// matchOne is the single-tag half of the matcher. `language.Matcher.Match`
// answers "which supported tag is the closest fit?" and returns the DEFAULT with
// confidence language.No when there is no fit — which is why the confidence, not
// the returned tag, decides. Without that check an unsupported language would be
// silently pinned to English here and level 3 of the precedence chain would be
// unreachable.
func matchOne(parsed language.Tag) (Tag, bool) {
	base, _, conf := matcher.Match(parsed)
	if conf == language.No {
		return "", false
	}
	// Compare BASE languages, never the full tags: the matcher canonicalises a
	// regional tag into CLDR form, so `vi-VN` comes back as "vi-u-rg-vnzzzz" and
	// a string comparison against "vi" silently fails for every client that
	// sends a region — which is most of them.
	baseLang, _, _ := base.Raw()
	wanted := baseLang.String()
	for tag, supported := range supportedTags {
		if got, _, _ := supported.Raw(); got.String() == wanted {
			return tag, true
		}
	}
	return "", false
}

// matchList picks the best supported tag out of an ordered, q-weighted list such
// as the one ParseAcceptLanguage returns. It walks the list in preference order
// and takes the first entry that matches, which is what the header means: "give
// me the earliest of these you have".
func matchList(tags []language.Tag) (Tag, bool) {
	for _, t := range tags {
		if tag, ok := matchOne(t); ok {
			return tag, true
		}
	}
	return "", false
}

// ── request context ──────────────────────────────────────────────────────────

type ctxKey int

const (
	// tagKey holds the request-derived locale (levels 1-2). Absent means "no
	// request signal", which is what lets level 3 win.
	tagKey ctxKey = iota
	// userTagKey holds the stored preference (level 3).
	userTagKey
)

// WithTag returns a context carrying an explicit language, overriding anything
// already there. Middleware uses it after parsing Accept-Language; a test uses it
// to pin a language with no HTTP plumbing at all.
func WithTag(ctx context.Context, tag Tag) context.Context {
	return context.WithValue(ctx, tagKey, tag)
}

// WithUserLocale records the authenticated user's stored preference. It is a
// no-op when a request signal already decided the language, and a no-op for an
// unsupported or NULL value — so `User.locale = NULL` (every existing row) keeps
// falling through to the default exactly as before migration 0014.
//
// The auth middleware calls this after a bearer token resolves.
func WithUserLocale(ctx context.Context, stored *string) context.Context {
	if tag, ok := ctx.Value(tagKey).(Tag); ok && tag != "" {
		return ctx
	}
	if stored == nil {
		return ctx
	}
	tag, ok := Normalize(*stored)
	if !ok {
		return ctx
	}
	return context.WithValue(ctx, userTagKey, tag)
}

// From reports the language that will be used to render this context: the
// request-derived tag if any, else the stored preference, else Default. It is
// what a test asserts against, and what a service uses when it must pick between
// two catalog keys (the singular and plural forms) before translating.
func From(ctx context.Context) Tag {
	if tag, ok := FromContext(ctx); ok {
		return tag
	}
	return Default
}

// FromContext is From without the default: it reports whether ANY level of the
// precedence chain produced a language, which is a different question from "what
// language will be used".
//
// The distinction is what the Content-Language response header needs. A request
// that carried no signal at all — every client that predates i18n — must not
// start receiving a header claiming English, because that header is an assertion
// about how the body was rendered, and the body of an unconverted endpoint is a
// Vietnamese literal. Absent signal, absent header.
func FromContext(ctx context.Context) (Tag, bool) {
	if tag, ok := ctx.Value(tagKey).(Tag); ok && IsSupported(tag) {
		return tag, true
	}
	if tag, ok := ctx.Value(userTagKey).(Tag); ok && IsSupported(tag) {
		return tag, true
	}
	return "", false
}

// ── rendering ────────────────────────────────────────────────────────────────

// lookup is the catalog read: the message for `key` in `tag`, or "" when the
// catalog does not know the key at all. It deliberately has NO variadic tail —
// `go vet` classifies a `(string, ...any)` function as a printf wrapper and then
// rejects any call that passes a non-constant key, which is exactly what happens
// when a key arrives from a struct field.
func lookup(tag Tag, key string) (string, bool) {
	entry, ok := messages[key]
	if !ok {
		return "", false
	}
	if tag == EN {
		return entry.en, true
	}
	return entry.vi, true
}

// other returns the message in the language that is NOT `tag` — the
// missing-translation fallback.
func other(tag Tag, key string) (string, bool) {
	if tag == EN {
		entry, ok := messages[key]
		if !ok {
			return "", false
		}
		return entry.vi, true
	}
	return lookup(EN, key)
}

// Translate renders one message, filling `args` in with Sprintf verbs.
//
// Fallback, in order (docs/I18N_PLAN.md §3 and the brief):
//
//  1. the requested language, if the entry exists there;
//  2. the OTHER language, if the entry exists only there — a Phase 1 agent who
//     adds an English string but has not yet added the Vietnamese one (or the
//     reverse) serves a real sentence, never a key and never an empty string;
//  3. the key itself, which IS the Vietnamese source text.
//
// Because the key is the source text, step 3 degrades to correct Vietnamese
// rather than to a bare identifier, and it is what makes the Phase 1 migration
// additive: an un-migrated call site cannot render anything worse than it does
// today.
func Translate(tag Tag, key string, args ...any) string {
	text, ok := lookup(tag, key)
	if !ok {
		// Not in the catalog at all: the source text is the best answer we have.
		return Interpolate(key, args...)
	}
	if text == "" {
		// The requested language has no translation yet — fall back to the
		// other one rather than emitting "".
		if fallback, ok := other(tag, key); ok && fallback != "" {
			text = fallback
		}
	}
	return Interpolate(text, args...)
}

// Lookup returns the catalog text for `key` in `tag`, and whether the catalog
// knows the key at all.
//
// It exists for the callers that must decide WHICH key to render before they can
// render it — the cron's singular/plural pairs. Those keys are computed rather
// than written out at the call site, so they must not travel through the
// printf-shaped Translate, whose format-string classification is exactly what
// keeps a hand-written `%` out of Sprintf. The pair shape is:
//
//	text, ok := i18n.Lookup(lang, pluralKey(n, plural, singular))
//	if !ok { text = fallback }
//	body := i18n.Interpolate(text, a, b)
func Lookup(tag Tag, key string) (string, bool) {
	text, ok := lookup(tag, key)
	if !ok {
		return "", false
	}
	if text == "" {
		// Same missing-translation rule as Translate: serve the other language
		// rather than an empty string.
		if fallback, ok := other(tag, key); ok && fallback != "" {
			return fallback, true
		}
	}
	return text, true
}

// Interpolate fills `args` into a message with the standard library's Sprintf
// verbs. Exported because the cron builds its argument list per language (the
// Vietnamese and English phrasings order the same arguments differently) and
// because tests assert the raw catalog text.
//
// Sprintf runs ONLY when args were passed. A static message is returned
// verbatim, so a literal `%` in a translation can never be misread as a verb.
func Interpolate(text string, args ...any) string {
	if len(args) == 0 {
		return text
	}
	return fmt.Sprintf(text, args...)
}

// T renders `key` in the language resolved for ctx, filling `args` in. This is
// the call site a handler uses for a message with arguments.
func T(ctx context.Context, key string, args ...any) string {
	return Translate(From(ctx), key, args...)
}

// Text renders an argument-free message in the language resolved for ctx.
//
// This is not sugar for T: it is a DIFFERENT call shape, and the difference is
// load-bearing. `go vet`'s printf analyzer classifies `(string, ...any)` as a
// printf wrapper, and `go test ./...` runs vet — so `T(ctx, svc.MessageKey)`,
// where the key is DATA rather than a literal at the call site, is a vet failure.
// Text routes through `lookup`, which has no variadic tail, so a key that arrives
// from a struct field, a map or a variable can be rendered without ever being
// treated as a caller-supplied format string.
func Text(ctx context.Context, key string) string {
	text, ok := lookup(From(ctx), key)
	if !ok {
		return key
	}
	if text == "" {
		if fallback, ok := other(From(ctx), key); ok {
			return fallback
		}
		return key
	}
	return text
}
