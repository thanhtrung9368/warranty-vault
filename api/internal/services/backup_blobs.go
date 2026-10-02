// Package services / backup_blobs.go — the blob-carrying backup format
// (roadmap #2, the part that was deferred).
//
// Why an archive and not "more JSON"
// ----------------------------------
// The plain JSON export carries attachment metadata only, so restoring onto a new
// server loses every invoice image — the exact thing the backup UI promises to
// protect. The encrypted blobs are binary (AES-256-GCM ciphertext) and each can be
// 5 MB, so base64-in-JSON would inflate the payload by a third for no benefit.
// A .zip archive carries them verbatim:
//
//	attachments/<storagePath>          the raw ciphertext, one entry per attachment
//	data.json                          the v6 BackupExport envelope
//
// `storagePath` is exactly the value stored on the Attachment row
// (`<deviceId>/<uuid>.enc`), so an import can put the file back where the row
// points without inventing a mapping.
//
// Coexistence with the JSON format
// --------------------------------
// GET /api/v1/backup/export stays JSON (version 5, byte-identical) unless the
// caller passes ?includeBlobs=true, which switches the response to
// application/zip. One endpoint, one auth path, one payload contract — the
// envelope's `includesAttachmentBytes` already says which kind of document the
// caller received, and clients that never pass the flag are untouched.
//
// The truth that does not change: the bytes are useless without FILE_MASTER_KEY.
// The archive note says so, and the import counts blobs it cannot decrypt
// (`attachmentsUnreadable`) instead of pretending they are fine.

package services

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
)

const (
	// backupDataEntry is the envelope's path inside the archive.
	backupDataEntry = "data.json"
	// backupAttachmentPrefix prefixes every blob entry. Entry names are
	// `attachments/` + the attachment's storagePath.
	backupAttachmentPrefix = "attachments/"
	// maxBackupDataJSONBytes bounds the envelope entry. A metadata-only payload for
	// the largest allowed account is a few hundred KB; 16 MB is already generous
	// and stops a zip bomb from inflating `data.json` into memory.
	maxBackupDataJSONBytes = 16 << 20
	// maxBlobEntryBytes is the per-entry cap for a blob: the upload path caps a
	// single attachment at 5 MB of plaintext, plus the 16-byte GCM tag.
	maxBlobEntryBytes = MaxAttachmentBytes + 64
)

// WriteBackupZip streams the user's full data graph as a .zip archive that
// includes every attachment's encrypted bytes, and returns the envelope it wrote
// (with MissingAttachmentIds filled in when a blob file was absent from disk).
//
// The blobs are copied verbatim — never decrypted — so an export does not need
// FILE_MASTER_KEY on this server; only a restore that wants to *read* the images
// does.
func WriteBackupZip(ctx context.Context, db *pgxpool.Pool, userID string, w io.Writer) (*BackupExport, error) {
	payload, err := exportBackup(ctx, db, userID, true)
	if err != nil {
		return nil, err
	}

	root := files.PrivateUploadRoot()
	zw := zip.NewWriter(w)

	// Blobs first, manifest last: the envelope must be able to name the
	// attachments whose blob was missing from disk, so it cannot be written before
	// the blob pass has run. A partially-written archive therefore has no
	// data.json at all, which the importer rejects loudly (better than a file that
	// claims to be complete).
	for di := range payload.Devices {
		d := &payload.Devices[di]
		for ai := range d.Attachments {
			a := &d.Attachments[ai]
			ct, rerr := files.ReadEncrypted(root, a.StoragePath)
			if rerr != nil {
				// The row survived but the blob is gone (manual deletion, a volume
				// restored without the blobs, ...). Shipping a backup that quietly
				// omits it would be the same lie the metadata-only format told, so
				// record the id in the envelope instead.
				payload.MissingAttachmentIds = append(payload.MissingAttachmentIds, a.ID)
				continue
			}
			// Store, not Deflate: ciphertext does not compress, and storing keeps
			// the archive byte layout predictable.
			blobWriter, cerr := zw.CreateHeader(&zip.FileHeader{
				Name:   backupAttachmentPrefix + a.StoragePath,
				Method: zip.Store,
			})
			if cerr != nil {
				return nil, fmt.Errorf("zip create attachment %s: %w", a.StoragePath, cerr)
			}
			if _, werr := blobWriter.Write(ct); werr != nil {
				return nil, fmt.Errorf("zip write attachment %s: %w", a.StoragePath, werr)
			}
		}
	}

	if len(payload.MissingAttachmentIds) > 0 {
		payload.AttachmentBytesNote = fmt.Sprintf(
			"%s LƯU Ý: %d file đính kèm không còn trên đĩa nên KHÔNG có trong bản sao lưu này (xem missingAttachmentIds).",
			BlobAttachmentBytesNoteVN, len(payload.MissingAttachmentIds))
	}

	dataWriter, err := zw.Create(backupDataEntry)
	if err != nil {
		return nil, fmt.Errorf("zip create %s: %w", backupDataEntry, err)
	}
	enc := json.NewEncoder(dataWriter)
	enc.SetIndent("", "  ")
	if err := enc.Encode(payload); err != nil {
		return nil, fmt.Errorf("zip write %s: %w", backupDataEntry, err)
	}

	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("zip close: %w", err)
	}
	return payload, nil
}

// ImportBackupZip applies a blob-carrying archive. Metadata-only JSON payloads
// keep going through ImportBackup.
//
// Everything that can be rejected is rejected before a single row or byte is
// written: entry names must be the manifest or a valid storage path, sizes are
// bounded (zip-bomb guard), the payload must declare that it carries bytes when it
// does, and each attachment's entry must be present (unless the envelope itself
// lists it as missing on the export side).
func ImportBackupZip(ctx context.Context, db *pgxpool.Pool, userID string, archive []byte, mode ImportMode) (*ImportResult, error) {
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return nil, &Error{Code: "VALIDATION", Message: "File backup không phải ZIP hợp lệ"}
	}

	var dataEntry *zip.File
	blobEntries := map[string]*zip.File{} // storagePath → entry
	var totalBlobBytes uint64
	for _, f := range zr.File {
		name := f.Name
		switch {
		case name == backupDataEntry:
			if f.UncompressedSize64 > maxBackupDataJSONBytes {
				return nil, &Error{Code: "VALIDATION", Message: "Phần dữ liệu (data.json) trong file backup quá lớn"}
			}
			dataEntry = f
		case strings.HasPrefix(name, backupAttachmentPrefix):
			storagePath := strings.TrimPrefix(name, backupAttachmentPrefix)
			if !safeStoragePathRE.MatchString(storagePath) {
				return nil, &Error{Code: "VALIDATION",
					Message: fmt.Sprintf("Đường dẫn file không hợp lệ trong bản sao lưu: %s", storagePath)}
			}
			if f.UncompressedSize64 > maxBlobEntryBytes {
				return nil, &Error{Code: "VALIDATION",
					Message: fmt.Sprintf("File đính kèm %s vượt quá giới hạn %d MB", storagePath, MaxAttachmentBytes/(1024*1024))}
			}
			totalBlobBytes += f.UncompressedSize64
			if totalBlobBytes > MaxUploadBytesPerUser {
				return nil, &Error{Code: "VALIDATION", Message: fmt.Sprintf(
					"Bản sao lưu chứa hơn %d MB file đính kèm, vượt giới hạn dung lượng mỗi người dùng.",
					MaxUploadBytesPerUser/(1024*1024))}
			}
			blobEntries[storagePath] = f
		case isArchiveNoise(name):
			// macOS adds `__MACOSX/._data.json` (and `.DS_Store`) when a user
			// unzips and re-zips the archive in Finder. Those entries carry no data
			// this format needs, so ignoring them keeps a re-zipped backup
			// importable instead of failing on a file the user never created.
			continue
		default:
			return nil, &Error{Code: "VALIDATION",
				Message: fmt.Sprintf("File backup chứa thành phần không mong đợi: %s", name)}
		}
	}
	if dataEntry == nil {
		return nil, &Error{Code: "VALIDATION", Message: "File backup thiếu data.json"}
	}

	raw, err := readZipEntry(dataEntry, maxBackupDataJSONBytes)
	if err != nil {
		return nil, &Error{Code: "VALIDATION", Message: "Không đọc được data.json trong file backup"}
	}
	var payload BackupExport
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, &Error{Code: "VALIDATION", Message: "File JSON trong bản sao lưu không hợp lệ"}
	}
	if err := validateBackupPayload(&payload); err != nil {
		return nil, err
	}

	// Attachments the envelope already declares as missing on the export side: the
	// row is restored, the bytes are knowingly absent.
	knownMissing := make(map[string]bool, len(payload.MissingAttachmentIds))
	for _, id := range payload.MissingAttachmentIds {
		knownMissing[id] = true
	}

	// Cross-check the envelope against what the archive actually holds, so a
	// truncated or hand-edited file fails loudly instead of silently restoring
	// rows whose images are missing.
	wantBlobs := 0
	for _, d := range payload.Devices {
		for _, a := range d.Attachments {
			if _, ok := blobEntries[a.StoragePath]; !ok {
				if knownMissing[a.ID] {
					continue
				}
				return nil, &Error{Code: "VALIDATION", Message: fmt.Sprintf(
					"Bản sao lưu thiếu nội dung của file đính kèm \"%s\" (%s). File có thể đã hỏng hoặc bị sửa.",
					a.FileName, a.StoragePath)}
			}
			wantBlobs++
		}
	}
	if !payload.IncludesAttachmentBytes && len(blobEntries) > 0 {
		return nil, &Error{Code: "VALIDATION",
			Message: "File backup không nhất quán: data.json nói không chứa nội dung ảnh nhưng archive lại có."}
	}
	if wantBlobs == 0 && len(blobEntries) > 0 && len(knownMissing) == 0 {
		return nil, &Error{Code: "VALIDATION",
			Message: "File backup không nhất quán: archive chứa file đính kèm nhưng data.json không khai báo file nào."}
	}

	getter := func(att BackupAttachment) ([]byte, error) {
		if knownMissing[att.ID] {
			// nil bytes, no error → the importer restores the row without writing a
			// file and counts it as unreadable.
			return nil, nil
		}
		f, ok := blobEntries[att.StoragePath]
		if !ok {
			return nil, &Error{Code: "VALIDATION", Message: fmt.Sprintf(
				"Bản sao lưu thiếu nội dung của file đính kèm \"%s\".", att.FileName)}
		}
		b, rerr := readZipEntry(f, maxBlobEntryBytes)
		if rerr != nil {
			return nil, &Error{Code: "VALIDATION", Message: fmt.Sprintf(
				"Không đọc được nội dung file đính kèm \"%s\" trong bản sao lưu.", att.FileName)}
		}
		return b, nil
	}

	return importBackup(ctx, db, userID, &payload, mode, getter)
}

// isArchiveNoise reports whether an archive entry is filesystem metadata a
// re-zip adds rather than part of the backup format.
func isArchiveNoise(name string) bool {
	base := path.Base(name)
	return base == ".DS_Store" || strings.HasPrefix(name, "__MACOSX/") || strings.HasPrefix(base, "._")
}

// readZipEntry decompresses one entry, refusing to read more than `limit` bytes
// even if the header lied about the size.
func readZipEntry(f *zip.File, limit uint64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = rc.Close() }()
	buf, err := io.ReadAll(io.LimitReader(rc, int64(limit)+1)) //nolint:gosec // limit is a small constant
	if err != nil {
		return nil, err
	}
	if uint64(len(buf)) > limit {
		return nil, fmt.Errorf("zip entry %s exceeds %d bytes", f.Name, limit)
	}
	return buf, nil
}
