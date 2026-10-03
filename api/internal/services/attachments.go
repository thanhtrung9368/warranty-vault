package services

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Limits — must match website/src/lib/services/attachments.ts.
const (
	MaxAttachmentBytes      = 5 * 1024 * 1024   // 5 MB per file
	MaxAttachmentsPerDevice = 5                 // 5 attachments / device
	MaxUploadBytesPerUser   = 100 * 1024 * 1024 // 100 MB total / user
)

// AttachmentError carries a code → HTTP status mapping that the handler can
// translate without coupling to the store package directly.
type AttachmentError struct {
	Code    string // "bad_input" | "not_found" | "limit_reached" | "internal_error"
	Message string
}

func (e *AttachmentError) Error() string { return e.Message }

func badInput(msg string) error     { return &AttachmentError{Code: "bad_input", Message: msg} }
func notFound(msg string) error     { return &AttachmentError{Code: "not_found", Message: msg} }
func limitReached(msg string) error { return &AttachmentError{Code: "limit_reached", Message: msg} }
func internalErr(msg string) error  { return &AttachmentError{Code: "internal_error", Message: msg} }

// AsAttachmentError returns the typed error if err is one, allowing handlers
// to assert with errors.As against this concrete type.
func AsAttachmentError(err error) (*AttachmentError, bool) {
	var ae *AttachmentError
	if errors.As(err, &ae) {
		return ae, true
	}
	return nil, false
}

// ListAttachmentsByDevice returns attachments owned by userID under deviceID.
// If the device is missing or not owned by the user, returns notFound.
func ListAttachmentsByDevice(ctx context.Context, db *pgxpool.Pool, userID, deviceID string) ([]store.Attachment, error) {
	q := store.New(db)
	dev, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: deviceID, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFound("Thiết bị không tồn tại")
		}
		return nil, fmt.Errorf("get device: %w", err)
	}
	_ = dev
	rows, err := q.ListAttachmentsByDevice(ctx, store.ListAttachmentsByDeviceParams{
		DeviceId: deviceID,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	return rows, nil
}

// GetAttachmentForUser returns an attachment if and only if it belongs to a
// device owned by userID. Returns notFound on any miss (no ID enumeration).
func GetAttachmentForUser(ctx context.Context, db *pgxpool.Pool, userID, attachmentID string) (store.Attachment, error) {
	q := store.New(db)
	att, err := q.GetAttachmentByID(ctx, store.GetAttachmentByIDParams{
		ID:     attachmentID,
		UserId: userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Attachment{}, notFound("Không tìm thấy file")
		}
		return store.Attachment{}, fmt.Errorf("get attachment: %w", err)
	}
	return att, nil
}

// UploadAttachmentInput is the input bundle for Upload.
type UploadAttachmentInput struct {
	DeviceID    string
	FileName    string
	DeclaredCT  string // multipart Content-Type, may be empty
	Body        []byte
	Description *string
}

// Upload handles the full pipeline: ownership check, limit checks, MIME +
// magic-byte validation, optional resize, encryption, write to disk, DB row.
//
// On any error before encryption the buffers are dropped and nothing is
// written. Errors after the disk write attempt to clean up the orphan blob.
func Upload(ctx context.Context, db *pgxpool.Pool, userID string, in UploadAttachmentInput) (store.Attachment, error) {
	if !files.SafeSegment(in.DeviceID) {
		return store.Attachment{}, badInput("Device không hợp lệ")
	}
	if len(in.Body) == 0 {
		return store.Attachment{}, badInput("File trống")
	}
	if len(in.Body) > MaxAttachmentBytes {
		return store.Attachment{}, badInput("File vượt quá 5MB")
	}

	q := store.New(db)
	// Ownership.
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: in.DeviceID, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Attachment{}, notFound("Thiết bị không tồn tại")
		}
		return store.Attachment{}, fmt.Errorf("get device: %w", err)
	}

	// Per-device count.
	count, err := q.CountAttachmentsByDevice(ctx, in.DeviceID)
	if err != nil {
		return store.Attachment{}, fmt.Errorf("count attachments: %w", err)
	}
	if count >= int64(MaxAttachmentsPerDevice) {
		return store.Attachment{}, limitReached("Tối đa 5 file/thiết bị")
	}

	// MIME detect + whitelist + magic-byte parity.
	mime, err := files.DetectAndValidate(in.Body, in.DeclaredCT)
	if err != nil {
		return store.Attachment{}, badInput(err.Error())
	}

	// Resize (best-effort; falls back to original bytes on non-fatal codec
	// hiccups for gif/webp).
	processed, err := files.MaybeResize(in.Body, mime)
	if err != nil {
		return store.Attachment{}, badInput("Không xử lý được ảnh, file có thể đã hỏng")
	}

	// Per-user total bytes cap (use processed length so resize savings count).
	used, err := q.SumAttachmentBytesByUser(ctx, userID)
	if err != nil {
		return store.Attachment{}, fmt.Errorf("sum bytes: %w", err)
	}
	if used+int64(len(processed)) > int64(MaxUploadBytesPerUser) {
		return store.Attachment{}, limitReached("Dung lượng tổng vượt quá 100MB. Xoá bớt file cũ.")
	}

	// Encrypt.
	master, err := files.LoadMasterKey()
	if err != nil {
		return store.Attachment{}, internalErr(err.Error())
	}
	enc, err := files.Encrypt(processed, master)
	if err != nil {
		return store.Attachment{}, internalErr("Lỗi mã hoá file")
	}

	// Write to disk.
	root := files.PrivateUploadRoot()
	fileBase := uuid.NewString() + ".enc"
	storagePath, err := files.WriteEncrypted(root, in.DeviceID, fileBase, enc.Ciphertext)
	if err != nil {
		return store.Attachment{}, internalErr("Lỗi ghi file")
	}

	// DB row. Best-effort cleanup if the insert fails.
	att, err := q.CreateAttachment(ctx, store.CreateAttachmentParams{
		ID:          auth.NewID(),
		DeviceId:    in.DeviceID,
		FileName:    in.FileName,
		StoragePath: storagePath,
		FileType:    mime,
		FileSize:    int32(len(processed)), //nolint:gosec // bounded by MaxAttachmentBytes
		Iv:          enc.IV,
		WrappedKey:  enc.WrappedKey,
		Description: in.Description,
	})
	if err != nil {
		_ = files.DeleteEncrypted(root, storagePath)
		return store.Attachment{}, fmt.Errorf("create attachment: %w", err)
	}
	return att, nil
}

// NormalizeDescription applies the same normalization the upload path uses for
// the multipart `description` field: trim, and treat blank as "no description"
// (SQL NULL). So PATCHing `""`, `"   "` or `null` all clear it, and a client can
// reuse its upload-time encoding verbatim.
func NormalizeDescription(raw *string) *string {
	if raw == nil {
		return nil
	}
	v := strings.TrimSpace(*raw)
	if v == "" {
		return nil
	}
	return &v
}

// UpdateDescription rewrites one attachment's description.
//
// Ownership is enforced inside the query, through the owning Device row
// (`a."deviceId" = d.id AND d."userId" = $2`) — the same join GetAttachmentByID
// uses. Someone else's attachment therefore matches no row and comes back as
// notFound, i.e. HTTP 404 and never 403: the endpoint must not confirm that an
// id exists for a user who does not own it (matching downloadFileHandler).
func UpdateDescription(ctx context.Context, db *pgxpool.Pool, userID, attachmentID string, description *string) (store.Attachment, error) {
	att, err := store.New(db).UpdateAttachmentDescription(ctx, store.UpdateAttachmentDescriptionParams{
		ID:          attachmentID,
		UserId:      userID,
		Description: description,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Attachment{}, notFound("Không tìm thấy file")
		}
		return store.Attachment{}, fmt.Errorf("update attachment description: %w", err)
	}
	return att, nil
}

// Delete removes the attachment row and its on-disk blob. The blob removal
// is best-effort: if the file is already missing we still drop the DB row.
func Delete(ctx context.Context, db *pgxpool.Pool, userID, attachmentID string) error {
	q := store.New(db)
	att, err := q.DeleteAttachment(ctx, store.DeleteAttachmentParams{
		ID:     attachmentID,
		UserId: userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound("Không tìm thấy file")
		}
		return fmt.Errorf("delete attachment: %w", err)
	}
	if rmErr := files.DeleteEncrypted(files.PrivateUploadRoot(), att.StoragePath); rmErr != nil {
		slog.Warn("attachment blob remove failed",
			"err", rmErr, "attachmentId", attachmentID, "storagePath", att.StoragePath)
	}
	return nil
}

// decryptAttachment reads + decrypts an owned attachment's blob into memory.
// Plaintext bytes never touch disk (matching OpenStream). Returns notFound on
// any miss / decrypt failure to avoid leaking which IDs exist. Shared by
// OpenStream (file download) and the AI extraction service.
func decryptAttachment(ctx context.Context, db *pgxpool.Pool, userID, attachmentID string) (plain []byte, mime, name string, err error) {
	att, gerr := GetAttachmentForUser(ctx, db, userID, attachmentID)
	if gerr != nil {
		return nil, "", "", gerr
	}
	root := files.PrivateUploadRoot()
	ct, rerr := files.ReadEncrypted(root, att.StoragePath)
	if rerr != nil {
		return nil, "", "", notFound("Không tìm thấy file")
	}
	master, merr := files.LoadMasterKey()
	if merr != nil {
		return nil, "", "", internalErr(merr.Error())
	}
	plainBytes, derr := files.Decrypt(ct, att.Iv, att.WrappedKey, master)
	if derr != nil {
		// Decrypt failure (key mismatch / tag fail) → leak nothing, treat as
		// missing.
		return nil, "", "", notFound("Không tìm thấy file")
	}
	return plainBytes, att.FileType, att.FileName, nil
}

// OpenStream returns the decrypted bytes of the attachment as an
// io.ReadCloser, plus the MIME and original filename. ≤5 MB files are
// buffered in memory — well within the request budget.
func OpenStream(ctx context.Context, db *pgxpool.Pool, userID, attachmentID string) (mime, name string, body io.ReadCloser, size int64, err error) {
	plain, ft, fn, derr := decryptAttachment(ctx, db, userID, attachmentID)
	if derr != nil {
		return "", "", nil, 0, derr
	}
	return ft, fn, io.NopCloser(bytes.NewReader(plain)), int64(len(plain)), nil
}
