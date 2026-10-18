package handlers

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Provider-agnostic inbound email — POST /api/v1/inbox/email.
//
// This handler owns the TRANSPORT and the provider authentication. It knows no
// vendor's payload: it accepts a neutral message in one of two shapes and hands
// the bytes to services.ReceiveInboundEmail, which reuses the normal attachment
// upload pipeline.
//
//   - multipart/form-data is the PRIMARY shape. It streams the file bytes without
//     base64 (33% smaller on the wire), mirrors POST /api/v1/attachments, and is
//     the easiest thing for a mail worker (Cloudflare Email Worker, Postmark
//     inbound webhook adapter, a forwarder script) to build. A provider that can
//     only emit JSON is served by the second shape.
//   - application/json with base64 attachments is the SECONDARY shape. It exists
//     because some providers/queues hand you an object, and supporting it costs
//     one small decoder; the service below is identical for both.
//
// # Authentication
//
// There is no bearer token on this route: the sender is a mail provider, not a
// Warrly user. The caller proves itself with the shared secret in
// X-Warrly-Inbox-Token, compared against INBOX_EMAIL_TOKEN in constant time. The
// RECIPIENT is authenticated separately by the address itself: the local part is
// a 122-bit per-user secret (migration 0020), so the shared secret alone cannot
// direct mail into an arbitrary account.
//
// When INBOX_EMAIL_TOKEN or INBOX_EMAIL_DOMAIN is missing the route answers 503
// feature_disabled and the server still boots — the same contract
// ANTHROPIC_API_KEY has for OCR.
//
// # What the endpoint is NOT
//
// It is not idempotent: there is no message id in the neutral shape, so a provider
// retry duplicates whatever already landed. It never reads or lists a user's
// inbox — it is append-only. The 404 for an unresolved recipient is deliberately
// identical for every failure mode, so it cannot be used to test whether an
// address exists (the same rule the public share token follows).

const (
	// inboxTokenHeader is the shared-secret header. Exact name is contract.
	inboxTokenHeader = "X-Warrly-Inbox-Token"

	// maxInboundMultipartBytes bounds the whole multipart envelope. Ten
	// attachments at the 5 MB per-file cap are 50 MB; the rest is boundaries and
	// the small text fields. It is a safety net, not the per-file limit — that one
	// belongs to services.Upload and is reported per attachment.
	maxInboundMultipartBytes = 55 << 20

	// maxInboundJSONBytes bounds the JSON envelope. Base64 inflates 50 MB of
	// bytes to ~67 MB, so this is the multipart cap plus the encoding overhead.
	maxInboundJSONBytes = 70 << 20

	// maxInboundMultipartMemory is how much of a multipart body ParseMultipartForm
	// keeps in RAM before spilling file parts to temp files. 16 MB covers the
	// common one-PDF receipt without writing to disk, while a 10-file envelope
	// does not sit in memory.
	maxInboundMultipartMemory = 16 << 20
)

// RegisterInboxEmail wires the inbound-email route. It is deliberately NOT
// behind auth.RequireUser: the provider has no user session. Per-IP rate limiting
// and the shared-secret check live inside the handler.
func RegisterInboxEmail(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc("POST /api/v1/inbox/email", inboundEmailHandler(deps))
}

func inboundEmailHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// i18n.Attach resolves ?lang= / Accept-Language even in tests that build a
		// bare mux, like every other converted handler.
		ctx := i18n.Attach(r)

		cfg := services.InboundEmailConfigFromEnv()
		if !cfg.Enabled() {
			httpx.WriteErrorC(w, ctx, http.StatusServiceUnavailable, "feature_disabled",
				i18n.Text(ctx, "Tính năng nhận email chưa được bật"), nil)
			return
		}

		// Rate limit BEFORE the secret check: a bad secret must not give an
		// attacker an unlimited number of guesses. The bucket is keyed by IP, the
		// same shape the public share endpoint uses.
		rl, _ := ratelimit.CheckInboundEmail(ctx, d.Limiter, ratelimit.GetClientIP(r))
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		if !inboxTokenMatches(r.Header.Get(inboxTokenHeader), cfg.Token) {
			// Same body for a missing and a wrong header; no detail about the
			// configured secret, not even its length.
			httpx.WriteErrorC(w, ctx, http.StatusUnauthorized, "unauthorized",
				i18n.Text(ctx, "Token inbox không hợp lệ"), nil)
			return
		}

		in, err := parseInboundEmailRequest(w, r, ctx)
		if err != nil {
			if errors.Is(err, errInboundRequestTooLarge) {
				httpx.WriteErrorC(w, ctx, http.StatusRequestEntityTooLarge, "bad_input",
					i18n.Text(ctx, "Body quá lớn"), nil)
				return
			}
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", err.Error(), nil)
			return
		}

		result, sErr := services.ReceiveInboundEmail(ctx, d.DB, cfg.Domain, in)
		if sErr != nil {
			// A too-many-parts refusal is an AttachmentError (400); an unresolved
			// recipient is a services.* NOT_FOUND (404, one indistinguishable body).
			if _, ok := services.AsAttachmentError(sErr); ok {
				writeAttachmentError(w, ctx, sErr)
				return
			}
			writeServiceError(w, ctx, sErr, "inbound email")
			return
		}

		// A total infrastructure failure must not look like a delivered message.
		// Validation and quota skips are permanent — retrying cannot help, so they
		// stay a 200 with reasons. But if NOTHING was stored and at least one part
		// failed with an internal error (missing FILE_MASTER_KEY, disk/DB trouble),
		// answer 500 so the provider retries: no row exists yet, so the retry cannot
		// duplicate anything. Once one part has landed, a retry WOULD duplicate it,
		// so partial success stays a 200 with the failed part in `skipped`.
		if len(result.Attachments) == 0 && hasInternalSkip(result.Skipped) {
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error",
				i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		// Same AttachmentMeta projection the inbox list and the upload endpoint
		// use, so a client needs no second decoder for mail-delivered items.
		out := make([]attachmentDTO, 0, len(result.Attachments))
		for _, att := range result.Attachments {
			out = append(out, toAttachmentDTO(att))
		}
		skipped := result.Skipped
		if skipped == nil {
			skipped = []services.InboundEmailSkipped{}
		}

		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{
			"ok":          true,
			"attachments": out,
			"skipped":     skipped,
			// received counts every part in the message, including the ones in
			// skipped. stored + skippedCount == received, which is what lets a
			// caller distinguish "empty email" from "all parts refused".
			"received":     len(in.Attachments),
			"stored":       len(out),
			"skippedCount": len(skipped),
		})
	}
}

// inboxTokenMatches compares the provider secret in constant time.
//
// Both sides are hashed first. subtle.ConstantTimeCompare returns immediately
// when the two slices have different lengths, which would leak the length of the
// configured secret through timing; SHA-256 makes both sides 32 bytes so the
// comparison itself is the only work that depends on the input. An empty
// configured secret never matches (the handler already 503s, but this keeps the
// helper safe on its own).
func inboxTokenMatches(got, want string) bool {
	if want == "" {
		return false
	}
	gotSum := sha256.Sum256([]byte(strings.TrimSpace(got)))
	wantSum := sha256.Sum256([]byte(want))
	return subtle.ConstantTimeCompare(gotSum[:], wantSum[:]) == 1
}

// errInboundRequestTooLarge distinguishes "the envelope exceeded the cap" (413)
// from every other parse refusal (400) without string matching.
var errInboundRequestTooLarge = errors.New("inbound email request too large")

// parseInboundEmailRequest decodes either supported shape into the neutral input.
//
// A part that cannot be decoded (invalid base64, unreadable multipart part) is
// NOT a request error: it becomes an attachment with SkipReason set, so the
// service records it in `skipped` and the rest of the message still lands. Only
// things that make the whole message unreadable — wrong content type, broken JSON,
// malformed multipart framing, too many parts, an envelope over the cap — are
// 400/413.
func parseInboundEmailRequest(w http.ResponseWriter, r *http.Request, ctx context.Context) (services.InboundEmailInput, error) {
	ct := strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type")))
	switch {
	case strings.HasPrefix(ct, "multipart/form-data"):
		return parseInboundMultipart(w, r, ctx)
	case strings.HasPrefix(ct, "application/json"):
		return parseInboundJSON(w, r, ctx)
	default:
		return services.InboundEmailInput{}, errors.New(
			i18n.Text(ctx, "Content-Type phải là multipart/form-data hoặc application/json"))
	}
}

func parseInboundMultipart(w http.ResponseWriter, r *http.Request, ctx context.Context) (services.InboundEmailInput, error) {
	var in services.InboundEmailInput
	r.Body = http.MaxBytesReader(w, r.Body, maxInboundMultipartBytes)
	if err := r.ParseMultipartForm(maxInboundMultipartMemory); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return in, errInboundRequestTooLarge
		}
		return in, errors.New(i18n.Text(ctx, "Không đọc được multipart payload"))
	}
	if r.MultipartForm != nil {
		defer func() { _ = r.MultipartForm.RemoveAll() }()
	}

	// A missing `to` is a malformed request, not an unknown recipient: 400 here,
	// while anything that names a recipient but does not resolve is the 404 from
	// the service. Neither branch reveals whether an address exists.
	//
	// Read the fields from MultipartForm.Value rather than r.FormValue: FormValue
	// merges the URL query string in, and the recipient address IS a credential —
	// accepting it from `?to=` would put inbox tokens into proxy/access logs for no
	// reason. The body is the only place this endpoint looks.
	in.To = strings.TrimSpace(multipartField(r, "to"))
	in.From = strings.TrimSpace(multipartField(r, "from"))
	in.Subject = multipartField(r, "subject")
	in.Text = multipartField(r, "text")
	if in.To == "" {
		return in, errors.New(i18n.Text(ctx, "Thiếu địa chỉ nhận (to)"))
	}

	if r.MultipartForm == nil {
		return in, errors.New(i18n.Text(ctx, "Không đọc được multipart payload"))
	}
	files := r.MultipartForm.File["attachment"]
	if len(files) > services.MaxInboundEmailAttachments {
		return in, errors.New(i18n.T(ctx,
			"Quá nhiều file đính kèm (tối đa %d)", services.MaxInboundEmailAttachments))
	}

	in.Attachments = make([]services.InboundAttachment, 0, len(files))
	for _, fh := range files {
		att := services.InboundAttachment{
			FileName:    fh.Filename,
			ContentType: fh.Header.Get("Content-Type"),
		}
		f, openErr := fh.Open()
		if openErr != nil {
			att.SkipReason = i18n.Text(ctx, "Không đọc được nội dung file")
			in.Attachments = append(in.Attachments, att)
			continue
		}
		// Cap the read at one byte over the per-file limit and hand that to
		// services.Upload: the refusal (and its message) must come from the shared
		// pipeline, not from a second copy of the 5 MB rule in the transport.
		body, readErr := io.ReadAll(io.LimitReader(f, services.MaxAttachmentBytes+1))
		_ = f.Close()
		if readErr != nil {
			att.SkipReason = i18n.Text(ctx, "Không đọc được nội dung file")
			in.Attachments = append(in.Attachments, att)
			continue
		}
		att.Body = body
		in.Attachments = append(in.Attachments, att)
	}
	return in, nil
}

func parseInboundJSON(w http.ResponseWriter, r *http.Request, ctx context.Context) (services.InboundEmailInput, error) {
	var in services.InboundEmailInput
	r.Body = http.MaxBytesReader(w, r.Body, maxInboundJSONBytes)
	var body struct {
		To          string `json:"to"`
		From        string `json:"from"`
		Subject     string `json:"subject"`
		Text        string `json:"text"`
		Attachments []struct {
			FileName      string `json:"fileName"`
			ContentType   string `json:"contentType"`
			ContentBase64 string `json:"contentBase64"`
		} `json:"attachments"`
	}
	if err := decodeJSONLoose(r, &body); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return in, errInboundRequestTooLarge
		}
		return in, errors.New(i18n.Text(ctx, "Body phải là JSON hợp lệ"))
	}
	in.To = strings.TrimSpace(body.To)
	in.From = strings.TrimSpace(body.From)
	in.Subject = body.Subject
	in.Text = body.Text
	if in.To == "" {
		return in, errors.New(i18n.Text(ctx, "Thiếu địa chỉ nhận (to)"))
	}
	if len(body.Attachments) > services.MaxInboundEmailAttachments {
		return in, errors.New(i18n.T(ctx,
			"Quá nhiều file đính kèm (tối đa %d)", services.MaxInboundEmailAttachments))
	}

	in.Attachments = make([]services.InboundAttachment, 0, len(body.Attachments))
	for _, part := range body.Attachments {
		att := services.InboundAttachment{
			FileName:    part.FileName,
			ContentType: part.ContentType,
		}
		content, decErr := decodeInboundBase64(part.ContentBase64)
		if decErr != nil {
			att.SkipReason = i18n.Text(ctx, "Nội dung base64 không hợp lệ")
			in.Attachments = append(in.Attachments, att)
			continue
		}
		att.Body = content
		in.Attachments = append(in.Attachments, att)
	}
	return in, nil
}

// decodeInboundBase64 accepts standard base64 with or without padding and
// ignores the line breaks a JSON producer may have inserted. It deliberately does
// not accept URL-safe base64: the contract names `contentBase64`, and silently
// accepting an alphabet that can contain '-'/'_' would make a future strict
// client's mistake invisible.
func decodeInboundBase64(raw string) ([]byte, error) {
	compact := strings.NewReplacer("\r", "", "\n", "", " ", "", "\t", "").Replace(raw)
	decoded, err := base64.StdEncoding.DecodeString(compact)
	if err == nil {
		return decoded, nil
	}
	return base64.RawStdEncoding.DecodeString(compact)
}

// hasInternalSkip reports whether any part failed for a server-side reason
// (encryption key, disk, database) rather than the sender's input. Used only for
// the "nothing landed" 500 described at the call site.
func hasInternalSkip(skipped []services.InboundEmailSkipped) bool {
	for _, s := range skipped {
		if s.Code == "internal_error" {
			return true
		}
	}
	return false
}

// multipartField returns the first value of a body field, never a query
// parameter. See the call site for why the distinction matters.
func multipartField(r *http.Request, name string) string {
	if r.MultipartForm == nil {
		return ""
	}
	values := r.MultipartForm.Value[name]
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
