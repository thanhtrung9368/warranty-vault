// Package services / backup.go — Export & Import of a user's entire data
// graph. Mirrors the legacy TS `website/src/app/actions/backup.ts` payload
// shape (version 5) so existing exported files can be re-imported here and
// vice-versa.
//
// Export issues 9 independent SELECTs (no joined gather query). Import is
// wrapped in a single transaction; in `replace` mode we wipe the user's
// existing rows first.

package services

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
	"github.com/thanhtrung9368/warranty-vault/api/internal/fx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// safeID mirrors the Prisma backup importer regex.
var (
	safeIDRE          = regexp.MustCompile(`^[a-z0-9_-]+$`)
	safeStoragePathRE = regexp.MustCompile(`^[a-z0-9_-]+/[a-z0-9-]+\.enc$`)
)

// backupLeadDays prepares the migration-0015 reminder schedule for an insert
// from a backup payload. Absent and empty both become nil so SQL's
// `COALESCE(..., ARRAY[30, 7])` applies the same default as a create; a present
// array is copied and sorted descending so a restore cannot store a schedule in
// a different order from the API.
//
// Validation is deliberately NOT performed here. A backup is restored, not
// composed: refusing the whole file because one hand-edited array is malformed
// would block the user's only recovery path, and a value outside 0..365 simply
// never matches a cron day window.
func backupLeadDays(days []int32) []int32 {
	if len(days) == 0 {
		return nil
	}
	sorted := append([]int32(nil), days...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] > sorted[j] })
	return sorted
}

// ---- Export shapes (BackupV1 = the canonical Vietnamese-named JSON the web
//      client + mobile apps consume; numbered version: 5 to match TS).

// Backup schema versions.
//
// The format is additive: a later version may add fields, and the importer reads
// an older payload by letting the missing fields decode to their zero values.
// Import therefore accepts the whole [MinBackupVersion, BackupVersion] range
// rather than testing for equality — an equality check turns every future bump
// into a data-loss path, because every backup a user already holds instantly
// becomes unimportable.
const (
	// BackupVersion is the newest payload this build reads, and the version
	// written inside the blob-carrying .zip archive
	// (GET /api/v1/backup/export?includeBlobs=true). Version 6 means "this
	// envelope may declare includesAttachmentBytes=true and the bytes travel
	// beside it in the archive".
	BackupVersion = 6
	// MetadataOnlyBackupVersion is the version written by the plain JSON export.
	// It is deliberately still 5: a v5-only client or importer keeps working, and
	// existing v5 files stay valid. The document is no longer byte-for-byte the
	// old one — it now carries `instantTimeZone` (below), an additive key every
	// JSON decoder in the tree ignores — because the old bytes are exactly what
	// makes a pre-fix file indistinguishable from a fixed one.
	MetadataOnlyBackupVersion = 5
	// MinBackupVersion is the oldest shape this importer can still read. It stays
	// at 5 — the legacy TS exporter's numbering — because a v5 payload imports
	// *correctly*; raise it only when an older payload would import wrongly (a
	// changed field meaning), not merely because fields were added.
	MinBackupVersion = 5
)

// BackupInstantBasisUTC is the value of BackupExport.InstantTimeZone this build
// writes. It says: every instant in this payload is UTC, the same instant the
// database stores (dbconn pinned the session; Go writes .UTC()).
const BackupInstantBasisUTC = "UTC"

// BackupInstantTimeZoneField is the JSON key. Named here so the importer and the
// tests cannot drift from the field tag.
const BackupInstantTimeZoneField = "instantTimeZone"

// LegacyInstantWarningVN is the warning appended to ImportResult.Warnings when a
// payload does not declare its instant basis — i.e. every export written before
// `instantTimeZone` existed. Those files were produced while SQL NOW() was the
// server's local wall clock (Asia/Ho_Chi_Minh, +07) even though the JSON printed
// a Z suffix, so their instant columns can be 7 hours off. The importer does NOT
// rewrite them: migration 0024 exists because a blanket offset corrupts rows
// that were already written correctly, and a backup has no cuid-clock evidence
// to classify each row. It restores exactly what the file says and tells the
// caller, which is the honest limit of what a file without provenance supports.
//
// Vietnamese source text + i18n catalog key, like the attachment notes.
const LegacyInstantWarningVN = "Bản sao lưu này không ghi múi giờ cho các mốc thời gian. Nếu file được xuất trước khi Warrly sửa lỗi múi giờ, một số mốc (thời điểm tạo/cập nhật, thời điểm thanh toán, mốc nhắc) có thể lệch 7 giờ so với thực tế. Warrly giữ nguyên các mốc đã nhập vì không thể xác định chắc chắn từng dòng có bị lệch hay không; ngày tháng như ngày mua và ngày hết hạn bảo hành không bị ảnh hưởng."

// AttachmentBytesNoteVN is the warning that ships inside every metadata-only
// export. It exists so any client can warn accurately from the payload itself
// instead of hardcoding "the backup has no images" (roadmap #2) — which is true
// for this document but would silently become a lie if the format changed.
//
// It is the Vietnamese SOURCE text and doubles as the catalog key
// (internal/i18n/catalog.go), which is why it is a named constant: the note
// reaches `i18n.Text` as DATA (newBackupEnvelope), and the same sentence has to
// stay reviewable in one place. The name keeps the "VN" because the constant IS
// the Vietnamese sentence — what varies is the language it is rendered in, which
// is the language of the EXPORT request.
const AttachmentBytesNoteVN = "Bản sao lưu này KHÔNG chứa nội dung ảnh/hoá đơn đính kèm (chỉ có tên file, loại file và kích thước). Khôi phục sang một máy chủ khác sẽ không khôi phục được ảnh."

// BlobAttachmentBytesNoteVN is the note that ships inside the .zip archive
// (includeBlobs=true), where the encrypted bytes DO travel with the data. It
// keeps telling the truth about the remaining requirement: the blobs are
// AES-256-GCM ciphertext whose per-file keys are wrapped with FILE_MASTER_KEY, so
// a restore on a server with a different (or missing) FILE_MASTER_KEY imports the
// rows and the bytes but cannot decrypt them.
//
// Also a catalog key (see AttachmentBytesNoteVN). When a blob was missing from
// disk at export time this sentence is the `%s` of the appended warning in
// backup_blobs.go::missingBlobNote, so the two are translated together.
const BlobAttachmentBytesNoteVN = "Bản sao lưu này CÓ chứa nội dung ảnh/hoá đơn đính kèm (đã mã hoá AES-256-GCM). Cần đúng FILE_MASTER_KEY của máy chủ đã xuất bản sao lưu thì mới giải mã được; thiếu hoặc sai khoá thì file vẫn được khôi phục nhưng không mở được."

type BackupExport struct {
	Version    int    `json:"version"`
	ExportedAt string `json:"exportedAt"`
	// InstantTimeZone names the zone every INSTANT in this payload was written
	// in: "UTC" for every export this build produces. It is the provenance signal
	// the payload otherwise lacks. The pre-fix exporter wrote the server's LOCAL
	// wall clock (Asia/Ho_Chi_Minh, +07) into instant columns while printing a `Z`
	// suffix, and those files are still version 5/6 — no version bump can tell
	// them apart. So this is a marker, not a version: an OLD importer ignores the
	// unknown key and still restores the file; a NEW importer uses its absence to
	// warn (ImportResult.Warnings) instead of guessing an offset. Never rewrite
	// timestamps from it — see LegacyInstantWarningVN.
	//
	// `omitempty` is deliberate: a hand-built payload without the key decodes to
	// "" (= provenance unknown, warn), and the zero value never claims UTC.
	InstantTimeZone string `json:"instantTimeZone,omitempty"`
	// Self-describing honesty metadata (roadmap #2). Always emitted:
	//   includesAttachmentBytes — true only for the .zip export
	//     (?includeBlobs=true), where every attachment's encrypted blob travels in
	//     the archive. The plain JSON export keeps false: it carries Attachment
	//     *metadata* (fileName, fileType, fileSize, iv, wrappedKey) plus the
	//     owning device's storagePath, but never the bytes, so a restore on a fresh
	//     server cannot bring invoice images back — the blobs live under
	//     PRIVATE_UPLOAD_ROOT and need FILE_MASTER_KEY to decrypt.
	//   attachmentBytesNote — one-liner for the client to surface, rendered in the
	//     language of the export request (`?lang=` / Accept-Language / the stored
	//     preference). It travels INSIDE the document, so a client that never
	//     speaks that language still reads the same sentence the exporter chose;
	//     nothing about the warning's meaning depends on which side renders it.
	IncludesAttachmentBytes bool                 `json:"includesAttachmentBytes"`
	AttachmentBytesNote     string               `json:"attachmentBytesNote"`
	Subscriptions           []BackupSubscription `json:"subscriptions"`
	Wishlist                []BackupWishlistItem `json:"wishlist"`
	Devices                 []BackupDevice       `json:"devices"`
	// InboxAttachments are the user's unassigned attachments (migration 0018).
	// They live at the top level because there is no device to nest them under;
	// each entry has the same BackupAttachment shape as a device's list, and its
	// storagePath starts with the reserved `_inbox/` segment.
	//
	// Additive and OMITEMPTY on purpose: a user with no inbox items gets the
	// same v5 payload they got before this migration (plus the top-level
	// `instantTimeZone` marker), and an older payload without the key decodes to
	// nil and imports unchanged. The backup VERSION therefore does not move
	// (still 5 for JSON, 6 for the ZIP) — the import range already accepts both,
	// and an older server importing a newer file ignores the unknown key (the
	// same forward-compatibility limit every additive field in this format has
	// always had).
	InboxAttachments []BackupAttachment `json:"inboxAttachments,omitempty"`
	// Claims are the user's warranty claims (migration 0021). Like the inbox,
	// they live at the TOP LEVEL rather than nested under a device: a claim
	// carries its own deviceId and its warrantyId is optional, so nesting it
	// under a device would duplicate an id and make the shape depend on which
	// device was exported.
	//
	// Additive and OMITEMPTY on purpose: a user with no claims gets the
	// byte-identical v5 payload they got before this migration, an older payload
	// without the key decodes to nil and imports unchanged, and the payload
	// VERSION does not move (still 5 for JSON, 6 for the ZIP). A claim that was
	// not written by this server (a hand-edited file) is checked for the
	// single-open rule before anything is inserted — see validateBackupPayload —
	// because the partial unique index would otherwise abort the whole import.
	Claims []BackupClaim `json:"claims,omitempty"`
	// MissingAttachmentIds lists attachments whose blob file was absent from disk
	// at export time, so the archive could not carry them. Export still succeeds
	// (one lost blob must not block a backup) but the payload says exactly which
	// ids are incomplete instead of silently shipping a smaller backup.
	// Omitted when empty, and never present in the metadata-only JSON.
	MissingAttachmentIds []string `json:"missingAttachmentIds,omitempty"`
}

// newBackupEnvelope builds an export envelope. The honesty fields are set here
// rather than at the call site so every export path is self-describing by
// construction.
//
// `noteKey` is the Vietnamese source text of the note AND its catalog key, so
// the envelope is rendered in the request's language without the two export
// paths having to agree on anything but which sentence applies to them.
func newBackupEnvelope(ctx context.Context, version int, includesBytes bool, noteKey string, deviceCount, wishlistCount, subCount int) *BackupExport {
	return &BackupExport{
		Version:                 version,
		ExportedAt:              time.Now().UTC().Format(time.RFC3339Nano),
		InstantTimeZone:         BackupInstantBasisUTC,
		IncludesAttachmentBytes: includesBytes,
		AttachmentBytesNote:     i18n.Text(ctx, noteKey),
		Subscriptions:           make([]BackupSubscription, 0, subCount),
		Wishlist:                make([]BackupWishlistItem, 0, wishlistCount),
		Devices:                 make([]BackupDevice, 0, deviceCount),
	}
}

// newBackupExport builds the metadata-only JSON envelope (version 5, unchanged).
func newBackupExport(ctx context.Context, deviceCount, wishlistCount, subCount int) *BackupExport {
	return newBackupEnvelope(ctx, MetadataOnlyBackupVersion, false, AttachmentBytesNoteVN, deviceCount, wishlistCount, subCount)
}

// newBlobBackupExport builds the envelope written inside the .zip archive.
func newBlobBackupExport(ctx context.Context, deviceCount, wishlistCount, subCount int) *BackupExport {
	return newBackupEnvelope(ctx, BackupVersion, true, BlobAttachmentBytesNoteVN, deviceCount, wishlistCount, subCount)
}

type BackupSubscription struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Category      *string `json:"category"`
	Brand         *string `json:"brand"`
	Plan          *string `json:"plan"`
	BillingCycle  string  `json:"billingCycle"`
	IntervalDays  *int32  `json:"intervalDays"`
	Price         int32   `json:"price"`
	Currency      string  `json:"currency"`
	StartedAt     string  `json:"startedAt"`
	RenewalDate   string  `json:"renewalDate"`
	AutoRenew     bool    `json:"autoRenew"`
	Status        string  `json:"status"`
	AccountEmail  *string `json:"accountEmail"`
	PaymentMethod *string `json:"paymentMethod"`
	ManageUrl     *string `json:"manageUrl"`
	CancelUrl     *string `json:"cancelUrl"`
	Notes         *string `json:"notes"`
	// LastNotifiedRenewalAt is the cron renewal-warning dedup marker
	// (Subscription."lastNotifiedRenewalAt", migration 0001). Same class of bug
	// as BackupReminder.LastNotifiedAt: dropping it on restore re-fires the
	// renewal notifications.
	LastNotifiedRenewalAt *string `json:"lastNotifiedRenewalAt"`
	// LastNotifiedRenewalLeadDay is the other half of the per-lead-day key
	// (migration 0015): without it, a same-day restore could re-fire the 7-day
	// warning after the 30-day one had already been stamped.
	LastNotifiedRenewalLeadDay *int32 `json:"lastNotifiedRenewalLeadDay"`
	// LeadDays is the user's renewal reminder schedule (migration 0015). Optional
	// in the payload: an older export has no value and imports as [3, 1, 0], the
	// schedule that export was written under.
	LeadDays []int32 `json:"leadDays"`
	// Trial pair (migration 0016, Feature B). trialEndsAt/convertsToPrice are the
	// user's own data — dropping them on restore would silently delete the trial
	// the user was tracking. trialNotifiedAt/trialNotifiedLeadDay are the cron
	// reminder's (date, leadDay) idempotency pair; without them a same-day restore
	// re-fires a notice the user already saw. All four are optional/additive: a
	// payload written before them decodes to NULL = "no trial", the old meaning.
	TrialEndsAt          *string         `json:"trialEndsAt"`
	ConvertsToPrice      *int32          `json:"convertsToPrice"`
	TrialNotifiedAt      *string         `json:"trialNotifiedAt"`
	TrialNotifiedLeadDay *int32          `json:"trialNotifiedLeadDay"`
	CreatedAt            string          `json:"createdAt"`
	UpdatedAt            string          `json:"updatedAt"`
	Payments             []BackupPayment `json:"payments"`
}

type BackupPayment struct {
	ID     string  `json:"id"`
	Amount int32   `json:"amount"`
	PaidAt string  `json:"paidAt"`
	Note   *string `json:"note"`
}

type BackupWishlistItem struct {
	ID                   string                `json:"id"`
	Name                 string                `json:"name"`
	Category             *string               `json:"category"`
	Brand                *string               `json:"brand"`
	InitialPrice         *int32                `json:"initialPrice"`
	CurrentPrice         *int32                `json:"currentPrice"`
	BuyUrl               *string               `json:"buyUrl"`
	ImageUrl             *string               `json:"imageUrl"`
	TargetDate           *string               `json:"targetDate"`
	Priority             string                `json:"priority"`
	Status               string                `json:"status"`
	Notes                *string               `json:"notes"`
	ReminderIntervalDays *int32                `json:"reminderIntervalDays"`
	LastNotifiedAt       *string               `json:"lastNotifiedAt"`
	PurchasedDeviceId    *string               `json:"purchasedDeviceId"`
	CreatedAt            string                `json:"createdAt"`
	UpdatedAt            string                `json:"updatedAt"`
	Prices               []BackupWishlistPrice `json:"prices"`
}

type BackupWishlistPrice struct {
	ID         string  `json:"id"`
	Price      int32   `json:"price"`
	Note       *string `json:"note"`
	RecordedAt string  `json:"recordedAt"`
}

type BackupDevice struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Category      string  `json:"category"`
	Brand         *string `json:"brand"`
	Model         *string `json:"model"`
	SerialNumber  *string `json:"serialNumber"`
	PurchaseDate  string  `json:"purchaseDate"`
	PurchasePrice int32   `json:"purchasePrice"`
	PurchasePlace *string `json:"purchasePlace"`
	Status        string  `json:"status"`
	Notes         *string `json:"notes"`
	// Resale pair (migration 0006). Absent/null in older v5 backups — the
	// importer treats that as "not sold", so old exports stay restorable.
	SoldAt    *string `json:"soldAt"`
	SoldPrice *int32  `json:"soldPrice"`
	// Currency / FxRate (migration 0022, gap #16). Both are OPTIONAL and
	// `omitempty`, and that is load-bearing: a VND device exports neither key, so
	// the payload of a user who never left VND is byte-identical to the pre-0022
	// format. An older payload has neither key either, decodes to ""/nil and
	// imports as VND — which is exactly what it meant when it was written.
	//
	// FxRate is the VND value of one unit of Currency, LOCKED when the purchase
	// was recorded. Dropping it on restore would silently reinterpret a USD 999
	// phone as 999 VND, so it must travel.
	Currency string `json:"currency,omitempty"`
	FxRate   *int32 `json:"fxRate,omitempty"`
	// Brand warranty lookup (migration 0023, gap #11). All five are optional and
	// `omitempty`, for the same reason currency/fxRate are: a device whose brand
	// was never checked exports NONE of these keys, so that user's payload stays
	// byte-identical to the pre-0023 format. An older payload without them
	// imports as NULL = "never checked", which is exactly what it meant.
	//
	// Carrying them is not optional in spirit: these are the user's only record
	// of what the brand's own lookup page said, and dropping them on restore
	// would delete the evidence behind every warrantyMismatch the app shows.
	// warrantyMismatch itself is DERIVED and deliberately absent — storing it in
	// a backup would let a restored file disagree with the dates beside it.
	BrandWarrantyStatus *string `json:"brandWarrantyStatus,omitempty"`
	BrandWarrantyStart  *string `json:"brandWarrantyStart,omitempty"`
	BrandWarrantyEnd    *string `json:"brandWarrantyEnd,omitempty"`
	BrandCheckedAt      *string `json:"brandCheckedAt,omitempty"`
	BrandLookupUrl      *string `json:"brandLookupUrl,omitempty"`
	// Exchange window (migration 0010, FEATURE_IDEAS #1). Additive and optional:
	// a payload written before these existed decodes to nil, which reads as
	// "unknown window" — the correct meaning — so the payload version stays at
	// 5/6 exactly as the format's own rule requires ("raise it only when an older
	// payload would import wrongly").
	//
	// Carrying them is not optional in spirit: dropping returnWindowDays on a
	// restore would silently delete the deadline this feature exists to protect,
	// and dropping returnWindowNotifiedAt would make the next cron run re-push a
	// window the user already saw (same reason BackupReminder carries
	// lastNotifiedAt).
	ReturnWindowDays       *int32  `json:"returnWindowDays"`
	ReceivedAt             *string `json:"receivedAt"`
	ReturnWindowNotifiedAt *string `json:"returnWindowNotifiedAt"`
	// LeadDays (migration 0015) is optional in the same additive way: a payload
	// written before it existed decodes to nil, and the importer lets SQL's
	// COALESCE turn that into [30, 7] — the schedule that payload ran under.
	// Without this field a restore would silently reset every device's custom
	// reminder schedule to the default.
	LeadDays []int32 `json:"leadDays"`
	// Activation / extended cover (migration 0016, Feature A). Optional and
	// additive in exactly the same way as the two groups above: an older payload
	// decodes to false/NULL = "not required", "no deadline", "never notified".
	// Dropping activatedAt/extendedCoverBuyBy on restore would delete a
	// user-entered deadline; dropping the notified markers would let the next
	// cron re-push a reminder the user already saw.
	ActivationRequired           bool               `json:"activationRequired"`
	ActivatedAt                  *string            `json:"activatedAt"`
	ExtendedCoverBuyBy           *string            `json:"extendedCoverBuyBy"`
	ActivationNotifiedAt         *string            `json:"activationNotifiedAt"`
	ExtendedCoverNotifiedAt      *string            `json:"extendedCoverNotifiedAt"`
	ExtendedCoverNotifiedLeadDay *int32             `json:"extendedCoverNotifiedLeadDay"`
	CreatedAt                    string             `json:"createdAt"`
	UpdatedAt                    string             `json:"updatedAt"`
	Warranties                   []BackupWarranty   `json:"warranties"`
	Attachments                  []BackupAttachment `json:"attachments"`
}

type BackupWarranty struct {
	ID        string  `json:"id"`
	Type      string  `json:"type"`
	Provider  *string `json:"provider"`
	StartDate string  `json:"startDate"`
	EndDate   string  `json:"endDate"`
	Months    int32   `json:"months"`
	Cost      *int32  `json:"cost"`
	Address   *string `json:"address"`
	Phone     *string `json:"phone"`
	Notes     *string `json:"notes"`
	// Contract terms (migration 0017). Additive and optional in exactly the way
	// the device's leadDays / activation fields are: a payload exported before
	// 0017 has no such keys, decodes to nil/0, and imports as the pre-0017 state
	// (no recorded terms, zero claims used). The payload version does NOT move.
	// Dropping them on restore would delete the cap / deductible / exclusions a
	// user typed for a claim, which is the whole reason they were added.
	Component     *string          `json:"component"`
	Scope         *string          `json:"scope"`
	Cap           *int32           `json:"cap"`
	Deductible    *int32           `json:"deductible"`
	Exclusions    *string          `json:"exclusions"`
	Region        *string          `json:"region"`
	Transferable  *bool            `json:"transferable"`
	ClaimsAllowed *int32           `json:"claimsAllowed"`
	ClaimsUsed    int32            `json:"claimsUsed"`
	CreatedAt     string           `json:"createdAt"`
	UpdatedAt     string           `json:"updatedAt"`
	Reminders     []BackupReminder `json:"reminders"`
}

type BackupReminder struct {
	ID          string `json:"id"`
	IsDismissed bool   `json:"isDismissed"`
	// LastNotifiedAt is the cron dedup marker (migration 0002 + the index there):
	// the sweep skips reminders it has already pushed. Omitting it here made a
	// restore wipe the marker, so the next run re-notified warranties the user
	// had already been told about.
	LastNotifiedAt *string `json:"lastNotifiedAt"`
	// LastNotifiedLeadDay is the lead day that stamp belongs to (migration 0015).
	// Optional: a pre-0015 payload has no value, and NULL is exactly the "legacy
	// stamp" the sweep understands.
	LastNotifiedLeadDay *int32 `json:"lastNotifiedLeadDay"`
	CreatedAt           string `json:"createdAt"`
}

type BackupAttachment struct {
	ID          string  `json:"id"`
	FileName    string  `json:"fileName"`
	StoragePath string  `json:"storagePath"`
	FileType    string  `json:"fileType"`
	FileSize    int32   `json:"fileSize"`
	IV          string  `json:"iv"`         // base64
	WrappedKey  string  `json:"wrappedKey"` // base64
	Description *string `json:"description"`
	UploadedAt  string  `json:"uploadedAt"`
}

// BackupClaim is one warranty claim in the backup payload (migration 0021).
//
// Every column is carried, including closedAt: closedAt is server-managed on
// the API write path, but in a backup it is HISTORY, and dropping it on restore
// would move every resolved claim's resolution date to the import time. The
// timestamps use the same RFC3339 form as the rest of the envelope (not the
// database's offset-less form).
//
// Additive: a payload written before 0021 has no `claims` key and decodes to an
// empty list. The version stays 5/6 because an older payload imports CORRECTLY
// (the format's own rule: raise the version only when an older payload would
// import wrongly).
type BackupClaim struct {
	ID                string  `json:"id"`
	DeviceID          string  `json:"deviceId"`
	WarrantyID        *string `json:"warrantyId"`
	Status            string  `json:"status"`
	OpenedAt          string  `json:"openedAt"`
	ExpectedReturnAt  *string `json:"expectedReturnAt"`
	ClosedAt          *string `json:"closedAt"`
	TicketNumber      *string `json:"ticketNumber"`
	ServiceCenter     *string `json:"serviceCenter"`
	Issue             string  `json:"issue"`
	Diagnosis         *string `json:"diagnosis"`
	Outcome           *string `json:"outcome"`
	Cost              *int32  `json:"cost"`
	CoveredByWarranty *bool   `json:"coveredByWarranty"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

// ImportResult is returned by Import — handler folds it into the JSON envelope.
type ImportResult struct {
	Imported         int `json:"imported"`
	Skipped          int `json:"skipped"`
	WishlistImported int `json:"wishlistImported"`
	WishlistSkipped  int `json:"wishlistSkipped"`
	SubImported      int `json:"subImported"`
	SubSkipped       int `json:"subSkipped"`
	// Attachment counters, only meaningful for a .zip import
	// (?includeBlobs=true export). A metadata-only JSON import leaves them 0:
	// there are no bytes to write.
	//
	//   AttachmentsImported   — blob files written to PRIVATE_UPLOAD_ROOT.
	//   AttachmentsSkipped    — attachment rows not inserted because their device
	//                           was skipped in merge mode (their blobs are not
	//                           written either, so no orphan files appear).
	//   AttachmentsUnreadable — blobs written but NOT decryptable with this
	//                           server's FILE_MASTER_KEY (including "no key
	//                           configured"). The rows and the bytes are still
	//                           restored; the count is how the caller learns that
	//                           this server cannot open them.
	AttachmentsImported   int `json:"attachmentsImported"`
	AttachmentsSkipped    int `json:"attachmentsSkipped"`
	AttachmentsUnreadable int `json:"attachmentsUnreadable"`
	// Claim counters (migration 0021). Additive fields — an older client that
	// does not know them ignores them.
	//
	//   ClaimsImported — claim rows inserted.
	//   ClaimsSkipped  — claim rows not inserted: their id already existed in
	//                    merge mode, their device is not in the payload / not
	//                    owned by the importing account, or the id is not a safe
	//                    payload id. Their data is not duplicated or half-linked.
	ClaimsImported int `json:"claimsImported"`
	ClaimsSkipped  int `json:"claimsSkipped"`
	// Warnings are non-fatal caveats about what was restored, already rendered
	// in the request's language. Omitted when empty, so an import of a
	// self-describing (new) export keeps the old response shape.
	//
	// Today there is exactly one: a payload without `instantTimeZone` may carry
	// pre-fix local-wall-clock instants. Nothing is rewritten — the rows are
	// restored exactly as the file states (see LegacyInstantWarningVN) — but the
	// caller must be able to say so instead of presenting the data as certainly
	// correct.
	Warnings []string `json:"warnings,omitempty"`
}

// ---- Export ---------------------------------------------------------------

// ExportBackup gathers everything the user owns and returns the metadata-only v5
// payload (attachment metadata, no bytes). Unchanged behaviour: this is what
// GET /api/v1/backup/export returns without ?includeBlobs=true.
func ExportBackup(ctx context.Context, db *pgxpool.Pool, userID string) (*BackupExport, error) {
	return exportBackup(ctx, db, userID, false)
}

// exportBackup assembles the payload. withBlobs selects the v6 envelope written
// inside the .zip archive (includesAttachmentBytes=true); the row assembly is
// otherwise identical.
func exportBackup(ctx context.Context, db *pgxpool.Pool, userID string, withBlobs bool) (*BackupExport, error) {
	q := store.New(db)

	devices, err := q.BackupListDevices(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list devices: %w", err)
	}
	warranties, err := q.BackupListWarrantiesForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list warranties: %w", err)
	}
	reminders, err := q.BackupListRemindersForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list reminders: %w", err)
	}
	attachments, err := q.BackupListAttachmentsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list attachments: %w", err)
	}
	inboxAttachments, err := q.BackupListInboxAttachmentsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list inbox attachments: %w", err)
	}
	claims, err := q.BackupListClaimsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list claims: %w", err)
	}
	wishlist, err := q.BackupListWishlistForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list wishlist: %w", err)
	}
	prices, err := q.BackupListWishlistPricesForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list wishlist prices: %w", err)
	}
	subs, err := q.BackupListSubscriptionsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list subs: %w", err)
	}
	payments, err := q.BackupListPaymentsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list payments: %w", err)
	}

	// Index children by parent id for the assembly step.
	remByWarranty := map[string][]store.Reminder{}
	for _, r := range reminders {
		remByWarranty[r.WarrantyId] = append(remByWarranty[r.WarrantyId], r)
	}
	warByDevice := map[string][]store.Warranty{}
	for _, w := range warranties {
		warByDevice[w.DeviceId] = append(warByDevice[w.DeviceId], w)
	}
	attByDevice := map[string][]store.Attachment{}
	for _, a := range attachments {
		if a.DeviceId != nil {
			attByDevice[*a.DeviceId] = append(attByDevice[*a.DeviceId], a)
		}
	}
	priceByItem := map[string][]store.WishlistPrice{}
	for _, p := range prices {
		priceByItem[p.ItemId] = append(priceByItem[p.ItemId], p)
	}
	payBySub := map[string][]store.SubscriptionPayment{}
	for _, p := range payments {
		payBySub[p.SubscriptionId] = append(payBySub[p.SubscriptionId], p)
	}

	var out *BackupExport
	if withBlobs {
		out = newBlobBackupExport(ctx, len(devices), len(wishlist), len(subs))
	} else {
		out = newBackupExport(ctx, len(devices), len(wishlist), len(subs))
	}

	for _, s := range subs {
		bs := BackupSubscription{
			ID:                         s.ID,
			Name:                       s.Name,
			Category:                   s.Category,
			Brand:                      s.Brand,
			Plan:                       s.Plan,
			BillingCycle:               s.BillingCycle,
			IntervalDays:               s.IntervalDays,
			Price:                      s.Price,
			Currency:                   s.Currency,
			StartedAt:                  ts(s.StartedAt.Instant()),
			RenewalDate:                ts(s.RenewalDate.Instant()),
			AutoRenew:                  s.AutoRenew,
			Status:                     s.Status,
			AccountEmail:               s.AccountEmail,
			PaymentMethod:              s.PaymentMethod,
			ManageUrl:                  s.ManageUrl,
			CancelUrl:                  s.CancelUrl,
			Notes:                      s.Notes,
			LastNotifiedRenewalAt:      tsPtr(s.LastNotifiedRenewalAt),
			LastNotifiedRenewalLeadDay: s.LastNotifiedRenewalLeadDay,
			LeadDays:                   s.LeadDays,
			TrialEndsAt:                tsPtr(s.TrialEndsAt.Instant()),
			ConvertsToPrice:            s.ConvertsToPrice,
			TrialNotifiedAt:            tsPtr(s.TrialNotifiedAt),
			TrialNotifiedLeadDay:       s.TrialNotifiedLeadDay,
			CreatedAt:                  ts(s.CreatedAt),
			UpdatedAt:                  ts(s.UpdatedAt),
			Payments:                   []BackupPayment{},
		}
		for _, p := range payBySub[s.ID] {
			bs.Payments = append(bs.Payments, BackupPayment{
				ID:     p.ID,
				Amount: p.Amount,
				PaidAt: ts(p.PaidAt),
				Note:   p.Note,
			})
		}
		out.Subscriptions = append(out.Subscriptions, bs)
	}

	for _, w := range wishlist {
		bw := BackupWishlistItem{
			ID:                   w.ID,
			Name:                 w.Name,
			Category:             w.Category,
			Brand:                w.Brand,
			InitialPrice:         w.InitialPrice,
			CurrentPrice:         w.CurrentPrice,
			BuyUrl:               w.BuyUrl,
			ImageUrl:             w.ImageUrl,
			TargetDate:           tsPtr(w.TargetDate.Instant()),
			Priority:             w.Priority,
			Status:               w.Status,
			Notes:                w.Notes,
			ReminderIntervalDays: w.ReminderIntervalDays,
			LastNotifiedAt:       tsPtr(w.LastNotifiedAt),
			PurchasedDeviceId:    w.PurchasedDeviceId,
			CreatedAt:            ts(w.CreatedAt),
			UpdatedAt:            ts(w.UpdatedAt),
			Prices:               []BackupWishlistPrice{},
		}
		for _, p := range priceByItem[w.ID] {
			bw.Prices = append(bw.Prices, BackupWishlistPrice{
				ID:         p.ID,
				Price:      p.Price,
				Note:       p.Note,
				RecordedAt: ts(p.RecordedAt),
			})
		}
		out.Wishlist = append(out.Wishlist, bw)
	}

	for _, d := range devices {
		bd := BackupDevice{
			ID:            d.ID,
			Name:          d.Name,
			Category:      d.Category,
			Brand:         d.Brand,
			Model:         d.Model,
			SerialNumber:  d.SerialNumber,
			PurchaseDate:  ts(d.PurchaseDate.Instant()),
			PurchasePrice: d.PurchasePrice,
			PurchasePlace: d.PurchasePlace,
			Status:        d.Status,
			Notes:         d.Notes,
			SoldAt:        tsPtr(d.SoldAt.Instant()),
			SoldPrice:     d.SoldPrice,

			Currency: backupCurrencyForExport(d.Currency),
			FxRate:   d.FxRate,

			BrandWarrantyStatus: d.BrandWarrantyStatus,
			BrandWarrantyStart:  tsPtr(d.BrandWarrantyStart.Instant()),
			BrandWarrantyEnd:    tsPtr(d.BrandWarrantyEnd.Instant()),
			BrandCheckedAt:      tsPtr(d.BrandCheckedAt),
			BrandLookupUrl:      d.BrandLookupUrl,

			ReturnWindowDays:       d.ReturnWindowDays,
			ReceivedAt:             tsPtr(d.ReceivedAt.Instant()),
			ReturnWindowNotifiedAt: tsPtr(d.ReturnWindowNotifiedAt),
			LeadDays:               d.LeadDays,

			ActivationRequired:           d.ActivationRequired,
			ActivatedAt:                  tsPtr(d.ActivatedAt.Instant()),
			ExtendedCoverBuyBy:           tsPtr(d.ExtendedCoverBuyBy.Instant()),
			ActivationNotifiedAt:         tsPtr(d.ActivationNotifiedAt),
			ExtendedCoverNotifiedAt:      tsPtr(d.ExtendedCoverNotifiedAt),
			ExtendedCoverNotifiedLeadDay: d.ExtendedCoverNotifiedLeadDay,
			CreatedAt:                    ts(d.CreatedAt),
			UpdatedAt:                    ts(d.UpdatedAt),
			Warranties:                   []BackupWarranty{},
			Attachments:                  []BackupAttachment{},
		}
		for _, w := range warByDevice[d.ID] {
			bw := BackupWarranty{
				ID:            w.ID,
				Type:          w.Type,
				Provider:      w.Provider,
				StartDate:     ts(w.StartDate.Instant()),
				EndDate:       ts(w.EndDate.Instant()),
				Months:        w.Months,
				Cost:          w.Cost,
				Address:       w.Address,
				Phone:         w.Phone,
				Notes:         w.Notes,
				Component:     w.Component,
				Scope:         w.Scope,
				Cap:           w.Cap,
				Deductible:    w.Deductible,
				Exclusions:    w.Exclusions,
				Region:        w.Region,
				Transferable:  w.Transferable,
				ClaimsAllowed: w.ClaimsAllowed,
				ClaimsUsed:    w.ClaimsUsed,
				CreatedAt:     ts(w.CreatedAt),
				UpdatedAt:     ts(w.UpdatedAt),
				Reminders:     []BackupReminder{},
			}
			for _, r := range remByWarranty[w.ID] {
				bw.Reminders = append(bw.Reminders, BackupReminder{
					ID:                  r.ID,
					IsDismissed:         r.IsDismissed,
					LastNotifiedAt:      tsPtr(r.LastNotifiedAt),
					LastNotifiedLeadDay: r.LastNotifiedLeadDay,
					CreatedAt:           ts(r.CreatedAt),
				})
			}
			bd.Warranties = append(bd.Warranties, bw)
		}
		for _, a := range attByDevice[d.ID] {
			bd.Attachments = append(bd.Attachments, toBackupAttachment(a))
		}
		out.Devices = append(out.Devices, bd)
	}

	// Inbox rows travel at the top level. `omitempty` keeps the JSON identical to
	// the pre-0018 format for every user who has never captured an unfiled
	// receipt — which is every user at upgrade time.
	for _, a := range inboxAttachments {
		out.InboxAttachments = append(out.InboxAttachments, toBackupAttachment(a))
	}

	// Claims (migration 0021) travel at the top level too, for the same reason
	// the inbox does: there is no single parent shape to nest them under. A
	// claim's deviceId is carried explicitly, and warrantyId is optional. The
	// slice stays nil when the user has no claims, so `omitempty` keeps the
	// payload byte-identical to the pre-0021 format for every existing account.
	for _, c := range claims {
		out.Claims = append(out.Claims, BackupClaim{
			ID:                c.ID,
			DeviceID:          c.DeviceId,
			WarrantyID:        c.WarrantyId,
			Status:            c.Status,
			OpenedAt:          ts(c.OpenedAt),
			ExpectedReturnAt:  tsPtr(c.ExpectedReturnAt.Instant()),
			ClosedAt:          tsPtr(c.ClosedAt),
			TicketNumber:      c.TicketNumber,
			ServiceCenter:     c.ServiceCenter,
			Issue:             c.Issue,
			Diagnosis:         c.Diagnosis,
			Outcome:           c.Outcome,
			Cost:              c.Cost,
			CoveredByWarranty: c.CoveredByWarranty,
			CreatedAt:         ts(c.CreatedAt),
			UpdatedAt:         ts(c.UpdatedAt),
		})
	}

	return out, nil
}

// toBackupAttachment maps a stored Attachment row (filed or inbox) onto the
// backup payload shape. Shared by the two export sections so a future column
// cannot be added to one and forgotten in the other.
func toBackupAttachment(a store.Attachment) BackupAttachment {
	return BackupAttachment{
		ID:          a.ID,
		FileName:    a.FileName,
		StoragePath: a.StoragePath,
		FileType:    a.FileType,
		FileSize:    a.FileSize,
		IV:          base64.StdEncoding.EncodeToString(a.Iv),
		WrappedKey:  base64.StdEncoding.EncodeToString(a.WrappedKey),
		Description: a.Description,
		UploadedAt:  ts(a.UploadedAt),
	}
}

// ---- Import ---------------------------------------------------------------

// backupVersionError validates a payload version against the supported range.
//
// min/max are explicit parameters rather than reads of the package constants so
// tests can pin the range semantics at a *simulated* future bump — the scenario
// that used to destroy every existing backup (`version != current` rejected a
// v5 file the moment the writer moved to v6).
//
// Too old and too new are different failures and get different messages, both
// naming the received version: "quá cũ" for a payload older than this build
// understands, and "mới hơn" for one written by a newer build (the user should
// update the app instead of having the file rejected as corrupt).
//
// i18n: the messages are the existing Vietnamese literals wrapped in `i18n.T`,
// so the ctx must be the REQUEST's (both callers have one) and the sentence
// follows the same language as the rest of the import's answer. The error keeps
// the VALIDATION code — only the words move.
func backupVersionError(ctx context.Context, version, min, max int) error {
	if version > max {
		return &Error{Code: "VALIDATION", Message: i18n.T(ctx,
			"Bản sao lưu phiên bản %d mới hơn phiên bản ứng dụng hỗ trợ (%d). Cập nhật ứng dụng rồi thử lại.",
			version, max)}
	}
	if version < min {
		return &Error{Code: "VALIDATION", Message: i18n.T(ctx,
			"Bản sao lưu phiên bản %d quá cũ, phiên bản được hỗ trợ: %d-%d.",
			version, min, max)}
	}
	return nil
}

// backupImportWarnings returns the non-fatal caveats for this payload, rendered
// in the request's language. It reads only the provenance marker; it never
// inspects a timestamp value and never rewrites one. A future basis value is
// treated like an absent one (warn), because the importer only knows how to
// trust "UTC".
func backupImportWarnings(ctx context.Context, payload *BackupExport) []string {
	if payload == nil || payload.InstantTimeZone == BackupInstantBasisUTC {
		return nil
	}
	return []string{i18n.Text(ctx, LegacyInstantWarningVN)}
}

// ImportMode controls the wipe-first behavior.
type ImportMode string

const (
	ImportMerge   ImportMode = "merge"
	ImportReplace ImportMode = "replace"
)

// ImportBackup applies a payload to the user (metadata only — no blobs; that is
// the JSON path). On `replace` we wipe the user's existing
// devices/subs/wishlist first (single transaction so a failure mid-import leaves
// the user's data untouched).
//
// Returns a typed *Error on validation failure (matches the handler's error
// envelope translator).
func ImportBackup(ctx context.Context, db *pgxpool.Pool, userID string, payload *BackupExport, mode ImportMode) (*ImportResult, error) {
	// A v6 envelope that declares attachment bytes is the manifest of a .zip
	// archive. Importing it on its own would restore rows whose images are missing
	// — exactly the data loss the blob format exists to prevent — so say so
	// instead. (A v6 payload with no attachments has nothing to lose and imports.)
	if payload != nil && payload.IncludesAttachmentBytes && payloadHasAttachments(payload) {
		return nil, &Error{Code: "VALIDATION", Message: i18n.Text(ctx, "File data.json này là phần dữ liệu của một bản sao lưu .zip có kèm nội dung ảnh. Hãy chọn chính file .zip để khôi phục — import riêng data.json sẽ mất toàn bộ ảnh/hoá đơn.")}
	}
	return importBackup(ctx, db, userID, payload, mode, nil)
}

// payloadHasAttachments reports whether the payload carries any attachment row
// (i.e. the manifest has blobs to account for) — device-filed or inbox.
func payloadHasAttachments(payload *BackupExport) bool {
	for _, d := range payload.Devices {
		if len(d.Attachments) > 0 {
			return true
		}
	}
	return len(payload.InboxAttachments) > 0
}

// blobGetter supplies the encrypted bytes for one attachment during a .zip
// import. nil means "metadata-only import" (the JSON path): no file is written.
type blobGetter func(att BackupAttachment) ([]byte, error)

// validateBackupPayload performs everything that can be checked from the payload
// alone, BEFORE any database write — so a malicious file cannot half-wipe the
// user's data in replace mode. Extracted from ImportBackup so the .zip path can
// run the same checks before it writes any blob to disk.
//
// i18n: every refusal below is a whole-document failure (no fieldErrors), so it
// is the file's own description of what is wrong and follows the request's
// language. Only the words move: the VALIDATION code does not.
// backupCurrencyForExport returns the currency to write into the payload: empty
// for VND (the `omitempty` key then disappears, keeping a VND-only backup
// byte-identical to the pre-0022 format), the ISO code otherwise.
func backupCurrencyForExport(currency string) string {
	if currency == "" || currency == "VND" {
		return ""
	}
	return currency
}

// backupDeviceCurrency resolves a payload device's optional currency pair into
// the values to insert, applying the same rules as the live write path:
//
//   - absent / "" ⇒ VND, no rate (the pre-0022 payload meaning);
//   - VND         ⇒ no rate (a rate on a VND row is refused);
//   - non-VND     ⇒ a positive rate is REQUIRED. A payload that lost its rate
//     cannot be restored honestly — inserting it would treat a USD 999 phone as
//     999 VND — so the whole import is refused with a sentence naming the device,
//     before anything is written.
func backupDeviceCurrency(ctx context.Context, d BackupDevice) (string, *int32, error) {
	currency := fx.NormalizeCurrency(d.Currency)
	if currency == "" {
		currency = "VND"
	}
	if !fx.IsSupportedCurrency(currency) {
		return "", nil, &Error{Code: "VALIDATION", Message: i18n.T(ctx,
			"Bản sao lưu có loại tiền không hợp lệ cho thiết bị \"%s\".", d.Name)}
	}
	if currency == "VND" {
		if d.FxRate != nil {
			return "", nil, &Error{Code: "VALIDATION", Message: i18n.T(ctx,
				"Bản sao lưu ghi tỷ giá cho thiết bị \"%s\" dùng VND.", d.Name)}
		}
		return "VND", nil, nil
	}
	if d.FxRate == nil {
		return "", nil, &Error{Code: "VALIDATION", Message: i18n.T(ctx,
			"Bản sao lưu thiếu tỷ giá cho thiết bị \"%s\".", d.Name)}
	}
	if *d.FxRate <= 0 {
		return "", nil, &Error{Code: "VALIDATION", Message: i18n.T(ctx,
			"Bản sao lưu có tỷ giá không hợp lệ cho thiết bị \"%s\".", d.Name)}
	}
	return currency, d.FxRate, nil
}

// backupBrandWarranty resolves a payload device's optional brand-lookup group
// into the values to insert.
//
// It delegates the RULES to parseBrandWarranty — the same status-required,
// enum, date-order and absolute-http(s)-URL checks the live API applies — so a
// hand-edited backup cannot smuggle in a state the write path would reject. The
// only thing this wrapper adds is sentences that name the device, matching the
// other backup refusals.
//
// An older payload has all five keys absent, which decodes to nil and passes:
// "the brand was never checked" is a valid state, and import must not require a
// newer format. warrantyMismatch is not read here because it is not in the
// payload at all — it is derived on read.
func backupBrandWarranty(ctx context.Context, d BackupDevice) (brandWarrantyValues, error) {
	trimPtr(&d.BrandWarrantyStatus)
	trimPtr(&d.BrandWarrantyStart)
	trimPtr(&d.BrandWarrantyEnd)
	trimPtr(&d.BrandCheckedAt)
	trimPtr(&d.BrandLookupUrl)

	in := DeviceInput{
		BrandWarrantyStatus: d.BrandWarrantyStatus,
		BrandWarrantyStart:  d.BrandWarrantyStart,
		BrandWarrantyEnd:    d.BrandWarrantyEnd,
		BrandCheckedAt:      d.BrandCheckedAt,
		BrandLookupUrl:      d.BrandLookupUrl,
	}
	values, fieldErrors := parseBrandWarranty(ctx, &in)
	if len(fieldErrors) == 0 {
		return values, nil
	}
	switch {
	case fieldErrors["brandWarrantyStatus"] != nil && values.Status == nil:
		return values, &Error{Code: "VALIDATION", Message: i18n.T(ctx,
			"Bản sao lưu thiếu trạng thái bảo hành hãng cho thiết bị \"%s\".", d.Name)}
	case fieldErrors["brandWarrantyStatus"] != nil:
		return values, &Error{Code: "VALIDATION", Message: i18n.T(ctx,
			"Bản sao lưu có trạng thái bảo hành hãng không hợp lệ cho thiết bị \"%s\".", d.Name)}
	case fieldErrors["brandLookupUrl"] != nil:
		return values, &Error{Code: "VALIDATION", Message: i18n.T(ctx,
			"Bản sao lưu có link tra cứu bảo hành hãng không hợp lệ cho thiết bị \"%s\".", d.Name)}
	default:
		return values, &Error{Code: "VALIDATION", Message: i18n.T(ctx,
			"Bản sao lưu có ngày bảo hành hãng không hợp lệ cho thiết bị \"%s\".", d.Name)}
	}
}

func validateBackupPayload(ctx context.Context, payload *BackupExport) error {
	if payload == nil {
		return &Error{Code: "VALIDATION", Message: i18n.Text(ctx, "File JSON không hợp lệ")}
	}
	if err := backupVersionError(ctx, payload.Version, MinBackupVersion, BackupVersion); err != nil {
		return err
	}
	for _, d := range payload.Devices {
		if !safeIDRE.MatchString(d.ID) {
			return &Error{Code: "VALIDATION", Message: i18n.T(ctx, "ID thiết bị không hợp lệ: %s", d.ID)}
		}
		// The inbox segment is reserved for blobs that belong to no device. A
		// payload device using it would make `<deviceId>/<uuid>.enc` and
		// `_inbox/<uuid>.enc` the same namespace, so reject the collision before
		// any row or file is written. (Real device ids are server-generated cuids;
		// only a hand-edited backup can even attempt this.)
		if d.ID == InboxStorageSegment {
			return &Error{Code: "VALIDATION", Message: i18n.T(ctx, "ID thiết bị không hợp lệ: %s", d.ID)}
		}
		// Currency pair (migration 0022). Checked here, before the transaction,
		// because a restore cannot invent a missing rate: an invalid pair must
		// refuse the whole file rather than write a row whose VND value is a lie.
		if _, _, cerr := backupDeviceCurrency(ctx, d); cerr != nil {
			return cerr
		}
		// Brand warranty lookup (migration 0023). The same rules as the live write
		// path; an older payload with none of the keys is valid and imports as
		// NULL. Checked before the transaction so a hand-edited file cannot write
		// half a device and then abort.
		if _, berr := backupBrandWarranty(ctx, d); berr != nil {
			return berr
		}
		if len(d.Attachments) > MaxAttachmentsPerDevice {
			// The upload path caps this (services/attachments.go). A backup cannot
			// legitimately exceed it, so this can only be a tampered file — refuse it
			// rather than letting the restore create a state the upload path forbids.
			//
			// One key, not a singular/plural pair: the guard is `>`, so the count
			// here is always at least 6 and "1 attachment" is unreachable.
			return &Error{Code: "VALIDATION", Message: i18n.T(ctx,
				"Thiết bị \"%s\" có %d file đính kèm, vượt giới hạn %d file/thiết bị.",
				d.Name, len(d.Attachments), MaxAttachmentsPerDevice)}
		}
		for _, a := range d.Attachments {
			if !safeStoragePathRE.MatchString(a.StoragePath) ||
				!strings.HasPrefix(a.StoragePath, d.ID+"/") {
				return &Error{Code: "VALIDATION",
					Message: i18n.T(ctx, "Đường dẫn file không hợp lệ trong \"%s\". File backup có thể đã bị sửa.", d.Name)}
			}
			if !validBackupAttachmentKey(a) {
				return &Error{Code: "VALIDATION",
					Message: i18n.T(ctx, "Khoá file hỏng trong \"%s\".", d.Name)}
			}
		}
	}

	// Inbox attachments (migration 0018) live at the top level and must point at
	// the reserved inbox segment — a path under a device would let a hand-edited
	// payload scatter an unfiled row's blob into a device directory, and the
	// importer writes each one back to the segment its path names.
	for _, a := range payload.InboxAttachments {
		if !safeStoragePathRE.MatchString(a.StoragePath) ||
			!strings.HasPrefix(a.StoragePath, InboxStorageSegment+"/") {
			return &Error{Code: "VALIDATION", Message: i18n.T(ctx,
				"File đính kèm trong hộp thư chưa có thiết bị: đường dẫn không hợp lệ (%s).", a.StoragePath)}
		}
		if !validBackupAttachmentKey(a) {
			return &Error{Code: "VALIDATION",
				Message: i18n.Text(ctx, "File đính kèm trong hộp thư chưa có thiết bị: khoá file hỏng.")}
		}
	}

	// Claims (migration 0021) must respect the single-open-per-device rule. A
	// payload written by this server always does; a hand-edited one might not,
	// and the partial unique index would abort the whole import with a raw 23505
	// (a 500). Refuse it here, before the transaction, with a sentence that names
	// the device. This is the same "refuse before we wipe anything" discipline as
	// the attachment caps above; it is not a general validation of every claim
	// field, because a backup is restored rather than composed.
	//
	// The seen-set walks the payload in order, so the reported duplicate is
	// deterministic (the second open claim for that device) rather than whichever
	// map key happened to iterate first.
	namesByDevice := make(map[string]string, len(payload.Devices))
	for _, d := range payload.Devices {
		namesByDevice[d.ID] = d.Name
	}
	openSeen := map[string]bool{}
	for _, c := range payload.Claims {
		if !isOpenClaimStatus(c.Status) {
			continue
		}
		if openSeen[c.DeviceID] {
			name := namesByDevice[c.DeviceID]
			if name == "" {
				name = c.DeviceID
			}
			return &Error{Code: "VALIDATION", Message: i18n.T(ctx,
				"Bản sao lưu có nhiều hơn một yêu cầu bảo hành đang mở cho thiết bị \"%s\". Mỗi thiết bị chỉ được có một yêu cầu đang mở.",
				name)}
		}
		openSeen[c.DeviceID] = true
	}
	return nil
}

// validBackupAttachmentKey checks the base64 IV / wrapped-key pair shared by
// device and inbox attachments. Only the structural sizes are validated; whether
// the key actually decrypts is discovered during a blob import and reported as
// `attachmentsUnreadable`, not rejected.
func validBackupAttachmentKey(a BackupAttachment) bool {
	iv, ivErr := base64.StdEncoding.DecodeString(a.IV)
	wk, wkErr := base64.StdEncoding.DecodeString(a.WrappedKey)
	return ivErr == nil && wkErr == nil && len(iv) == 12 && len(wk) >= 28
}

// assertBackupDeviceQuota applies the device ceilings (FEATURE_IDEAS #14) to an
// import before anything is written.
//
// The base differs by mode, which is the only subtle part:
//   - `replace` deletes every device the user owns inside the transaction, so
//     the base is ZERO. Counting the rows that are about to be wiped would
//     refuse a perfectly legal restore of an over-quota account onto itself.
//   - `merge` keeps them, so they count — and, symmetrically, a payload device
//     whose id the user ALREADY owns is skipped by the insert loop and must not
//     be counted as incoming either. Without that, re-importing your own backup
//     at the ceiling would be refused for "adding" devices you already have.
func assertBackupDeviceQuota(ctx context.Context, db *pgxpool.Pool, userID string, payload *BackupExport, mode ImportMode) error {
	if payload == nil || len(payload.Devices) == 0 {
		return nil
	}
	q := store.New(db)

	var baseActive, baseTotal int64
	owned := map[string]bool{}
	if mode != ImportReplace {
		var err error
		baseActive, err = q.CountActiveDevicesByUser(ctx, userID)
		if err != nil {
			return fmt.Errorf("count active devices: %w", err)
		}
		baseTotal, err = q.CountAllDevicesByUser(ctx, userID)
		if err != nil {
			return fmt.Errorf("count all devices: %w", err)
		}
	}
	if mode == ImportMerge {
		rows, err := q.ListDevicesByUserSimple(ctx, userID)
		if err != nil {
			return fmt.Errorf("list devices: %w", err)
		}
		for _, r := range rows {
			owned[r.ID] = true
		}
	}

	var incomingActive, incomingTotal int64
	for _, d := range payload.Devices {
		if mode == ImportMerge && owned[d.ID] {
			continue
		}
		incomingTotal++
		incomingActive += deviceActiveIncoming(d.Status)
	}
	return enforceDeviceQuota(ctx, baseActive, baseTotal, incomingActive, incomingTotal)
}

// assertBackupClaimQuota applies MAX_CLAIMS_PER_USER to an import before
// anything is written. It mirrors assertBackupDeviceQuota:
//
//   - `replace` deletes every claim the user owns inside the transaction, so the
//     base is ZERO (restoring an at-the-limit account onto itself is legal), and
//     only claims whose device is in the payload can be inserted afterwards (the
//     rest were just wiped with their device).
//   - `merge` keeps them, so they count; a payload claim whose id the user
//     already owns is skipped by the insert loop and is not counted as incoming.
//     Every other safe claim id is counted, even one whose device is not in the
//     payload: merge leaves that device in place, the loop can still attach the
//     claim to it, and over-counting is the safe direction for a ceiling.
func assertBackupClaimQuota(ctx context.Context, db *pgxpool.Pool, userID string, payload *BackupExport, mode ImportMode) error {
	if payload == nil || len(payload.Claims) == 0 {
		return nil
	}
	q := store.New(db)

	var base int64
	owned := map[string]bool{}
	if mode != ImportReplace {
		var err error
		base, err = q.CountClaimsByUser(ctx, userID)
		if err != nil {
			return fmt.Errorf("count claims: %w", err)
		}
	}
	if mode == ImportMerge {
		rows, err := q.BackupListClaimsForUser(ctx, userID)
		if err != nil {
			return fmt.Errorf("list claims: %w", err)
		}
		for _, r := range rows {
			owned[r.ID] = true
		}
	}

	deviceInPayload := make(map[string]bool, len(payload.Devices))
	for _, d := range payload.Devices {
		deviceInPayload[d.ID] = true
	}
	var incoming int64
	for _, c := range payload.Claims {
		if !safeIDRE.MatchString(c.ID) {
			continue
		}
		if mode == ImportMerge {
			if owned[c.ID] {
				continue
			}
		} else if !deviceInPayload[c.DeviceID] {
			continue
		}
		incoming++
	}
	if base+incoming > MaxClaimsPerUser {
		return ErrLimit(i18n.T(ctx,
			"Đã đạt giới hạn %d yêu cầu bảo hành khi khôi phục. Xoá bớt yêu cầu cũ rồi thử lại.",
			MaxClaimsPerUser))
	}
	return nil
}

// importBackup is the shared import body. `blobs` is non-nil only for the .zip
// path; when it is set, each attachment row that is actually inserted gets its
// ciphertext written to <PRIVATE_UPLOAD_ROOT>/<storagePath> in the same pass, and
// every file written is deleted again if the transaction does not commit (no
// orphan blobs pointing at rows that were rolled back).
func importBackup(ctx context.Context, db *pgxpool.Pool, userID string, payload *BackupExport, mode ImportMode, blobs blobGetter) (*ImportResult, error) {
	if err := validateBackupPayload(ctx, payload); err != nil {
		return nil, err
	}
	if mode == "" {
		mode = ImportMerge
	}
	if mode != ImportMerge && mode != ImportReplace {
		return nil, &Error{Code: "VALIDATION", Message: i18n.Text(ctx, "Mode không hợp lệ")}
	}

	// IDs are globally unique (all ten tables have a text primary key, not a
	// per-user one), so a payload built by ANOTHER account collides with rows this
	// user does not own and the insert fails on the primary key — which the handler
	// could only render as a 500. Detect it here, before the transaction (and
	// before the replace-mode wipe), and answer with a clear 400.
	//
	// Runs in BOTH modes: merge skips ids the importing user owns, and replace
	// deletes them, so the query — which only reports rows owned by a *different*
	// account — never flags a legitimate own-backup row. Skipping the check in
	// replace mode would let it wipe the user's data and then 500 on the foreign
	// row, which is strictly worse.
	if err := assertNoForeignBackupIDs(ctx, db, userID, payload); err != nil {
		return nil, err
	}

	// Device ceilings (FEATURE_IDEAS #14, hazard 2). CreateDevice enforces them,
	// but this is a SECOND write path into the same table and used to skip the
	// check entirely — so a 5.000-device file could be restored into an account
	// that can only ever create 50. Runs BEFORE the transaction (and before the
	// replace-mode wipe) so a refused import leaves the account untouched.
	if err := assertBackupDeviceQuota(ctx, db, userID, payload, mode); err != nil {
		return nil, err
	}

	// Claim ceiling (migration 0021), same discipline: this is the second write
	// path into "Claim" and must enforce MAX_CLAIMS_PER_USER before the
	// transaction (and before the replace-mode wipe).
	if err := assertBackupClaimQuota(ctx, db, userID, payload, mode); err != nil {
		return nil, err
	}

	root := files.PrivateUploadRoot()
	written := make([]string, 0, 8)
	committed := false
	if blobs != nil {
		defer func() {
			if committed {
				return
			}
			// Roll back the files too: the rows are gone, so the blobs would be
			// unreachable orphans.
			for _, p := range written {
				_ = files.DeleteEncrypted(root, p)
			}
		}()
	}
	master, masterErr := files.LoadMasterKey()

	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := store.New(tx)

	if mode == ImportReplace {
		// Order matters: child rows first to satisfy FK in the absence of
		// CASCADE delete (some FKs use CASCADE, but a single pass is safer).
		// Claims go before warranties/devices: their warrantyId FK would SET NULL
		// and their deviceId FK would CASCADE, so deleting them explicitly keeps
		// the wipe deterministic and makes a future FK change harmless.
		if err := q.BackupDeleteClaimsForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe claims: %w", err)
		}
		if err := q.BackupDeleteAttachmentsForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe attachments: %w", err)
		}
		if err := q.BackupDeleteRemindersForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe reminders: %w", err)
		}
		if err := q.BackupDeleteWarrantiesForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe warranties: %w", err)
		}
		if err := q.BackupDeleteWishlistPricesForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe wishlist prices: %w", err)
		}
		if err := q.BackupDeleteWishlistForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe wishlist: %w", err)
		}
		if err := q.BackupDeletePaymentsForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe payments: %w", err)
		}
		if err := q.BackupDeleteSubscriptionsForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe subscriptions: %w", err)
		}
		if err := q.BackupDeleteDevicesForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe devices: %w", err)
		}
	}

	res := &ImportResult{Warnings: backupImportWarnings(ctx, payload)}

	// restoreBlob writes one attachment's ciphertext to the segment its row
	// belongs to and updates the import counters. Shared by device-filed and
	// inbox rows so the .zip path cannot treat one class differently from the
	// other. `segment` is the device id or InboxStorageSegment.
	restoreBlob := func(a BackupAttachment, segment string) error {
		if blobs == nil {
			return nil
		}
		ct, berr := blobs(a)
		if berr != nil {
			return berr
		}
		if ct == nil {
			// The envelope itself marked this attachment as missing on the export
			// side: restore the row, no bytes. Counted as unreadable so the caller
			// can tell the user which restore needs attention.
			res.AttachmentsUnreadable++
			return nil
		}
		if _, werr := files.WriteEncrypted(root, segment, filepath.Base(a.StoragePath), ct); werr != nil {
			return &Error{Code: "VALIDATION", Message: i18n.T(ctx,
				"Không ghi được file đính kèm \"%s\" ra đĩa.", a.FileName)}
		}
		written = append(written, a.StoragePath)
		// Verify while we still have the plaintext key material at hand: if the
		// archive came from a server with a different FILE_MASTER_KEY the bytes
		// are intact but unreadable here, and the caller must be told that
		// instead of discovering it when the user opens the invoice.
		iv, _ := base64.StdEncoding.DecodeString(a.IV)
		wk, _ := base64.StdEncoding.DecodeString(a.WrappedKey)
		if masterErr == nil {
			if _, derr := files.Decrypt(ct, iv, wk, master); derr != nil {
				res.AttachmentsUnreadable++
			}
		} else {
			res.AttachmentsUnreadable++
		}
		res.AttachmentsImported++
		return nil
	}

	for _, d := range payload.Devices {
		if mode == ImportMerge {
			// Skip if user already owns a device with this id.
			if _, gerr := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: d.ID, UserId: userID}); gerr == nil {
				res.Skipped++
				// Its attachment rows are skipped with it, so their blobs must NOT be
				// written either — otherwise every merge import would leave orphan
				// ciphertext on disk.
				res.AttachmentsSkipped += len(d.Attachments)
				continue
			}
		}
		// Normalised/validated before the insert. validateBackupPayload has already
		// rejected a malformed pair, so this cannot fail here except on a payload
		// mutated between validation and this loop (it cannot be); the error path is
		// kept because the helper is the single definition of the rule.
		currency, fxRate, cerr := backupDeviceCurrency(ctx, d)
		if cerr != nil {
			return nil, cerr
		}
		// Re-run at write time for the same reason currency is: validation ran
		// before the transaction, but the helper is the single definition of the
		// rule and this loop must not insert an unchecked value.
		brandWarranty, berr := backupBrandWarranty(ctx, d)
		if berr != nil {
			return nil, berr
		}
		if err := q.BackupInsertDevice(ctx, store.BackupInsertDeviceParams{
			ID:            d.ID,
			UserId:        userID,
			Name:          d.Name,
			Category:      d.Category,
			Brand:         d.Brand,
			Model:         d.Model,
			SerialNumber:  d.SerialNumber,
			PurchaseDate:  pgts(d.PurchaseDate).Day(),
			PurchasePrice: d.PurchasePrice,
			PurchasePlace: d.PurchasePlace,
			Status:        d.Status,
			Notes:         d.Notes,
			SoldAt:        pgtsPtr(d.SoldAt).Day(),
			SoldPrice:     d.SoldPrice,

			Currency: currency,
			FxRate:   fxRate,

			BrandWarrantyStatus: brandWarranty.Status,
			BrandWarrantyStart:  brandWarranty.Start,
			BrandWarrantyEnd:    brandWarranty.End,
			BrandCheckedAt:      brandWarranty.CheckedAt,
			BrandLookupUrl:      brandWarranty.LookupURL,

			ReturnWindowDays:             d.ReturnWindowDays,
			ReceivedAt:                   pgtsPtr(d.ReceivedAt).Day(),
			ReturnWindowNotifiedAt:       pgtsPtr(d.ReturnWindowNotifiedAt),
			LeadDays:                     backupLeadDays(d.LeadDays),
			ActivationRequired:           d.ActivationRequired,
			ActivatedAt:                  pgtsPtr(d.ActivatedAt).Day(),
			ExtendedCoverBuyBy:           pgtsPtr(d.ExtendedCoverBuyBy).Day(),
			ActivationNotifiedAt:         pgtsPtr(d.ActivationNotifiedAt),
			ExtendedCoverNotifiedAt:      pgtsPtr(d.ExtendedCoverNotifiedAt),
			ExtendedCoverNotifiedLeadDay: d.ExtendedCoverNotifiedLeadDay,
			CreatedAt:                    pgts(d.CreatedAt),
			UpdatedAt:                    pgts(d.UpdatedAt),
		}); err != nil {
			return nil, fmt.Errorf("insert device: %w", err)
		}
		for _, w := range d.Warranties {
			if !safeIDRE.MatchString(w.ID) {
				continue
			}
			// Deliberately NOT capped at MaxWarrantiesPerDevice. A restore
			// replays one device's own history and never appends to a device
			// that already exists (merge skips ids the user owns, so a new
			// device id is always a fresh device; replace starts from zero).
			// Refusing a payload with six rows would also strand the very
			// legacy devices the live check must keep editable — a backup this
			// server itself wrote before that check existed. Attachments are
			// different: a payload with six cannot have come from this server,
			// which is why validateBackupPayload refuses that one.
			if err := q.BackupInsertWarranty(ctx, store.BackupInsertWarrantyParams{
				ID:            w.ID,
				DeviceId:      d.ID,
				Type:          w.Type,
				Provider:      w.Provider,
				StartDate:     pgts(w.StartDate).Day(),
				EndDate:       pgts(w.EndDate).Day(),
				Months:        w.Months,
				Cost:          w.Cost,
				Address:       w.Address,
				Phone:         w.Phone,
				Notes:         w.Notes,
				Component:     w.Component,
				Scope:         w.Scope,
				Cap:           w.Cap,
				Deductible:    w.Deductible,
				Exclusions:    w.Exclusions,
				Region:        w.Region,
				Transferable:  w.Transferable,
				ClaimsAllowed: w.ClaimsAllowed,
				ClaimsUsed:    w.ClaimsUsed,
				CreatedAt:     pgts(w.CreatedAt),
				UpdatedAt:     pgts(w.UpdatedAt),
			}); err != nil {
				return nil, fmt.Errorf("insert warranty: %w", err)
			}
			for _, r := range w.Reminders {
				if !safeIDRE.MatchString(r.ID) {
					continue
				}
				if err := q.BackupInsertReminder(ctx, store.BackupInsertReminderParams{
					ID:                  r.ID,
					WarrantyId:          w.ID,
					IsDismissed:         r.IsDismissed,
					LastNotifiedAt:      pgtsPtr(r.LastNotifiedAt),
					LastNotifiedLeadDay: r.LastNotifiedLeadDay,
					CreatedAt:           pgts(r.CreatedAt),
				}); err != nil {
					return nil, fmt.Errorf("insert reminder: %w", err)
				}
			}
		}
		for _, a := range d.Attachments {
			if !safeIDRE.MatchString(a.ID) {
				res.AttachmentsSkipped++
				continue
			}
			iv, _ := base64.StdEncoding.DecodeString(a.IV)
			wk, _ := base64.StdEncoding.DecodeString(a.WrappedKey)
			deviceID := d.ID
			if err := q.BackupInsertAttachment(ctx, store.BackupInsertAttachmentParams{
				ID:          a.ID,
				UserId:      userID,
				DeviceId:    &deviceID,
				FileName:    a.FileName,
				StoragePath: a.StoragePath,
				FileType:    a.FileType,
				FileSize:    a.FileSize,
				Iv:          iv,
				WrappedKey:  wk,
				Description: a.Description,
				UploadedAt:  pgts(a.UploadedAt),
			}); err != nil {
				return nil, fmt.Errorf("insert attachment: %w", err)
			}
			if err := restoreBlob(a, deviceID); err != nil {
				return nil, err
			}
		}
		res.Imported++
	}

	// Inbox attachments (migration 0018) have no device to be skipped with, so
	// merge-mode idempotency is enforced per row: an id the importing user
	// already owns is skipped (a repeated merge import of the same backup must
	// not 500 on the primary key), a foreign id was refused before the
	// transaction by assertNoForeignBackupIDs.
	for _, a := range payload.InboxAttachments {
		if !safeIDRE.MatchString(a.ID) {
			res.AttachmentsSkipped++
			continue
		}
		if mode == ImportMerge {
			if _, gerr := q.GetAttachmentByID(ctx, store.GetAttachmentByIDParams{ID: a.ID, UserId: userID}); gerr == nil {
				res.AttachmentsSkipped++
				continue
			} else if !errors.Is(gerr, pgx.ErrNoRows) {
				return nil, fmt.Errorf("check inbox attachment: %w", gerr)
			}
		}
		iv, _ := base64.StdEncoding.DecodeString(a.IV)
		wk, _ := base64.StdEncoding.DecodeString(a.WrappedKey)
		if err := q.BackupInsertAttachment(ctx, store.BackupInsertAttachmentParams{
			ID:          a.ID,
			UserId:      userID,
			DeviceId:    nil, // inbox
			FileName:    a.FileName,
			StoragePath: a.StoragePath,
			FileType:    a.FileType,
			FileSize:    a.FileSize,
			Iv:          iv,
			WrappedKey:  wk,
			Description: a.Description,
			UploadedAt:  pgts(a.UploadedAt),
		}); err != nil {
			return nil, fmt.Errorf("insert inbox attachment: %w", err)
		}
		if err := restoreBlob(a, InboxStorageSegment); err != nil {
			return nil, err
		}
	}

	// Claims (migration 0021) are inserted after the device loop so their device
	// (and, for a new device, its warranties) already exist. Three cases are
	// skipped rather than failed:
	//
	//   * merge mode and the claim id already belongs to the user — a repeated
	//     merge import must not 500 on the primary key;
	//   * the claim's device is not in the payload and is not owned by the user
	//     (a hand-edited file, or a claim for a device that was itself skipped);
	//   * the id is not a safe payload id.
	//
	// A warrantyId that does not resolve to a warranty of the SAME device is
	// nulled rather than failing the whole restore: the same "drop a broken link,
	// do not lose the row" rule the wishlist importer uses for purchasedDeviceId.
	// The FK cannot express that rule (it only knows the warranty exists), and
	// the claim's own fields are still valid history.
	for _, c := range payload.Claims {
		if !safeIDRE.MatchString(c.ID) {
			res.ClaimsSkipped++
			continue
		}
		claimDevice, gerr := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{
			ID: c.DeviceID, UserId: userID,
		})
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				res.ClaimsSkipped++
				continue
			}
			return nil, fmt.Errorf("check claim device: %w", gerr)
		}
		if mode == ImportMerge {
			if _, gerr := q.GetClaimByID(ctx, store.GetClaimByIDParams{
				ID: c.ID, UserId: userID,
			}); gerr == nil {
				res.ClaimsSkipped++
				continue
			} else if !errors.Is(gerr, pgx.ErrNoRows) {
				return nil, fmt.Errorf("check claim: %w", gerr)
			}
		}

		var warrantyID *string
		if c.WarrantyID != nil && *c.WarrantyID != "" {
			w, werr := q.GetWarrantyByID(ctx, store.GetWarrantyByIDParams{
				ID: *c.WarrantyID, UserId: userID,
			})
			if werr == nil && w.DeviceId == c.DeviceID {
				id := *c.WarrantyID
				warrantyID = &id
			} else if werr != nil && !errors.Is(werr, pgx.ErrNoRows) {
				return nil, fmt.Errorf("check claim warranty: %w", werr)
			}
		}

		// The API always writes openedAt, so a missing/unparseable one can only
		// come from a hand-edited file; fall back to createdAt and then to now
		// so the NOT NULL column is always satisfied.
		openedAt := pgts(c.OpenedAt)
		if !openedAt.Valid {
			openedAt = pgts(c.CreatedAt)
		}
		if !openedAt.Valid {
			openedAt = wire.At(time.Now().UTC())
		}
		createdAt := pgts(c.CreatedAt)
		if !createdAt.Valid {
			createdAt = openedAt
		}
		updatedAt := pgts(c.UpdatedAt)
		if !updatedAt.Valid {
			updatedAt = createdAt
		}

		// closedAt is server-managed on the API path, but a backup preserves the
		// date the claim actually closed. Normalise it to the same invariant the
		// API enforces: terminal status ⇒ a value (falling back to openedAt for
		// a hand-edited file), open/unknown status ⇒ NULL. Shared with the API
		// rule through isClosedClaimStatus.
		if err := q.BackupInsertClaim(ctx, store.BackupInsertClaimParams{
			ID:                c.ID,
			DeviceId:          c.DeviceID,
			WarrantyId:        warrantyID,
			Status:            c.Status,
			OpenedAt:          openedAt,
			ExpectedReturnAt:  pgtsPtr(c.ExpectedReturnAt).Day(),
			ClosedAt:          closedAtValue(c.Status, c.ClosedAt, openedAt),
			TicketNumber:      c.TicketNumber,
			ServiceCenter:     c.ServiceCenter,
			Issue:             c.Issue,
			Diagnosis:         c.Diagnosis,
			Outcome:           c.Outcome,
			Cost:              c.Cost,
			CoveredByWarranty: c.CoveredByWarranty,
			CreatedAt:         createdAt,
			UpdatedAt:         updatedAt,
		}); err != nil {
			// A merge import can collide with an open claim the account already
			// has on this device (a hand-edited payload, or two exports merged by
			// hand). validateBackupPayload caught duplicates WITHIN the payload;
			// this is the conflict with the database. Refuse with a 400 naming the
			// device instead of letting the partial unique index surface as a 500.
			if isClaimOpenUniqueViolation(err) {
				return nil, &Error{Code: "VALIDATION", Message: i18n.T(ctx,
					"Không thể khôi phục yêu cầu bảo hành cho thiết bị \"%s\": thiết bị đã có một yêu cầu đang mở khác.",
					claimDevice.Name)}
			}
			return nil, fmt.Errorf("insert claim: %w", err)
		}
		res.ClaimsImported++
	}

	for _, w := range payload.Wishlist {
		if !safeIDRE.MatchString(w.ID) {
			continue
		}
		// If purchasedDeviceId references a device this user does not own,
		// drop the link rather than failing.
		var purchasedDevice *string
		if w.PurchasedDeviceId != nil && *w.PurchasedDeviceId != "" {
			id := *w.PurchasedDeviceId
			if _, gerr := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: id, UserId: userID}); gerr == nil {
				purchasedDevice = &id
			}
		}
		if mode == ImportMerge {
			if _, gerr := q.GetWishlistByID(ctx, store.GetWishlistByIDParams{ID: w.ID, UserId: userID}); gerr == nil {
				res.WishlistSkipped++
				continue
			}
		}
		if err := q.BackupInsertWishlistItem(ctx, store.BackupInsertWishlistItemParams{
			ID:                   w.ID,
			UserId:               userID,
			Name:                 w.Name,
			Category:             w.Category,
			Brand:                w.Brand,
			InitialPrice:         w.InitialPrice,
			CurrentPrice:         w.CurrentPrice,
			BuyUrl:               w.BuyUrl,
			ImageUrl:             w.ImageUrl,
			TargetDate:           pgtsPtr(w.TargetDate).Day(),
			Priority:             w.Priority,
			Status:               w.Status,
			Notes:                w.Notes,
			ReminderIntervalDays: w.ReminderIntervalDays,
			LastNotifiedAt:       pgtsPtr(w.LastNotifiedAt),
			PurchasedDeviceId:    purchasedDevice,
			CreatedAt:            pgts(w.CreatedAt),
			UpdatedAt:            pgts(w.UpdatedAt),
		}); err != nil {
			return nil, fmt.Errorf("insert wishlist: %w", err)
		}
		for _, p := range w.Prices {
			if !safeIDRE.MatchString(p.ID) {
				continue
			}
			if err := q.BackupInsertWishlistPrice(ctx, store.BackupInsertWishlistPriceParams{
				ID:         p.ID,
				ItemId:     w.ID,
				Price:      p.Price,
				Note:       p.Note,
				RecordedAt: pgts(p.RecordedAt),
			}); err != nil {
				return nil, fmt.Errorf("insert wishlist price: %w", err)
			}
		}
		res.WishlistImported++
	}

	for _, s := range payload.Subscriptions {
		if !safeIDRE.MatchString(s.ID) {
			continue
		}
		if mode == ImportMerge {
			if _, gerr := q.GetSubscriptionByID(ctx, store.GetSubscriptionByIDParams{ID: s.ID, UserId: userID}); gerr == nil {
				res.SubSkipped++
				continue
			}
		}
		currency := s.Currency
		if currency == "" {
			currency = "VND"
		}
		if err := q.BackupInsertSubscription(ctx, store.BackupInsertSubscriptionParams{
			ID:                         s.ID,
			UserId:                     userID,
			Name:                       s.Name,
			Category:                   s.Category,
			Brand:                      s.Brand,
			Plan:                       s.Plan,
			BillingCycle:               s.BillingCycle,
			IntervalDays:               s.IntervalDays,
			Price:                      s.Price,
			Currency:                   currency,
			StartedAt:                  pgts(s.StartedAt).Day(),
			RenewalDate:                pgts(s.RenewalDate).Day(),
			AutoRenew:                  s.AutoRenew,
			Status:                     s.Status,
			AccountEmail:               s.AccountEmail,
			PaymentMethod:              s.PaymentMethod,
			ManageUrl:                  s.ManageUrl,
			CancelUrl:                  s.CancelUrl,
			Notes:                      s.Notes,
			LastNotifiedRenewalAt:      pgtsPtr(s.LastNotifiedRenewalAt),
			LastNotifiedRenewalLeadDay: s.LastNotifiedRenewalLeadDay,
			LeadDays:                   backupLeadDays(s.LeadDays),
			TrialEndsAt:                pgtsPtr(s.TrialEndsAt).Day(),
			ConvertsToPrice:            s.ConvertsToPrice,
			TrialNotifiedAt:            pgtsPtr(s.TrialNotifiedAt),
			TrialNotifiedLeadDay:       s.TrialNotifiedLeadDay,
			CreatedAt:                  pgts(s.CreatedAt),
			UpdatedAt:                  pgts(s.UpdatedAt),
		}); err != nil {
			return nil, fmt.Errorf("insert subscription: %w", err)
		}
		for _, p := range s.Payments {
			if !safeIDRE.MatchString(p.ID) {
				continue
			}
			if err := q.BackupInsertPayment(ctx, store.BackupInsertPaymentParams{
				ID:             p.ID,
				SubscriptionId: s.ID,
				Amount:         p.Amount,
				PaidAt:         pgts(p.PaidAt),
				Note:           p.Note,
			}); err != nil {
				return nil, fmt.Errorf("insert payment: %w", err)
			}
		}
		res.SubImported++
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	committed = true
	return res, nil
}

// ---- helpers --------------------------------------------------------------

func ts(t wire.Instant) string {
	if !t.Valid {
		return ""
	}
	return t.Time.UTC().Format(time.RFC3339Nano)
}

func tsPtr(t wire.Instant) *string {
	if !t.Valid {
		return nil
	}
	s := t.Time.UTC().Format(time.RFC3339Nano)
	return &s
}

// pgts parses an RFC3339 (with or without nanos) or "YYYY-MM-DD" string into
// a wire.Instant. Empty / unparseable strings yield an invalid timestamp
// — caller is expected to have validated upstream.
func pgts(s string) wire.Instant {
	s = strings.TrimSpace(s)
	if s == "" {
		return wire.Instant{}
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return wire.At(t.UTC())
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return wire.At(t.UTC())
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return wire.At(t.UTC())
	}
	return wire.Instant{}
}

func pgtsPtr(s *string) wire.Instant {
	if s == nil {
		return wire.Instant{}
	}
	return pgts(*s)
}

// closedAtValue resolves the closedAt column for an imported claim
// (migration 0021). The row must satisfy the same invariant as the API write
// path, because clients rely on it:
//
//   - terminal status (RESOLVED / REJECTED / CANCELLED) ⇒ a timestamp. The
//     payload's value wins; a hand-edited file without one falls back to
//     openedAt (not NOW), so the resolution cannot look later than a closure
//     that is already in the past.
//   - OPEN / IN_REPAIR (or an unknown status) ⇒ NULL. "Cleared if it moves
//     back" is the same rule resolveClaimClosedAt applies on PATCH.
func closedAtValue(status string, raw *string, openedAt wire.Instant) wire.Instant {
	if !isClosedClaimStatus(status) {
		return wire.Instant{}
	}
	if t := pgtsPtr(raw); t.Valid {
		return t
	}
	return openedAt
}
