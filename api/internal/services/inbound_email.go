package services

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Provider-agnostic inbound email — the mail path into the capture-first inbox.
//
// The owner has NOT picked an inbound-email provider, so this file deliberately
// knows nothing about any vendor's payload. It accepts a neutral message:
//
//	to, from, subject, text          addresses + header copy
//	attachment[]                     one or more files (name, declared type, bytes)
//
// The HTTP shape lives in handlers/inbox_email.go (multipart/form-data is the
// primary shape, JSON with base64 is the secondary one). Everything below is
// transport-free and testable against a real Postgres.
//
// # What it does NOT reimplement
//
// An email attachment becomes an inbox item by calling Upload with DeviceID nil
// — the exact function POST /api/v1/attachments calls. Encryption, the magic-byte
// MIME whitelist, the 5 MB per-file cap and the 100 MB per-user ceiling are
// therefore shared by construction, not copied. If those rules change, both
// paths change together.
//
// # Partially delivered mail
//
// One bad attachment must not lose the rest of the message: a PDF that is too
// large, has the wrong type or would blow the storage ceiling is recorded in
// Skipped with the reason the upload pipeline gave, and the remaining parts are
// still stored. Providers deliver messages, not transactions; only one row
// failing is normal. The handler returns 200 when routing succeeded, even if
// every part was skipped.
//
// There is deliberately NO message-id dedupe in this wave: the wire contract has
// no message id, and a provider retry would duplicate whatever already landed.
// The openapi description says so explicitly so nobody assumes idempotency.

const (
	// MaxInboundEmailAttachments bounds the attachment parts in ONE message.
	//
	// 10 is chosen against the real traffic shape: a shop receipt email carries
	// one attachment, occasionally two or three (invoice + warranty card). Ten
	// leaves room for a batch without letting one message become an unbounded
	// amount of encrypt/write work. With the 5 MB per-file cap it also bounds a
	// single message at 50 MB of attachment bytes — half of the per-user 100 MB
	// ceiling — so one email can never exhaust an account's storage by itself.
	MaxInboundEmailAttachments = 10

	// maxInboundFileNameRunes keeps a provider-supplied filename displayable.
	// The value is data only (it never becomes a path segment; blobs are named by
	// uuid), but an 8 KB filename would still be a bad row and a bad response.
	maxInboundFileNameRunes = 255
)

// InboundEmailConfig is the server-side configuration of the mail path.
//
// It is read from the environment on every request rather than cached in a
// process-global: the endpoint returns 503 when either half is missing, and an
// operator who sets the two variables expects the next request to work (the same
// "no key = feature_disabled, server still boots" contract ANTHROPIC_API_KEY
// follows for OCR).
type InboundEmailConfig struct {
	// Token is the shared secret the provider must send in
	// X-Warrly-Inbox-Token. It authenticates the CALLER (our mail provider), not
	// the recipient; the recipient is resolved from the address.
	Token string
	// Domain is the verified inbound domain, e.g. "inbox.example.com". The
	// recipient's domain must equal it exactly (case-insensitive).
	Domain string
}

// InboundEmailConfigFromEnv builds the config. Both variables are optional:
// absent means the feature is disabled and the server still boots.
func InboundEmailConfigFromEnv() InboundEmailConfig {
	return InboundEmailConfig{
		Token:  strings.TrimSpace(os.Getenv("INBOX_EMAIL_TOKEN")),
		Domain: normalizeInboundDomain(os.Getenv("INBOX_EMAIL_DOMAIN")),
	}
}

// Enabled reports whether both halves are configured. A token without a domain
// (or vice versa) cannot route a recipient, so it is disabled rather than
// half-live: every message would 404, which is a worse answer than 503.
func (c InboundEmailConfig) Enabled() bool {
	return c.Token != "" && c.Domain != ""
}

// normalizeInboundDomain makes the configured domain comparable with the domain
// of a parsed address: trim, lowercase, drop a leading "@" (a common paste
// mistake) and a trailing root dot. It does not validate DNS; a typo simply
// matches nothing and every message 404s.
func normalizeInboundDomain(raw string) string {
	d := strings.ToLower(strings.TrimSpace(raw))
	d = strings.TrimPrefix(d, "@")
	d = strings.TrimSuffix(d, ".")
	return d
}

// InboxAddress returns the user's inbound address ("<token>@<domain>") or nil
// when the feature is not configured.
//
// nil, not an empty string, so `userDTO.InboxAddress` can be `omitempty`: a
// deployment with no INBOX_EMAIL_DOMAIN returns EXACTLY the JSON it returned
// before this feature existed. That is the "nothing changes for a user who never
// emails in" guarantee at the payload level, and it is why the address is not
// computed unconditionally.
func InboxAddress(token string) *string {
	cfg := InboundEmailConfigFromEnv()
	token = strings.TrimSpace(token)
	if token == "" || cfg.Domain == "" {
		return nil
	}
	addr := strings.ToLower(token) + "@" + cfg.Domain
	return &addr
}

// InboundAttachment is one part of a neutral inbound message.
type InboundAttachment struct {
	// FileName is provider-supplied and untrusted. Empty/blank becomes
	// "attachment-<n>"; it is trimmed, stripped of control characters and capped
	// at 255 runes by the service.
	FileName string
	// ContentType is the declared MIME type. It may be empty (some providers omit
	// it); internal/files then trusts the magic bytes alone. A non-empty value
	// that disagrees with the bytes is refused by the same whitelist that guards
	// every other upload.
	ContentType string
	// Body is the decoded file. The 5 MB cap is NOT enforced here — Upload owns
	// it, so the message and the status behaviour are identical to a direct
	// upload.
	Body []byte
	// SkipReason, when non-empty, marks a part the TRANSPORT could not decode
	// (invalid base64, an unreadable multipart part). The service records it in
	// Skipped without calling Upload, so one unreadable part does not discard the
	// rest of the message. The reason is already localized.
	SkipReason string
}

// InboundEmailInput is the neutral message the HTTP layer hands over.
//
// From/Subject/Text are accepted because every inbound provider sends them and a
// future feature (threading, sender allow-lists) may want them. This wave does
// not persist them: there is no email table, and writing the body text onto an
// attachment would put untrusted copy into a searchable plaintext column
// (Attachment.extractedText is reserved for OCR the user opted into).
type InboundEmailInput struct {
	To          string
	From        string
	Subject     string
	Text        string
	Attachments []InboundAttachment
}

// InboundEmailSkipped is one attachment that did not become an inbox item, with
// the reason the shared upload pipeline produced (already in the request's
// language).
type InboundEmailSkipped struct {
	FileName string `json:"fileName"`
	// Code mirrors the upload pipeline's error code: "bad_input" for a wrong
	// type / empty / oversize file, "limit_reached" for the per-user 100 MB
	// ceiling, "internal_error" for anything unexpected. It is contract; only
	// Reason moves with the language.
	Code   string `json:"code"`
	Reason string `json:"reason"`
}

// InboundEmailResult is what landed and what did not.
type InboundEmailResult struct {
	// Attachments are the rows created by Upload, in message order. They are the
	// same store.Attachment rows POST /api/v1/attachments returns; the handler
	// projects them through the standard AttachmentMeta DTO.
	Attachments []store.Attachment
	Skipped     []InboundEmailSkipped
}

// ReceiveInboundEmail resolves the recipient and stores every attachment that
// passes the shared upload rules.
//
// Error contract:
//   - a message whose recipient does not resolve to exactly one user returns
//     ONE *Error{Code:"NOT_FOUND"} whose message is the same for every failure
//     mode (malformed address, wrong domain, unknown token). Callers must not
//     add detail: the endpoint is not an enumeration oracle;
//   - a message over the part cap returns a bad_input AttachmentError (400);
//   - a per-attachment failure NEVER fails the message. It is recorded in
//     Skipped, and an internal failure is also logged so it is not invisible.
//
// `domain` is passed in rather than read from the env so the service is a pure
// function of its arguments in tests (and so the handler and this code cannot
// disagree about which domain is live).
func ReceiveInboundEmail(ctx context.Context, db *pgxpool.Pool, domain string, in InboundEmailInput) (InboundEmailResult, error) {
	domain = normalizeInboundDomain(domain)
	if len(in.Attachments) > MaxInboundEmailAttachments {
		return InboundEmailResult{}, badInput(i18n.T(ctx,
			"Quá nhiều file đính kèm (tối đa %d)", MaxInboundEmailAttachments))
	}

	userID, err := resolveInboundRecipient(ctx, db, in.To, domain)
	if err != nil {
		return InboundEmailResult{}, err
	}

	result := InboundEmailResult{
		Attachments: make([]store.Attachment, 0, len(in.Attachments)),
		Skipped:     make([]InboundEmailSkipped, 0),
	}
	for i, part := range in.Attachments {
		name := normalizeInboundFileName(part.FileName, i)
		if part.SkipReason != "" {
			result.Skipped = append(result.Skipped, InboundEmailSkipped{
				FileName: name,
				Code:     "bad_input",
				Reason:   part.SkipReason,
			})
			continue
		}
		att, uerr := Upload(ctx, db, userID, UploadAttachmentInput{
			// nil is the whole point: an email attachment is an inbox item, not a
			// file attached to a device the sender could not name anyway.
			DeviceID:   nil,
			FileName:   name,
			DeclaredCT: part.ContentType,
			Body:       part.Body,
		})
		if uerr != nil {
			code, reason, internal := inboundSkipReason(ctx, uerr)
			if internal {
				slog.Error("inbound email: attachment store failed",
					"err", uerr, "userId", userID, "fileName", name)
			}
			result.Skipped = append(result.Skipped, InboundEmailSkipped{
				FileName: name,
				Code:     code,
				Reason:   reason,
			})
			continue
		}
		result.Attachments = append(result.Attachments, att)
	}

	// Diagnostics only. The recipient address (which IS the credential) is never
	// logged; the user id is enough to correlate with everything else.
	slog.Info("inbound email processed",
		"userId", userID,
		"from", in.From,
		"subject", in.Subject,
		"received", len(in.Attachments),
		"stored", len(result.Attachments),
		"skipped", len(result.Skipped),
	)
	return result, nil
}

// resolveInboundRecipient maps "<token>@<domain>" onto a user.
//
// The failure paths are intentionally indistinguishable: a missing/blank `to`, a
// malformed address, a foreign domain, a local part with no row and a database
// miss all produce the same *Error (same status, same code, same sentence). See
// the migration 0020 header for why the address is a secret.
func resolveInboundRecipient(ctx context.Context, db *pgxpool.Pool, to, domain string) (string, error) {
	local := recipientLocalPart(to, domain)
	if local == "" {
		return "", unknownInboundRecipient(ctx)
	}
	userID, err := store.New(db).GetUserIDByInboxToken(ctx, local)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", unknownInboundRecipient(ctx)
		}
		return "", fmt.Errorf("get user id by inbox token: %w", err)
	}
	return userID, nil
}

func unknownInboundRecipient(ctx context.Context) error {
	// One sentence, no interpolation: the caller must not be able to tell a
	// well-formed-wrong-token from a wrong-domain or a deleted account.
	return ErrNotFound(i18n.Text(ctx, "Địa chỉ nhận không hợp lệ"))
}

// recipientLocalPart returns the lowercased local part of the first address in
// `to` whose domain is exactly `domain`, or "" when there is none.
//
// net/mail handles the shapes providers actually send: a bare address,
// `Name <address>`, a comma-separated list, quoted display names. We use the
// FIRST matching recipient rather than looking for one that resolves: picking
// "whichever address happens to exist" would turn the endpoint into a slow
// oracle, and a real provider sends one recipient per message.
//
// Deliberately no plus-addressing or subdomain matching: `token+tag@domain` and
// `token@mail.domain` are not the configured address, and accepting them would
// widen a credential's shape for no feature.
func recipientLocalPart(to, domain string) string {
	if domain == "" {
		return ""
	}
	addrs, err := mail.ParseAddressList(to)
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		at := strings.LastIndexByte(addr.Address, '@')
		if at <= 0 || at == len(addr.Address)-1 {
			continue
		}
		if normalizeDomainForCompare(addr.Address[at+1:]) != domain {
			continue
		}
		local := strings.ToLower(strings.TrimSpace(addr.Address[:at]))
		if local == "" {
			continue
		}
		return local
	}
	return ""
}

// normalizeDomainForCompare trims a trailing root dot and lowercases. Kept
// separate from normalizeInboundDomain because this side is untrusted input from
// a parsed address, not configuration.
func normalizeDomainForCompare(raw string) string {
	return strings.ToLower(strings.TrimSuffix(strings.TrimSpace(raw), "."))
}

// inboundSkipReason turns an Upload error into a stable code + a localized
// sentence, and reports whether it was an internal failure (logged by the
// caller). `services.AttachmentError` and `services.Error` both already carry
// finished copy when they have a request context; the fallback is only reached by
// a raw DB/disk error from Upload.
func inboundSkipReason(ctx context.Context, err error) (code, reason string, internal bool) {
	if ae, ok := AsAttachmentError(err); ok {
		return ae.Code, ae.Message, ae.Code == "internal_error"
	}
	var se *Error
	if errors.As(err, &se) {
		return strings.ToLower(se.Code), se.Message, false
	}
	return "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), true
}

// normalizeInboundFileName makes a provider filename safe to store and display.
// It is never used to build a filesystem path (blobs are uuid-named), so this is
// presentation hygiene, not path-traversal defence; sanitizeFilename in the
// download handler still does the header-level work.
func normalizeInboundFileName(raw string, index int) string {
	name := strings.TrimSpace(raw)
	// Strip control characters (CR/LF/NUL are the ones that could reach a log line
	// or a Content-Disposition header downstream) and collapse nothing else.
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Sprintf("attachment-%d", index+1)
	}
	if utf8.RuneCountInString(name) > maxInboundFileNameRunes {
		name = string([]rune(name)[:maxInboundFileNameRunes])
	}
	return name
}
