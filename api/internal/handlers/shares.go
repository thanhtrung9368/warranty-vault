package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// maxShareCreateBody bounds the POST /shares body. The payload is two small
// scalars; anything larger is not a client of this API.
const maxShareCreateBody = 4 << 10

// Handover certificate + tokenised share link (FEATURE_IDEAS #2) — the ONLY
// unauthenticated read path in the service.
//
// Three routes are owner-scoped and go through auth.RequireUser like every other
// route in this package. The fourth, GET /api/v1/public/shares/{token}, is
// deliberately NOT wrapped: the token IS the credential. That handler is written
// defensively on purpose:
//
//   - no userID exists anywhere in its call chain — services.
//     ViewSharedCertificate has no user parameter to get wrong, and the warranty
//     read is keyed on the device id that came out of the share row;
//   - every failure (unknown / expired / revoked / deleted device) returns the
//     same 404 with the same body, so the route is not an oracle for which
//     tokens were once valid;
//   - the response is `no-store` + `noindex` + `no-referrer`, so the token in the
//     path is not cached by a proxy, indexed by a crawler, or leaked in the
//     Referer header when the recipient clicks the vendor's locator link;
//   - it is rate-limited per IP before the database is touched.
//
// # i18n — how the PUBLIC certificate picks a language (docs/I18N_PLAN.md §3)
//
// The recipient is a third party holding a forwarded link. They never chose a
// language in this app, there is no `User.locale` to read (that is the OWNER's),
// and the owner must not choose for them. So the rule is the one signal the
// recipient's own client sends, resolved by `publicShareLanguage` below:
//
//  1. ?lang=vi|en      explicit, wins — a debugging switch, and the only way a
//     recipient whose browser sends nothing useful can ask;
//  2. Accept-Language  the browser's own preference, which is what a real
//     recipient actually has (Vietnamese phones send `vi`);
//  3. vi               the fallback, NOT the product default `en`.
//
// Why the fallback is Vietnamese rather than the product default English: this
// document existed before i18n with a Vietnamese disclaimer, and it is a
// durable artifact — printed, saved as PDF, filed with a warranty card. Links
// minted before this wave, and non-browser fetchers (a curl, a preview bot, an
// old phone) carry no Accept-Language at all, so keeping `vi` as the last resort
// means no existing link changes its language because a wave landed. The
// English default stays where it belongs: an authenticated client that gets it
// wrong is a bug the app can fix, while a certificate that flips to a language
// the recipient cannot read is not recoverable by anybody.
//
// `?lang=` is honoured but deliberately NOT offered as an in-page switcher: a
// link with a language baked into it would let the OWNER pick for the recipient,
// and a clickable switch would add a parameter to a page whose URL carries the
// credential. The recipient's own browser already answers the question — and for
// the case it does not, `?lang=en` is documented in openapi.yaml.
//
// None of this may become an oracle. The FOUR failure cases (unknown / expired /
// revoked / deleted device) still render byte-identical bodies AS EACH OTHER in
// a given language: the language is client-supplied and says nothing about the
// token. The `Cache-Control: no-store`, `X-Robots-Tag: noindex` and CSP headers
// are unchanged, and the Content-Language header is stamped from the same tag the
// page is rendered in.
func RegisterShares(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("POST /api/v1/devices/{id}/shares", requireUser(http.HandlerFunc(createShareHandler(deps))))
	mux.Handle("GET /api/v1/devices/{id}/shares", requireUser(http.HandlerFunc(listSharesHandler(deps))))
	mux.Handle("DELETE /api/v1/shares/{id}", requireUser(http.HandlerFunc(revokeShareHandler(deps))))

	// Unauthenticated by design. See the doc comment above.
	mux.HandleFunc("GET /api/v1/public/shares/{token}", publicShareHandler(deps))
}

// publicShareLanguage resolves the certificate's language without the
// authenticated precedence chain, because there is no authenticated user on this
// route. See the RegisterShares doc comment for why the fallback is Vietnamese.
//
// It returns the tag to render in; the exported `i18n.QueryTag` / `i18n.HeaderTag`
// readers are reused rather than re-parsed here so the certificate cannot drift
// from the rest of the service on what `?lang=vi-VN` or a malformed header means
// (level 1 accepts the exact literals only; level 2 is q-weighted and falls
// through when nothing matches).
func publicShareLanguage(r *http.Request) i18n.Tag {
	if tag, ok := i18n.QueryTag(r); ok {
		return tag
	}
	if tag, ok := i18n.HeaderTag(r); ok {
		return tag
	}
	// Vietnamese is the source language of this document and the language it has
	// always been served in. Every level above is the recipient asking for
	// something else.
	return i18n.VI
}

// publicShareContext is the context every public-share response is rendered with:
// the recipient's language (levels 1-2 above, then the `vi` fallback) in the
// place the catalog reads, so `i18n.T`/`i18n.Text` and `i18n.TagFor` all agree on
// one tag.
func publicShareContext(r *http.Request) context.Context {
	return i18n.WithTag(r.Context(), publicShareLanguage(r))
}

// ---- owner handlers --------------------------------------------------------

func createShareHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// i18n.Attach at the top of every converted handler: the tests build their
		// own mux with no middleware chain, so `?lang=` has to be resolved here.
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		deviceID := r.PathValue("id")
		if deviceID == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id thiết bị"), nil)
			return
		}

		// An empty body is valid and means "all defaults": a client that just
		// wants a 30-day link should not have to send `{}`. Unknown keys are
		// rejected with a field-level message, the same contract the PATCH
		// /attachments handler uses, so a typo like `expiresInDay` cannot
		// silently produce a link with the default lifetime.
		in := services.CreateShareInput{}
		body, rerr := io.ReadAll(io.LimitReader(r.Body, maxShareCreateBody+1))
		if rerr != nil {
			badJSONBody(w, ctx)
			return
		}
		if len(body) > maxShareCreateBody {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Body quá lớn"), nil)
			return
		}
		if len(bytes.TrimSpace(body)) > 0 {
			var raw map[string]json.RawMessage
			if err := json.Unmarshal(body, &raw); err != nil {
				badJSONBody(w, ctx)
				return
			}
			unknown := map[string][]string{}
			for k := range raw {
				if k != "expiresInDays" && k != "includeSerial" {
					// Translated AT THE CALL SITE — the map holds finished strings,
					// so a key left here would never be rendered.
					unknown[k] = []string{i18n.Text(ctx, "Trường không được hỗ trợ")}
				}
			}
			if len(unknown) > 0 {
				// `badInput` with no override translates the shared headline, so the
				// envelope is not half-translated (English headline, Vietnamese
				// fieldErrors). The CODE stays `bad_input`.
				badInput(w, ctx, unknown)
				return
			}
			if err := json.Unmarshal(body, &in); err != nil {
				badJSONBody(w, ctx)
				return
			}
		}

		created, sErr := services.CreateDeviceShare(ctx, deps.DB, us.UserID, deviceID, in)
		if sErr != nil {
			writeDevicesErr(w, ctx, sErr, "create share")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusCreated, map[string]any{"share": created})
	}
}

func listSharesHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		deviceID := r.PathValue("id")
		if deviceID == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id thiết bị"), nil)
			return
		}
		shares, err := services.ListDeviceShares(ctx, deps.DB, us.UserID, deviceID)
		if err != nil {
			writeDevicesErr(w, ctx, err, "list shares")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"shares": shares})
	}
}

func revokeShareHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		if err := services.RevokeDeviceShare(ctx, deps.DB, us.UserID, r.PathValue("id")); err != nil {
			writeDevicesErr(w, ctx, err, "revoke share")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ---- public handler --------------------------------------------------------

func publicShareHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setShareHeaders(w)
		ctx := publicShareContext(r)
		// ONE language value for the whole response. It is read back out of the
		// context rather than re-derived, so the Content-Language header and every
		// rendered string cannot disagree — and it is set unconditionally, unlike
		// the JSON endpoints: a certificate has no "language-neutral" mode, and a
		// client that asked for nothing is still reading the `vi` fallback.
		lang, _ := i18n.FromContext(ctx)
		w.Header().Set("Content-Language", string(lang))

		// Rate limit BEFORE the lookup: an enumeration attempt must not reach the
		// database at all.
		rl, _ := ratelimit.CheckShareView(ctx, deps.Limiter, ratelimit.GetClientIP(r))
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		cert, err := services.ViewSharedCertificate(ctx, deps.DB, r.PathValue("token"))
		if err != nil {
			writeShareLookupFailure(w, ctx, r, lang, err)
			return
		}

		if shareWantsJSON(r) {
			httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"certificate": cert})
			return
		}
		// HTML is the DEFAULT: the recipient is a human holding a phone, and the
		// page must be printable/saveable as PDF without the web app being in the
		// loop. `Accept: application/json` opts into the JSON projection.
		writeShareHTML(w, http.StatusOK, sharePage{
			Lang:   lang,
			Cert:   buildSharePageData(cert, time.Now(), lang),
			Labels: newShareLabels(lang),
		})
	}
}

// writeShareLookupFailure renders the ONE failure answer shared by the unknown,
// expired, revoked and deleted-device cases.
//
// The JSON body is byte-identical for all of them and the HTML page shows the same
// sentence, so the response carries no signal about WHICH of them happened — that
// is the property that keeps the endpoint from being an enumeration oracle. Note
// the deliberate limit of the claim: a genuine server fault still answers 500 with
// its own message, because a broken query must stay visible to monitoring. That
// branch is never reachable by choosing a token, so it reveals nothing about any
// token; it is not, and is not meant to be, indistinguishable from the 404.
//
// i18n: the 404 sentence is rendered here, once, from the single error
// `services.ErrShareNotFound` produces. `services` deliberately keeps that error
// context-free (its doc comment says why), so the ONE language decision for all
// four cases is taken at this edge and applied identically to each of them — the
// indistinguishable-answer property is per language, and it holds in both.
// `lang` is passed in rather than re-derived so the page cannot render in a
// different language than the header advertises.
func writeShareLookupFailure(w http.ResponseWriter, ctx context.Context, r *http.Request, lang i18n.Tag, err error) {
	if svc, ok := services.As(err); ok && svc.Code == "NOT_FOUND" {
		// `svc.Message` is DATA — it arrives from a struct field rather than as a
		// literal at this call site — so it is rendered with `i18n.Translate` and an
		// empty argument list instead of the printf-shaped `i18n.T`/`i18n.Text`.
		// That is not a style preference: those two are classified as printf
		// wrappers by `go vet` (which `go test` runs), and a non-constant key is a
		// vet failure. No arguments are passed, so Sprintf never runs and a literal
		// `%` in the sentence would be safe.
		msg := i18n.Translate(lang, svc.Message, nil...)
		if shareWantsJSON(r) {
			httpx.WriteErrorC(w, ctx, http.StatusNotFound, "not_found", msg, nil)
			return
		}
		writeShareHTML(w, http.StatusNotFound, sharePage{
			NotFound: true, Message: msg, Labels: newShareLabels(lang), Lang: lang,
		})
		return
	}
	slog.Error("public share lookup failed", "err", err)
	// The same catalog sentence every JSON writer's 500 branch uses, rendered in
	// the certificate's language rather than a second Vietnamese literal: this is
	// the last place in the service where a generic failure could have shipped in
	// the source language to an English reader.
	oops := i18n.Translate(lang, "Lỗi hệ thống")
	if shareWantsJSON(r) {
		httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", oops, nil)
		return
	}
	writeShareHTML(w, http.StatusInternalServerError, sharePage{
		NotFound: true, Message: oops, Labels: newShareLabels(lang), Lang: lang,
	})
}

// shareWantsJSON reports whether the caller explicitly prefers JSON. HTML wins by
// default (browsers send `Accept: text/html,...`), so a stray `Accept: */*` from
// curl still renders the document instead of a wall of JSON.
func shareWantsJSON(r *http.Request) bool {
	accept := strings.ToLower(r.Header.Get("Accept"))
	return strings.Contains(accept, "application/json") && !strings.Contains(accept, "text/html")
}

// setShareHeaders is the cache/robots/referrer policy for the public document.
// Applied to failures too — a 404 must not be cached or indexed either.
func setShareHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, private, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	// Belt and braces with the <meta name="robots"> in the page: X-Robots-Tag
	// also covers the JSON response and any non-HTML consumer.
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex")
	// The token is in the path. Without this, clicking the vendor's locator link
	// would send the token to that vendor in the Referer header.
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	// The page is self-contained (no scripts, no remote assets), so
	// `default-src 'none'` costs nothing — and it means a future template
	// mistake still cannot make a third-party request.
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
}

// ---- HTML rendering --------------------------------------------------------

type sharePage struct {
	Cert     sharePageData
	NotFound bool
	Message  string
	// Labels is the page's own copy, already rendered in the page's language.
	// Nothing user-visible is left in the template: a static Vietnamese word in
	// shareTemplateHTML would be the one string a `?lang=en` recipient still reads
	// in Vietnamese, and the catalog test could not see it.
	Labels shareLabels
	// Lang is the page's language, carried so the one branch that runs with NO
	// page data (the template failing to execute) can still answer in it. See
	// writeShareHTML.
	Lang i18n.Tag
}

// sharePageData is the view model for the printable certificate. Assembled in Go
// so the template stays logic-free and the copy it needs is listed in one place.
//
// The three `template.HTML` fields are the ones whose catalog text carries MARKUP
// (a <strong> around the expiry date, muted spans around the serial and the
// phone). They are built by safeNote, which escapes every interpolated value, so
// the only unescaped bytes come from the catalog itself.
type sharePageData struct {
	DeviceName    string
	BrandModel    string
	SerialMasked  string
	SerialFull    string
	SerialFullRaw template.HTML
	PurchaseDate  string
	PurchasePlace string
	StatusLabel   string
	SoldAt        string
	WarrantyEnd   string
	WarrantyState string
	Warranties    []sharePageWarranty
	ExpiresAt     string
	IssuedAt      string
	// Disclaimer is the certificate's own statement of what it is not. A plain
	// string: it is catalog text with no interpolation, so the template escapes it
	// as it does every other value.
	Disclaimer string
	// Note is the link-lifetime sentence, which has a <strong> around the date in
	// BOTH languages — hence template.HTML, built by safeNote from the catalog text
	// plus the two escaped dates.
	Note template.HTML
}

type sharePageWarranty struct {
	TypeLabel string
	Provider  string
	Period    string
	Months    string
	Address   string
	// PhoneLine is the "ĐT: 0900…" / "Phone: 0900…" line, with the number escaped
	// and the label from the catalog. Empty means the number was not recorded, and
	// the template shows NoPhone instead.
	PhoneLine template.HTML
}

// shareLabels is every fixed string the certificate page needs, rendered for ONE
// language. It is built per request from the catalog rather than kept as two
// hand-written maps, so a key that is missing degrades to the Vietnamese source
// (the whole catalog contract) instead of to a blank.
//
// The three printf-shaped entries keep their `%s` placeholders: the page is the
// thing that knows the date or the number, so the placeholder is filled by the
// renderer with `i18n.Interpolate`, not here.
type shareLabels struct {
	Lang         string // <html lang="…">
	CertTitle    string // the document's <h1> and <title>
	CertSubtitle string
	RemainingTo  string
	SerialLabel  string
	PurchaseDate string
	PlaceLabel   string
	StatusLabel  string
	SoldAtLabel  string
	Warranties   string
	Period       string
	Centre       string
	NoPhone      string
	Valid        string // warranty state: still covered
	Expired      string // warranty state: lapsed
	// NotFoundHeading and NotFoundNote are the failure page. They say WHAT
	// happened without saying WHY: the four failure cases must stay
	// indistinguishable from each other in every language.
	NotFoundHeading string
	NotFoundNote    string
	// StatusLabels / WarrantyTypeLabels translate the enum codes the API stores
	// into words the recipient can read. Mirrors STATUS_LABELS /
	// WARRANTY_TYPE_LABELS in website/src/lib/types.ts, so the printed page and
	// the app cannot disagree. Unknown codes fall back to the raw code.
	StatusLabels       map[string]string
	WarrantyTypeLabels map[string]string
}

// sharePageKeys is every catalog key this page renders, named once. Each value is
// also the Vietnamese source text (that is how the catalog is keyed), so this
// block reads as the document's own copy and a reviewer can check the English
// column of catalog.go against it line by line.
var sharePageKeys = struct {
	CertTitle, CertSubtitle, RemainingTo, SerialLabel, SerialFull, PurchaseDate,
	PlaceLabel, StatusLabel, SoldAtLabel, Warranties, Period, Centre, Phone,
	NoPhone, NoEndDate, Valid, Expired, ExpiresNote, NotFoundHeading,
	NotFoundNote string
}{
	CertTitle:       "Phiếu bàn giao bảo hành",
	CertSubtitle:    "Thông tin bảo hành của một thiết bị, do chủ máy tạo từ Warranty Vault.",
	RemainingTo:     "Bảo hành còn lại tới",
	SerialLabel:     "Số máy (IMEI/serial)",
	SerialFull:      "đầy đủ: %s",
	PurchaseDate:    "Ngày mua",
	PlaceLabel:      "Nơi mua",
	StatusLabel:     "Trạng thái",
	SoldAtLabel:     "Ngày bán / bàn giao",
	Warranties:      "Gói bảo hành",
	Period:          "Thời gian",
	Centre:          "Nơi bảo hành",
	Phone:           "ĐT: %s",
	NoPhone:         "Chưa ghi số điện thoại",
	NoEndDate:       "Không có ngày hết hạn",
	Valid:           "Còn hiệu lực",
	Expired:         "Đã hết hạn",
	ExpiresNote:     "Link này hết hiệu lực sau ngày %s (tạo ngày %s) và có thể bị chủ máy thu hồi bất kỳ lúc nào.",
	NotFoundHeading: "Không mở được phiếu",
	NotFoundNote:    "Link chia sẻ có thời hạn và có thể đã bị chủ máy thu hồi. Hãy liên hệ người gửi link để lấy link mới.",
}

// shareStatusLabelKeys maps the API's status codes onto their catalog keys.
var shareStatusLabelKeys = map[string]string{
	"ACTIVE":  "Đang dùng",
	"EXPIRED": "Hết bảo hành",
	"SOLD":    "Đã bán",
	"BROKEN":  "Hỏng",
	"LOST":    "Mất",
}

// shareWarrantyTypeLabelKeys mirrors WARRANTY_TYPE_LABELS in the same file. The
// three values already exist in the catalog for the cron's warranty bucket, so
// this reuses those entries rather than inventing a second wording for one enum.
var shareWarrantyTypeLabelKeys = map[string]string{
	"STANDARD":    "Tiêu chuẩn",
	"EXTENDED":    "Mở rộng",
	"THIRD_PARTY": "Bên thứ ba",
}

// translateKeyData renders a catalog key that arrives as DATA (a struct field)
// rather than as a literal at the call site.
//
// It exists for the same reason handlers/auth.go::translateKey does: `i18n.T` is
// classified by `go vet`'s printf analyzer as a printf wrapper, and `go test` runs
// vet, so `T(ctx, k.CertTitle)` — a variable — is rejected even with no arguments.
// `i18n.Translate` has the variadic tail but is called here with a nil arg list;
// the printf path is not taken, so a literal `%` in a translation is safe.
func translateKeyData(tag i18n.Tag, key string) string {
	return i18n.Translate(tag, key, nil...)
}

// formatCatalogText fills a printf-shaped catalog entry's placeholders in order.
//
// `i18n.Interpolate` cannot be used directly for the entries whose text carries
// MARKUP (the serial number's "(đầy đủ: …)", the phone line, and the footer's
// "… sau ngày <strong>{date}</strong> …"): those are rendered into an
// `html/template` document, so either the markup has to survive as markup or the
// sentence has to be split into several catalog entries with the HTML in the middle
// of it. This helper takes the first route and contains the risk: the CATALOG text
// is trusted, each ARGUMENT is escaped with `html.EscapeString` and then marked
// safe, so a device name or a date can never inject anything. `escape` exists so the
// non-markup caller (shareMonths) can use the same helper without the blessing.
//
// Both `%s` and `%d` are accepted as placeholders. The verb matters: the month
// counts are "%d tháng" / "%d months", and an earlier version of this helper split
// on `%s` alone, which left the literal "%d tháng" on the page. The catalog test
// already pins that both languages of one key use the SAME verb set, so the verb
// letter never changes how many arguments are consumed.
func formatCatalogText(tag i18n.Tag, key string, args []any, escape func(string) string) string {
	text, ok := i18n.Lookup(tag, key)
	if !ok {
		text = key
	}
	placeholders := printfVerbs.FindAllStringIndex(text, -1)
	if len(placeholders) != len(args) {
		// The catalog test pins the verb sets of both languages, so this is
		// unreachable in practice; returning the raw text is better than losing the
		// sentence or panicking on a page a stranger is reading.
		return text
	}
	var b strings.Builder
	last := 0
	for i, loc := range placeholders {
		b.WriteString(text[last:loc[0]])
		b.WriteString(escape(fmt.Sprint(args[i])))
		last = loc[1]
	}
	b.WriteString(text[last:])
	return b.String()
}

// printfVerbs matches one non-positional Sprintf verb. `%%` is not a verb (the
// pattern cannot match a `%` that follows a `%`), so a literal percent in a
// translation cannot shift the argument list.
var printfVerbs = regexp.MustCompile(`%[^%]`)

// safeNote renders a catalog sentence whose placeholders must survive as HTML.
// See formatCatalogText.
func safeNote(tag i18n.Tag, key string, args ...any) template.HTML {
	//nolint:gosec // the catalog text is trusted and every argument is escaped.
	return template.HTML(formatCatalogText(tag, key, args, html.EscapeString))
}

// newShareLabels renders the whole page in `tag`. The constructor is named with a
// `new` prefix because a Go function and a type cannot share one identifier in the
// same package — `shareLabels` is the type.
func newShareLabels(tag i18n.Tag) shareLabels {
	k := sharePageKeys
	labels := shareLabels{
		Lang:               string(tag),
		CertTitle:          translateKeyData(tag, k.CertTitle),
		CertSubtitle:       translateKeyData(tag, k.CertSubtitle),
		RemainingTo:        translateKeyData(tag, k.RemainingTo),
		SerialLabel:        translateKeyData(tag, k.SerialLabel),
		PurchaseDate:       translateKeyData(tag, k.PurchaseDate),
		PlaceLabel:         translateKeyData(tag, k.PlaceLabel),
		StatusLabel:        translateKeyData(tag, k.StatusLabel),
		SoldAtLabel:        translateKeyData(tag, k.SoldAtLabel),
		Warranties:         translateKeyData(tag, k.Warranties),
		Period:             translateKeyData(tag, k.Period),
		Centre:             translateKeyData(tag, k.Centre),
		NoPhone:            translateKeyData(tag, k.NoPhone),
		Valid:              translateKeyData(tag, k.Valid),
		Expired:            translateKeyData(tag, k.Expired),
		NotFoundHeading:    translateKeyData(tag, k.NotFoundHeading),
		NotFoundNote:       translateKeyData(tag, k.NotFoundNote),
		StatusLabels:       make(map[string]string, len(shareStatusLabelKeys)),
		WarrantyTypeLabels: make(map[string]string, len(shareWarrantyTypeLabelKeys)),
	}
	for code, key := range shareStatusLabelKeys {
		labels.StatusLabels[code] = translateKeyData(tag, key)
	}
	for code, key := range shareWarrantyTypeLabelKeys {
		labels.WarrantyTypeLabels[code] = translateKeyData(tag, key)
	}
	return labels
}

// buildSharePageData assembles the view model. `tag` is the page's language and
// decides the date FORMAT as well as the words (see shareDate).
func buildSharePageData(c *services.SharedCertificate, now time.Time, tag i18n.Tag) sharePageData {
	d := sharePageData{DeviceName: c.DeviceName}
	parts := make([]string, 0, 2)
	if c.Brand != nil {
		parts = append(parts, *c.Brand)
	}
	if c.Model != nil {
		parts = append(parts, *c.Model)
	}
	d.BrandModel = strings.Join(parts, " ")
	if c.SerialMasked != nil {
		d.SerialMasked = *c.SerialMasked
	}
	if c.SerialNumber != nil {
		d.SerialFull = *c.SerialNumber
		d.SerialFullRaw = safeNote(tag, sharePageKeys.SerialFull, *c.SerialNumber)
	}
	d.PurchaseDate = shareDate(tag, c.PurchaseDate)
	if c.PurchasePlace != nil {
		d.PurchasePlace = *c.PurchasePlace
	}
	if label, ok := shareStatusLabelKeys[c.Status]; ok {
		d.StatusLabel = translateKeyData(tag, label)
	} else {
		d.StatusLabel = c.Status
	}
	if c.SoldAt != nil {
		d.SoldAt = shareDate(tag, *c.SoldAt)
	}
	if c.EffectiveWarrantyEnd != nil {
		end := *c.EffectiveWarrantyEnd
		d.WarrantyEnd = shareDate(tag, end)
		d.WarrantyState = warrantyStateLabel(tag, end, now)
	} else {
		d.WarrantyState = translateKeyData(tag, sharePageKeys.NoEndDate)
	}
	for _, w := range c.Warranties {
		label, ok := shareWarrantyTypeLabelKeys[w.Type]
		if !ok {
			label = w.Type
		} else {
			label = translateKeyData(tag, label)
		}
		row := sharePageWarranty{
			TypeLabel: label,
			Period:    strings.TrimSpace(shareDate(tag, w.StartDate) + " — " + shareDate(tag, w.EndDate)),
			Months:    shareMonths(tag, w.Months),
		}
		if w.Provider != nil {
			row.Provider = *w.Provider
		}
		if w.Address != nil {
			row.Address = *w.Address
		}
		if w.Phone != nil {
			row.PhoneLine = safeNote(tag, sharePageKeys.Phone, *w.Phone)
		}
		d.Warranties = append(d.Warranties, row)
	}
	d.ExpiresAt = shareDate(tag, c.ExpiresAt)
	d.IssuedAt = shareDate(tag, c.IssuedAt)
	// The footer is ONE paragraph in the original document: the disclaimer, a line
	// break, then the lifetime sentence. Kept as two fields with the <br> in the
	// template, because the two sentences are two catalog entries (they already
	// were) and the break is a layout decision, not copy.
	d.Disclaimer = c.Disclaimer
	d.Note = safeNote(tag, sharePageKeys.ExpiresNote, d.ExpiresAt, d.IssuedAt)
	return d
}

// shareDate renders an RFC3339 instant as the language's short date: dd/MM/yyyy in
// Vietnamese, MM/DD/yyyy in English (i18n.FormatDate, the same helper the cron
// push bodies and the subscription audit use). An unparsable value renders as
// empty rather than raw: the certificate is read by a stranger, and
// "2027-01-15T00:00:00Z" in the middle of a sentence helps nobody.
//
// It replaces the wave-3-era `viDate`, which hardcoded format "02/01/2006". The
// two formats are genuinely ambiguous against each other, which is exactly why the
// date has to follow the page's language: "05/07/2026" is 5 July to a Vietnamese
// reader and 7 May to an English one, and this page is the one a buyer keeps.
func shareDate(tag i18n.Tag, s string) string {
	if s == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return ""
	}
	return i18n.FormatDate(tag, t)
}

// shareMonths renders a warranty duration in months. Vietnamese does not inflect
// ("24 tháng", and "1 tháng" is the same word); English does ("24 months" vs
// "1 month"), so this is a separate-key PAIR with a separate argument list per
// key — the shape docs/I18N_PLAN.md §3.1 requires for plurals. 0 and negative
// render as empty, as they always have.
func shareMonths(tag i18n.Tag, n int32) string {
	if n <= 0 {
		return ""
	}
	key := "%d tháng"
	if n == 1 {
		key = "1 tháng"
	}
	// Filled with the count the same way the note above is: the catalog text is
	// trusted, the count is a number.
	return formatCatalogText(tag, key, []any{n}, func(s string) string { return s })
}

// warrantyStateLabel is computed against the request time, so the page cannot
// claim "Còn hiệu lực" for a package that already lapsed.
func warrantyStateLabel(tag i18n.Tag, end string, now time.Time) string {
	t, err := time.Parse(time.RFC3339, end)
	if err != nil {
		return ""
	}
	if t.After(now) {
		return translateKeyData(tag, sharePageKeys.Valid)
	}
	return translateKeyData(tag, sharePageKeys.Expired)
}

var shareTemplate = template.Must(template.New("share").Parse(shareTemplateHTML))

func writeShareHTML(w http.ResponseWriter, status int, p sharePage) {
	var buf bytes.Buffer
	if err := shareTemplate.Execute(&buf, p); err != nil {
		slog.Error("render share html", "err", err)
		// A plain-text 500 from net/http, so it cannot go through the catalog
		// renderer for a header — but the SENTENCE is still the shared one, in the
		// page's language, because the recipient is a human holding the link.
		http.Error(w, i18n.Translate(p.Lang, "Lỗi hệ thống"), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(buf.Bytes())
}

// shareTemplateHTML is a single self-contained document: no scripts, no remote
// CSS, no fonts, no images. That is a security property (CSP `default-src 'none'`
// holds) and a durability property — the link keeps working even if the web app is
// redeployed or removed, which matters for something the recipient may print and
// file away.
//
// `html/template` escapes every interpolated value, so a device name or warranty
// provider containing markup cannot inject anything. The three values that are
// NOT escaped here (.Cert.SerialFullRaw, .Warranty.PhoneLine, .Cert.Note) are
// `template.HTML` produced by safeNote, which escapes every argument it fills in —
// see its doc comment.
//
// There is no user-facing LITERAL in this template. Every word comes from
// sharePage.Labels or from the view model, both rendered in the page's language;
// a hardcoded Vietnamese word here would be the one string a `?lang=en` recipient
// still reads in Vietnamese, and the catalog test could not see it.
const shareTemplateHTML = `<!doctype html>
<html lang="{{.Labels.Lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<title>{{.Labels.CertTitle}}{{if .Cert.DeviceName}} — {{.Cert.DeviceName}}{{end}}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 48px; background: #f4f4f5; color: #18181b;
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  .sheet { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #e4e4e7;
           border-radius: 12px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #52525b; font-size: 13px; margin: 0 0 20px; }
  .device { font-size: 17px; font-weight: 600; margin: 0 0 2px; }
  .brand { color: #52525b; margin: 0 0 16px; }
  dl { display: grid; grid-template-columns: minmax(140px, max-content) 1fr; gap: 6px 16px; margin: 0 0 20px; }
  dt { color: #52525b; font-size: 13px; }
  dd { margin: 0; }
  .highlight { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 12px 14px; margin: 0 0 20px; }
  .highlight .label { color: #166534; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .highlight .value { font-size: 18px; font-weight: 600; }
  .highlight .state { color: #3f3f46; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 20px; }
  th, td { text-align: left; border-bottom: 1px solid #e4e4e7; padding: 8px 6px; vertical-align: top; font-size: 14px; }
  th { color: #52525b; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .muted { color: #71717a; font-size: 12px; }
  .note { border-top: 1px solid #e4e4e7; padding-top: 14px; color: #52525b; font-size: 12px; }
  .error { text-align: center; padding: 40px 8px; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: 0; border-radius: 0; padding: 0; max-width: none; }
  }
</style>
</head>
<body>
<div class="sheet">
{{if .NotFound}}
  <div class="error">
    <h1>{{.Labels.NotFoundHeading}}</h1>
    <p class="sub">{{.Message}}</p>
    <p class="muted">{{.Labels.NotFoundNote}}</p>
  </div>
{{else}}
  <h1>{{.Labels.CertTitle}}</h1>
  <p class="sub">{{.Labels.CertSubtitle}}</p>

  <p class="device">{{.Cert.DeviceName}}</p>
  {{if .Cert.BrandModel}}<p class="brand">{{.Cert.BrandModel}}</p>{{end}}

  <div class="highlight">
    <div class="label">{{.Labels.RemainingTo}}</div>
    <div class="value">{{if .Cert.WarrantyEnd}}{{.Cert.WarrantyEnd}}{{else}}—{{end}}</div>
    <div class="state">{{.Cert.WarrantyState}}</div>
  </div>

  <dl>
    {{if .Cert.SerialMasked}}<dt>{{.Labels.SerialLabel}}</dt><dd>{{.Cert.SerialMasked}}{{if .Cert.SerialFull}} <span class="muted">({{.Cert.SerialFullRaw}})</span>{{end}}</dd>{{end}}
    <dt>{{.Labels.PurchaseDate}}</dt><dd>{{if .Cert.PurchaseDate}}{{.Cert.PurchaseDate}}{{else}}—{{end}}</dd>
    {{if .Cert.PurchasePlace}}<dt>{{.Labels.PlaceLabel}}</dt><dd>{{.Cert.PurchasePlace}}</dd>{{end}}
    <dt>{{.Labels.StatusLabel}}</dt><dd>{{.Cert.StatusLabel}}</dd>
    {{if .Cert.SoldAt}}<dt>{{.Labels.SoldAtLabel}}</dt><dd>{{.Cert.SoldAt}}</dd>{{end}}
  </dl>

  <table>
    <thead><tr><th>{{.Labels.Warranties}}</th><th>{{.Labels.Period}}</th><th>{{.Labels.Centre}}</th></tr></thead>
    <tbody>
    {{range .Cert.Warranties}}
      <tr>
        <td>{{.TypeLabel}}{{if .Months}}<br><span class="muted">{{.Months}}</span>{{end}}</td>
        <td>{{.Period}}</td>
        <td>
          {{if .Provider}}{{.Provider}}<br>{{end}}
          {{if .Address}}<span class="muted">{{.Address}}</span><br>{{end}}
          {{if .PhoneLine}}<span class="muted">{{.PhoneLine}}</span>{{else}}<span class="muted">{{$.Labels.NoPhone}}</span>{{end}}
        </td>
      </tr>
    {{end}}
    </tbody>
  </table>

  <p class="note">
    {{.Cert.Disclaimer}}<br>
    {{.Cert.Note}}
  </p>
{{end}}
</div>
</body>
</html>
`
