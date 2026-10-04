package i18n

import (
	"context"
	"net/http"
	"strings"

	"golang.org/x/text/language"
)

// Middleware resolves the request-derived half of the precedence chain and pins
// it on the request context, so every handler downstream — including the shared
// envelope writers in `httpx` — renders in the right language without threading a
// parameter through 60 signatures.
//
// It handles levels 1 and 2 only:
//
//   - Level 1 (`?lang=`) is recognised here so the Content-Language header can be
//     emitted before the handler runs, but the authoritative read is in From,
//     which consults the query string on every call. A request that reaches a
//     handler through a router that forgot this middleware therefore still
//     honours `?lang=` — the tests in internal/handlers rely on that, and it is
//     what makes `curl '...?lang=vi'` work on any endpoint, including ones added
//     later.
//   - Level 3 (`User.locale`) is NOT known here: only the handler that resolved
//     the bearer token knows the user. The auth middleware adds it with
//     WithUserLocale, which defers to whatever this middleware set.
//
// A request with no usable signal stores nothing at all. That is deliberate: if
// the middleware stored `Default`, level 3 could never win, and a user whose
// stored preference is `vi` would silently get English.
//
// The header is written before the handler runs, so it is present on every
// response the request produces. It is advisory metadata and changes no status
// code: an unsupported `Accept-Language` is a fallback, never a 400.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		// Store a tag ONLY when the request produced one. Storing the default
		// here would pin level 2 and make level 3 (the stored preference)
		// unreachable for every client that sends no Accept-Language — i.e. for
		// the app's own native clients. "No signal" is represented by the ABSENCE
		// of the key, nothing else.
		if tag, ok := fromRequest(r); ok {
			ctx = WithTag(ctx, tag)
		}
		r = r.WithContext(ctx)
		// Report what this response will ACTUALLY be rendered in — but only when
		// the client ASKED for a language. The header's meaning is then precise:
		// "you requested a language; here is the one you got." A French client
		// that sent `Accept-Language: fr` gets `Content-Language: en`, which is
		// the answer to its question; a client that sent nothing gets no header at
		// all, so an unconverted endpoint is not falsely labelled English.
		//
		// TagFor, not From: level 3 (the stored preference) is not known yet here,
		// so it can only be reflected by the handler's own write.
		if hasLanguageSignal(r) {
			w.Header().Set("Content-Language", string(TagFor(r)))
		}
		next.ServeHTTP(w, r)
	})
}

// hasLanguageSignal reports whether the request asked for a language at all,
// regardless of whether we support it. Deliberately about PRESENCE, not about
// resolution: `Accept-Language: fr` is a signal that must be answered with the
// language actually served (English), whereas no header at all is not a question
// and gets no answer.
func hasLanguageSignal(r *http.Request) bool {
	return strings.TrimSpace(r.URL.Query().Get("lang")) != "" ||
		strings.TrimSpace(r.Header.Get("Accept-Language")) != ""
}

// fromRequest resolves levels 1 and 2 in order: the `?lang=` parameter first, then
// Accept-Language. It reports whether EITHER produced a supported language, which
// is what distinguishes "the client asked and we honoured it" from "the client
// asked for something we do not ship" (both of which are requests that did ask,
// per hasLanguageSignal).
func fromRequest(r *http.Request) (Tag, bool) {
	if tag, ok := QueryTag(r); ok {
		return tag, true
	}
	return HeaderTag(r)
}

// Attach resolves levels 1-2 for `r` and returns a context carrying the outcome,
// so every `T`/`Text` call downstream renders in the right language.
//
// Middleware already does this for the real server. Attach exists for the
// handlers that are invoked DIRECTLY in tests — internal/handlers builds its own
// mux without the middleware chain, and `?lang=` has to keep working there or a
// test cannot pin a language (docs/I18N_PLAN.md §4.3). Calling it twice is
// harmless: the second call computes the same answer.
//
// A request that carried no signal stores nothing, so a stored preference can
// still win at level 3.
//
// An existing tag WINS. `auth.RequireUser` runs before the handler and attaches
// the stored preference (level 3) from the User row; overwriting that here would
// silently drop it for every handler that calls Attach, which is exactly the
// level this whole change exists to reach.
func Attach(r *http.Request) context.Context {
	// `?lang=` first: it is level 1 and must beat a tag the auth middleware
	// already put in the context.
	if tag, ok := QueryTag(r); ok {
		return WithTag(r.Context(), tag)
	}
	// Then whatever is already decided — the middleware's Accept-Language
	// (level 2) or RequireUser's stored preference (level 3). Both outrank the
	// header read below, so this must come before it.
	if tag, ok := FromContext(r.Context()); ok {
		return WithTag(r.Context(), tag)
	}
	if tag, ok := HeaderTag(r); ok {
		return WithTag(r.Context(), tag)
	}
	return r.Context()
}

// TagFor returns the language one whole request will be rendered in, applying the
// full four-level precedence chain: `?lang=`, then Accept-Language (via the
// context Middleware seeded), then `User.locale` (via WithUserLocale), then
// Default.
//
// Handlers that only need text use T(r.Context(), ...). This is for the callers
// that need the tag itself: a service that must choose between a singular and a
// plural catalog key before translating.
func TagFor(r *http.Request) Tag {
	if tag, ok := QueryTag(r); ok {
		return tag
	}
	return From(r.Context())
}

// QueryTag reads level 1. Only the exact literals `vi` and `en` are accepted
// (case-insensitively), because that is what the OpenAPI contract documents and
// because `?lang=` is a debugging switch: a value it does not understand should
// fall through to the next level, not be guessed at.
func QueryTag(r *http.Request) (Tag, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("lang"))
	switch strings.ToLower(raw) {
	case string(VI):
		return VI, true
	case string(EN):
		return EN, true
	default:
		return "", false
	}
}

// HeaderTag reads level 2 with golang.org/x/text/language, which is the only
// correct way to do it: the header is a q-weighted, possibly malformed list
// ("vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"), and a hand-rolled parser gets the
// ordering, the wildcards and the junk wrong.
//
// It reports false when the header matches no supported language. That is the
// difference between this and From: `Accept-Language: fr` must NOT be recorded as
// a decision, because falling through to the user's stored preference is what the
// precedence chain requires. Recording Default here would pin English and make
// level 3 unreachable for every client that sends a header — i.e. for all of
// them.
func HeaderTag(r *http.Request) (Tag, bool) {
	raw := strings.TrimSpace(r.Header.Get("Accept-Language"))
	if raw == "" {
		return "", false
	}
	// ParseAcceptLanguage, NOT Parse: the header is a comma-separated,
	// q-weighted LIST, and language.Parse reads only the first element. Using
	// the single-tag parser here made `fr-FR,vi;q=0.9,en;q=0.3` resolve to the
	// default instead of Vietnamese — the exact bug this test suite exists to
	// catch, and the reason the brief says not to hand-roll (or half-use) this
	// parser.
	//
	// A malformed header yields an empty list (or `und`) and falls through to
	// the next level, which is the "junk gets the default" behaviour.
	tags, _, err := language.ParseAcceptLanguage(raw)
	if err != nil {
		return "", false
	}
	return matchList(tags)
}
