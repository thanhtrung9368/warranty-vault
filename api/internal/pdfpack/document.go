// Package pdfpack builds the insurance-ready PDF for a Warrly account.
//
// The document is ALWAYS Vietnamese, regardless of `?lang=` or
// `Accept-Language`. That is deliberate: the reader is a Vietnamese insurer or
// adjuster who never chose a language in this app, and the same rule already
// governs transactional email and the public handover certificate. The strings
// therefore live next to the layout code in vietnamese.go, not in the i18n
// catalog — a catalog lookup would make the document follow the requester's
// language, which is the one thing this artifact must not do.
//
// # Contents, in order
//
//  1. cover page — account, generation timestamp, provenance statement;
//  2. schedule table — one row per device, with the VND total;
//  3. one detail section per device — facts, warranties, claims, embedded
//     receipt/product images;
//  4. manifest — every attachment, including the ones that could not be
//     embedded, so a missing photo is visibly missing.
//
// # Pagination and overflow
//
// The builder measures every string before it draws it. Text is word-wrapped,
// table rows are clipped to a fixed number of lines with a visible "…", and a
// paragraph that does not fit continues on the next page. gopdf deliberately
// has no automatic page break; the builder owns every break, which is what makes
// "five warranties with long exclusions" a multi-page document instead of a
// broken one.
//
// # Image budget
//
// The caller (internal/services) decrypts, bounds and re-encodes images; see the
// constants below for the shared limits and the reasons.
package pdfpack

import "time"

// Image limits shared with the service layer. They are defined here, next to the
// layout that consumes them, so the endpoint description, the service and the
// tests cannot drift.
const (
	// MaxImagesPerDevice is how many attachments are embedded per device.
	//
	// The write path allows five attachments per device. Two is the number that
	// is worth printing at a legible size on one page (typically the receipt and
	// the product/box photo); the rest are still listed in the manifest. A
	// larger figure would turn every device page into an image dump and make the
	// document useless to an adjuster.
	MaxImagesPerDevice = 2

	// MaxImageDimension is the longest side, in pixels, of an embedded image.
	//
	// The upload pipeline already caps the stored image at 1600 px. 1200 px is
	// still roughly 150 dpi at the 120 mm print width used here, and keeps a
	// 100-image document in the low tens of megabytes instead of hundreds.
	MaxImageDimension = 1200

	// MaxImagesPerDocument bounds the total work for one request: 2 images ×
	// 50 active devices (the per-account active-device ceiling). A request with
	// includeSold=true can address up to 500 devices; anything past this budget
	// stays in the manifest with an explicit reason rather than making the
	// request unbounded.
	MaxImagesPerDocument = 100

	// MaxImagePixels rejects a decompression bomb before decoding. A 5 MB PNG
	// can describe a gigapixel canvas; 24 MP is far above any phone photo the
	// upload cap accepts and far below what would exhaust memory.
	MaxImagePixels = 24_000_000
)

// Document is the fully resolved input to Build. The service layer owns data
// access, ownership filtering and attachment decryption; this package only lays
// out what it is given.
type Document struct {
	// GeneratedAt is rendered in Vietnam time (UTC+7), never the server's zone.
	GeneratedAt time.Time
	Account     Account
	Devices     []Device
	// IncludeSold records whether sold devices were requested, so the cover can
	// state the scope honestly instead of leaving the reader to guess.
	IncludeSold bool
}

// Account is the owner shown on the cover.
type Account struct {
	DisplayName string
	Email       string
}

// Device is one row of the schedule and one detail section.
type Device struct {
	Name         string
	Brand        string
	Model        string
	SerialNumber string
	PurchaseDate *time.Time
	// PurchasePrice is in Currency; PurchasePriceVND is the value locked by the
	// fxRate captured when the device was entered. nil means "unknown" and is
	// never treated as zero in the total.
	PurchasePrice    int32
	Currency         string
	PurchasePriceVND *int64
	// EffectiveWarrantyEnd is max(EndDate) across the device's warranties.
	EffectiveWarrantyEnd *time.Time
	Status               string
	SoldAt               *time.Time
	SoldPrice            *int32
	SoldPriceVND         *int64
	Warranties           []Warranty
	Claims               []Claim
	Images               []Image
	// Attachments is the manifest slice: EVERY attachment row, including the
	// ones not embedded.
	Attachments []Attachment
}

// Warranty mirrors the row fields the document must show.
type Warranty struct {
	Type       string
	Provider   string
	StartDate  *time.Time
	EndDate    *time.Time
	Months     int32
	Cost       *int32
	Address    string
	Phone      string
	Notes      string
	Component  string
	Scope      string
	Cap        *int32
	Deductible *int32
	Exclusions string
	Region     string
	// Transferable is tri-state: nil = not recorded.
	Transferable  *bool
	ClaimsAllowed *int32
	ClaimsUsed    int32
}

// Claim is a warranty claim rendered under its device. Cost is always VND
// (the claim API stores it in VND, unlike Warranty.Cost, which uses the
// device's currency).
type Claim struct {
	Status            string
	OpenedAt          *time.Time
	ClosedAt          *time.Time
	TicketNumber      string
	ServiceCenter     string
	Issue             string
	Diagnosis         string
	Outcome           string
	Cost              *int32
	CoveredByWarranty *bool
}

// Image is an attachment already decrypted, resized and re-encoded as JPEG by
// the service. Width/Height are the encoded pixel dimensions.
type Image struct {
	FileName    string
	Description string
	Data        []byte
	Width       int
	Height      int
}

// Attachment is one manifest row.
type Attachment struct {
	FileName    string
	FileType    string
	Description string
	Status      ManifestStatus
}

// ManifestStatus explains why an attachment is or is not embedded. The service
// sets it; the builder turns it into the Vietnamese sentence in the manifest.
type ManifestStatus string

const (
	// ManifestEmbedded means the image is printed in its device section.
	ManifestEmbedded ManifestStatus = "EMBEDDED"
	// ManifestNotEmbeddable means HEIC/PDF (or another non-raster type): the
	// document lists it with a note instead of failing.
	ManifestNotEmbeddable ManifestStatus = "NOT_EMBEDDABLE"
	// ManifestImageLimit means the device already has MaxImagesPerDevice
	// embedded images.
	ManifestImageLimit ManifestStatus = "IMAGE_LIMIT"
	// ManifestDocumentLimit means the document-wide image budget is used up.
	ManifestDocumentLimit ManifestStatus = "DOCUMENT_LIMIT"
	// ManifestUnreadable means the blob was missing, could not be decrypted, or
	// was not a decodable image.
	ManifestUnreadable ManifestStatus = "UNREADABLE"
)
