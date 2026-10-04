package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
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
func RegisterShares(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("POST /api/v1/devices/{id}/shares", requireUser(http.HandlerFunc(createShareHandler(deps))))
	mux.Handle("GET /api/v1/devices/{id}/shares", requireUser(http.HandlerFunc(listSharesHandler(deps))))
	mux.Handle("DELETE /api/v1/shares/{id}", requireUser(http.HandlerFunc(revokeShareHandler(deps))))

	// Unauthenticated by design. See the doc comment above.
	mux.HandleFunc("GET /api/v1/public/shares/{token}", publicShareHandler(deps))
}

// ---- owner handlers --------------------------------------------------------

func createShareHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		deviceID := r.PathValue("id")
		if deviceID == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Thiếu id thiết bị", nil)
			return
		}

		// An empty body is valid and means "all defaults": a client that just
		// wants a 30-day link should not have to send `{}`. Unknown keys are
		// rejected with a field-level Vietnamese message, the same contract the
		// PATCH /attachments handler uses, so a typo like `expiresInDay` cannot
		// silently produce a link with the default lifetime.
		in := services.CreateShareInput{}
		body, rerr := io.ReadAll(io.LimitReader(r.Body, maxShareCreateBody+1))
		if rerr != nil {
			badJSONBody(w, ctx)
			return
		}
		if len(body) > maxShareCreateBody {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Body quá lớn", nil)
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
					unknown[k] = []string{"Trường không được hỗ trợ"}
				}
			}
			if len(unknown) > 0 {
				badInput(w, ctx, unknown, "Dữ liệu không hợp lệ")
				return
			}
			if err := json.Unmarshal(body, &in); err != nil {
				badJSONBody(w, ctx)
				return
			}
		}

		created, sErr := services.CreateDeviceShare(r.Context(), deps.DB, us.UserID, deviceID, in)
		if sErr != nil {
			writeDevicesErr(w, ctx, sErr, "create share")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"share": created})
	}
}

func listSharesHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		deviceID := r.PathValue("id")
		if deviceID == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Thiếu id thiết bị", nil)
			return
		}
		shares, err := services.ListDeviceShares(r.Context(), deps.DB, us.UserID, deviceID)
		if err != nil {
			writeDevicesErr(w, ctx, err, "list shares")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"shares": shares})
	}
}

func revokeShareHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		if err := services.RevokeDeviceShare(r.Context(), deps.DB, us.UserID, r.PathValue("id")); err != nil {
			writeDevicesErr(w, ctx, err, "revoke share")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ---- public handler --------------------------------------------------------

func publicShareHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		setShareHeaders(w)

		// Rate limit BEFORE the lookup: an enumeration attempt must not reach the
		// database at all.
		rl, _ := ratelimit.CheckShareView(r.Context(), deps.Limiter, ratelimit.GetClientIP(r))
		if !rl.Ok {
			rateLimited(w, r.Context(), rl.RetryAfterSec)
			return
		}

		cert, err := services.ViewSharedCertificate(r.Context(), deps.DB, r.PathValue("token"))
		if err != nil {
			writeShareLookupFailure(w, ctx, r, err)
			return
		}

		if shareWantsJSON(r) {
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"certificate": cert})
			return
		}
		// HTML is the DEFAULT: the recipient is a human holding a phone, and the
		// page must be printable/saveable as PDF without the web app being in the
		// loop. `Accept: application/json` opts into the JSON projection.
		writeShareHTML(w, http.StatusOK, sharePage{Cert: buildSharePageData(cert, time.Now())})
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
func writeShareLookupFailure(w http.ResponseWriter, ctx context.Context, r *http.Request, err error) {
	if svc, ok := services.As(err); ok && svc.Code == "NOT_FOUND" {
		if shareWantsJSON(r) {
			httpx.WriteErrorC(w, ctx, http.StatusNotFound, "not_found", svc.Message, nil)
			return
		}
		writeShareHTML(w, http.StatusNotFound, sharePage{NotFound: true, Message: svc.Message})
		return
	}
	slog.Error("public share lookup failed", "err", err)
	if shareWantsJSON(r) {
		httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
		return
	}
	writeShareHTML(w, http.StatusInternalServerError, sharePage{
		NotFound: true, Message: "Lỗi hệ thống",
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
}

// sharePageData is the view model for the printable certificate. Assembled in Go
// so the template stays logic-free and every Vietnamese string lives in one file.
type sharePageData struct {
	DeviceName    string
	BrandModel    string
	SerialMasked  string
	SerialFull    string
	PurchaseDate  string
	PurchasePlace string
	StatusLabel   string
	SoldAt        string
	WarrantyEnd   string
	WarrantyState string
	Warranties    []sharePageWarranty
	ExpiresAt     string
	IssuedAt      string
	Disclaimer    string
}

type sharePageWarranty struct {
	TypeLabel string
	Provider  string
	Period    string
	Months    string
	Address   string
	Phone     string
}

// Certificate labels. The certificate is a standalone document that has to read
// correctly on its own, so it carries Vietnamese words rather than the raw enum
// codes the API stores. Mirrors STATUS_LABELS / WARRANTY_TYPE_LABELS in
// website/src/lib/types.ts so the printed page and the app cannot disagree.
var shareStatusLabels = map[string]string{
	"ACTIVE":  "Đang dùng",
	"EXPIRED": "Hết bảo hành",
	"SOLD":    "Đã bán",
	"BROKEN":  "Hỏng",
	"LOST":    "Mất",
}

var shareWarrantyTypeLabels = map[string]string{
	"STANDARD":    "Tiêu chuẩn",
	"EXTENDED":    "Mở rộng",
	"THIRD_PARTY": "Bên thứ ba",
}

func buildSharePageData(c *services.SharedCertificate, now time.Time) sharePageData {
	d := sharePageData{DeviceName: c.DeviceName, Disclaimer: c.Disclaimer}
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
	}
	d.PurchaseDate = viDate(c.PurchaseDate)
	if c.PurchasePlace != nil {
		d.PurchasePlace = *c.PurchasePlace
	}
	if label, ok := shareStatusLabels[c.Status]; ok {
		d.StatusLabel = label
	} else {
		d.StatusLabel = c.Status
	}
	if c.SoldAt != nil {
		d.SoldAt = viDate(*c.SoldAt)
	}
	if c.EffectiveWarrantyEnd != nil {
		end := *c.EffectiveWarrantyEnd
		d.WarrantyEnd = viDate(end)
		d.WarrantyState = warrantyStateLabel(end, now)
	} else {
		d.WarrantyState = "Không có ngày hết hạn"
	}
	for _, w := range c.Warranties {
		label, ok := shareWarrantyTypeLabels[w.Type]
		if !ok {
			label = w.Type
		}
		row := sharePageWarranty{
			TypeLabel: label,
			Period:    strings.TrimSpace(viDate(w.StartDate) + " — " + viDate(w.EndDate)),
			Months:    viMonths(w.Months),
		}
		if w.Provider != nil {
			row.Provider = *w.Provider
		}
		if w.Address != nil {
			row.Address = *w.Address
		}
		if w.Phone != nil {
			row.Phone = *w.Phone
		}
		d.Warranties = append(d.Warranties, row)
	}
	d.ExpiresAt = viDate(c.ExpiresAt)
	d.IssuedAt = viDate(c.IssuedAt)
	return d
}

// viDate renders an RFC3339 instant as dd/MM/yyyy. An unparsable value renders as
// empty rather than raw: the certificate is read by a stranger, and
// "2027-01-15T00:00:00Z" in the middle of a Vietnamese sentence helps nobody.
func viDate(s string) string {
	if s == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return ""
	}
	return t.Format("02/01/2006")
}

func viMonths(n int32) string {
	if n <= 0 {
		return ""
	}
	return strconvItoa(int(n)) + " tháng"
}

// warrantyStateLabel is computed against the request time, so the page cannot
// claim "Còn hiệu lực" for a package that already lapsed.
func warrantyStateLabel(end string, now time.Time) string {
	t, err := time.Parse(time.RFC3339, end)
	if err != nil {
		return ""
	}
	if t.After(now) {
		return "Còn hiệu lực"
	}
	return "Đã hết hạn"
}

var shareTemplate = template.Must(template.New("share").Parse(shareTemplateHTML))

func writeShareHTML(w http.ResponseWriter, status int, p sharePage) {
	var buf bytes.Buffer
	if err := shareTemplate.Execute(&buf, p); err != nil {
		slog.Error("render share html", "err", err)
		http.Error(w, "Lỗi hệ thống", http.StatusInternalServerError)
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
// provider containing markup cannot inject anything.
const shareTemplateHTML = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<title>Phiếu bàn giao bảo hành{{if .Cert.DeviceName}} — {{.Cert.DeviceName}}{{end}}</title>
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
    <h1>Không mở được phiếu</h1>
    <p class="sub">{{.Message}}</p>
    <p class="muted">Link chia sẻ có thời hạn và có thể đã bị chủ máy thu hồi. Hãy liên hệ người gửi link để lấy link mới.</p>
  </div>
{{else}}
  <h1>Phiếu bàn giao bảo hành</h1>
  <p class="sub">Thông tin bảo hành của một thiết bị, do chủ máy tạo từ Warranty Vault.</p>

  <p class="device">{{.Cert.DeviceName}}</p>
  {{if .Cert.BrandModel}}<p class="brand">{{.Cert.BrandModel}}</p>{{end}}

  <div class="highlight">
    <div class="label">Bảo hành còn lại tới</div>
    <div class="value">{{if .Cert.WarrantyEnd}}{{.Cert.WarrantyEnd}}{{else}}—{{end}}</div>
    <div class="state">{{.Cert.WarrantyState}}</div>
  </div>

  <dl>
    {{if .Cert.SerialMasked}}<dt>Số máy (IMEI/serial)</dt><dd>{{.Cert.SerialMasked}}{{if .Cert.SerialFull}} <span class="muted">(đầy đủ: {{.Cert.SerialFull}})</span>{{end}}</dd>{{end}}
    <dt>Ngày mua</dt><dd>{{if .Cert.PurchaseDate}}{{.Cert.PurchaseDate}}{{else}}—{{end}}</dd>
    {{if .Cert.PurchasePlace}}<dt>Nơi mua</dt><dd>{{.Cert.PurchasePlace}}</dd>{{end}}
    <dt>Trạng thái</dt><dd>{{.Cert.StatusLabel}}</dd>
    {{if .Cert.SoldAt}}<dt>Ngày bán / bàn giao</dt><dd>{{.Cert.SoldAt}}</dd>{{end}}
  </dl>

  <table>
    <thead><tr><th>Gói bảo hành</th><th>Thời gian</th><th>Nơi bảo hành</th></tr></thead>
    <tbody>
    {{range .Cert.Warranties}}
      <tr>
        <td>{{.TypeLabel}}{{if .Months}}<br><span class="muted">{{.Months}}</span>{{end}}</td>
        <td>{{.Period}}</td>
        <td>
          {{if .Provider}}{{.Provider}}<br>{{end}}
          {{if .Address}}<span class="muted">{{.Address}}</span><br>{{end}}
          {{if .Phone}}<span class="muted">ĐT: {{.Phone}}</span>{{else}}<span class="muted">Chưa ghi số điện thoại</span>{{end}}
        </td>
      </tr>
    {{end}}
    </tbody>
  </table>

  <p class="note">
    {{.Cert.Disclaimer}}<br>
    Link này hết hiệu lực sau ngày <strong>{{.Cert.ExpiresAt}}</strong> (tạo ngày {{.Cert.IssuedAt}}) và có thể bị chủ máy thu hồi bất kỳ lúc nào.
  </p>
{{end}}
</div>
</body>
</html>
`
