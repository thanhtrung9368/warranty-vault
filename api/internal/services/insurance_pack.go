package services

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"log/slog"
	"strings"
	"time"

	"github.com/disintegration/imaging"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/pdfpack"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"

	_ "image/gif"  // register GIF with image.Decode
	_ "image/jpeg" // register JPEG with image.Decode
	_ "image/png"  // register PNG with image.Decode

	_ "golang.org/x/image/webp" // register WEBP with image.Decode
)

// Insurance pack limits re-exported for the handler/OpenAPI tests. The single
// source of truth is pdfpack, where the layout that consumes them lives.
const (
	MaxInsuranceImagesPerDevice   = pdfpack.MaxImagesPerDevice
	MaxInsuranceImageDimension    = pdfpack.MaxImageDimension
	MaxInsuranceImagesPerDocument = pdfpack.MaxImagesPerDocument
)

// MaxInsuranceDeviceIDs bounds the `?deviceIds=` list. The per-account device
// ceiling is 500, so a longer list cannot select anything a shorter one could
// not; stopping there keeps a hostile URL from turning into a large map without
// changing which of the caller's devices can appear.
const MaxInsuranceDeviceIDs = MaxDevicesTotalPerUser

// InsurancePackOptions controls which devices are included. The document is
// always Vietnamese; there is deliberately no Language field.
type InsurancePackOptions struct {
	DeviceIDs []string
	// IncludeSold includes devices with status SOLD (default false). Their
	// soldAt/soldPrice are printed in the detail section.
	IncludeSold bool
	// GeneratedAt is for deterministic tests. Zero means time.Now().
	GeneratedAt time.Time
}

// InsurancePackResult reports what the generated document contains.
type InsurancePackResult struct {
	PDF             []byte
	DeviceCount     int
	AttachmentCount int
	EmbeddedImages  int
}

// ParseInsuranceDeviceIDs turns the comma-separated query value into a stable,
// deduplicated list. Empty segments and segments longer than a device id could
// be are ignored; ownership is enforced later by the user-scoped device query,
// so an id belonging to somebody else is simply absent from the result (never a
// 404 that would confirm it exists).
func ParseInsuranceDeviceIDs(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	seen := make(map[string]struct{})
	out := make([]string, 0, 8)
	for _, part := range strings.Split(raw, ",") {
		id := strings.TrimSpace(part)
		if id == "" || len(id) > 128 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
		if len(out) >= MaxInsuranceDeviceIDs {
			break
		}
	}
	return out
}

// BuildInsurancePack resolves the user's data, decrypts and bounds the
// embeddable attachments, and renders the PDF.
//
// Ownership: every query is scoped by userID. `DeviceIDs` is applied to the
// already-scoped list, so passing another user's id cannot select their device —
// it matches nothing and the document is empty (or contains only the caller's
// requested devices).
func BuildInsurancePack(ctx context.Context, db *pgxpool.Pool, userID string, opts InsurancePackOptions) (*InsurancePackResult, error) {
	q := store.New(db)

	user, err := q.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy người dùng"))
		}
		return nil, fmt.Errorf("get insurance pack user: %w", err)
	}

	devices, err := q.ListDevicesByUserSimple(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list insurance pack devices: %w", err)
	}
	selected := selectInsuranceDevices(devices, opts)

	// Empty account (or a filter that matches nothing): skip the three batch
	// reads and return the one-page document. This is not an error.
	if len(selected) == 0 {
		return buildInsuranceDocument(user, nil, nil, nil, nil, opts)
	}

	allWarranties, err := q.ListWarrantiesByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list insurance pack warranties: %w", err)
	}
	allAttachments, err := q.ListAttachmentsByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list insurance pack attachments: %w", err)
	}
	allClaims, err := q.ListClaimsByUser(ctx, store.ListClaimsByUserParams{UserId: userID})
	if err != nil {
		return nil, fmt.Errorf("list insurance pack claims: %w", err)
	}

	warrantiesByDevice := groupWarranties(allWarranties)
	attachmentsByDevice := groupAttachments(allAttachments)
	claimsByDevice := groupClaims(allClaims)

	return buildInsuranceDocument(user, selected, warrantiesByDevice, attachmentsByDevice, claimsByDevice, opts)
}

func selectInsuranceDevices(devices []store.Device, opts InsurancePackOptions) []store.Device {
	var wanted map[string]struct{}
	if len(opts.DeviceIDs) > 0 {
		wanted = make(map[string]struct{}, len(opts.DeviceIDs))
		for _, id := range opts.DeviceIDs {
			wanted[id] = struct{}{}
		}
	}
	out := make([]store.Device, 0, len(devices))
	for _, d := range devices {
		if !opts.IncludeSold && d.Status == "SOLD" {
			continue
		}
		if wanted != nil {
			if _, ok := wanted[d.ID]; !ok {
				continue
			}
		}
		out = append(out, d)
	}
	return out
}

func groupWarranties(rows []store.Warranty) map[string][]store.Warranty {
	out := make(map[string][]store.Warranty, len(rows))
	for _, w := range rows {
		out[w.DeviceId] = append(out[w.DeviceId], w)
	}
	return out
}

func groupAttachments(rows []store.Attachment) map[string][]store.Attachment {
	out := make(map[string][]store.Attachment, len(rows))
	for _, a := range rows {
		if a.DeviceId == nil {
			continue
		}
		out[*a.DeviceId] = append(out[*a.DeviceId], a)
	}
	return out
}

func groupClaims(rows []store.Claim) map[string][]store.Claim {
	out := make(map[string][]store.Claim, len(rows))
	for _, c := range rows {
		out[c.DeviceId] = append(out[c.DeviceId], c)
	}
	return out
}

func buildInsuranceDocument(
	user store.User,
	devices []store.Device,
	warrantiesByDevice map[string][]store.Warranty,
	attachmentsByDevice map[string][]store.Attachment,
	claimsByDevice map[string][]store.Claim,
	opts InsurancePackOptions,
) (*InsurancePackResult, error) {
	generatedAt := opts.GeneratedAt
	if generatedAt.IsZero() {
		generatedAt = time.Now()
	}

	var (
		master    files.MasterKey
		masterErr error
		masterSet bool
	)
	totalImages := 0
	result := &InsurancePackResult{DeviceCount: len(devices)}

	doc := pdfpack.Document{
		GeneratedAt: generatedAt,
		Account: pdfpack.Account{
			DisplayName: insuranceDisplayName(user),
			Email:       user.Email,
		},
		IncludeSold: opts.IncludeSold,
		Devices:     make([]pdfpack.Device, 0, len(devices)),
	}

	for _, d := range devices {
		warranties := warrantiesByDevice[d.ID]
		claims := claimsByDevice[d.ID]
		attachments := attachmentsByDevice[d.ID]

		pd := pdfpack.Device{
			Name:                 sanitizeForPDF(d.Name),
			Brand:                ptrString(d.Brand),
			Model:                ptrString(d.Model),
			SerialNumber:         ptrString(d.SerialNumber),
			PurchaseDate:         timePtr(d.PurchaseDate),
			PurchasePrice:        d.PurchasePrice,
			Currency:             d.Currency,
			PurchasePriceVND:     vndValue(d.PurchasePrice, d.Currency, d.FxRate),
			EffectiveWarrantyEnd: insuranceWarrantyEnd(warranties),
			Status:               d.Status,
			SoldAt:               timePtr(d.SoldAt),
			SoldPrice:            d.SoldPrice,
			Warranties:           make([]pdfpack.Warranty, 0, len(warranties)),
			Claims:               make([]pdfpack.Claim, 0, len(claims)),
			Attachments:          make([]pdfpack.Attachment, 0, len(attachments)),
		}
		if d.SoldPrice != nil {
			pd.SoldPriceVND = vndValue(*d.SoldPrice, d.Currency, d.FxRate)
		}
		for _, w := range warranties {
			pd.Warranties = append(pd.Warranties, toPDFWarranty(w))
		}
		for _, c := range claims {
			pd.Claims = append(pd.Claims, toPDFClaim(c))
		}

		deviceImages := 0
		for _, a := range attachments {
			entry := pdfpack.Attachment{
				FileName:    a.FileName,
				FileType:    a.FileType,
				Description: ptrString(a.Description),
				Status:      pdfpack.ManifestNotEmbeddable,
			}
			result.AttachmentCount++

			if !embeddableInsuranceImage(a.FileType) {
				pd.Attachments = append(pd.Attachments, entry)
				continue
			}
			if deviceImages >= pdfpack.MaxImagesPerDevice {
				entry.Status = pdfpack.ManifestImageLimit
				pd.Attachments = append(pd.Attachments, entry)
				continue
			}
			if totalImages >= pdfpack.MaxImagesPerDocument {
				entry.Status = pdfpack.ManifestDocumentLimit
				pd.Attachments = append(pd.Attachments, entry)
				continue
			}

			if !masterSet {
				master, masterErr = files.LoadMasterKey()
				masterSet = true
			}
			img, err := decodeInsuranceImage(a, master, masterErr)
			if err != nil {
				slog.Warn("insurance pack image skipped",
					"err", err, "attachmentId", a.ID, "userId", user.ID, "fileType", a.FileType)
				entry.Status = pdfpack.ManifestUnreadable
				pd.Attachments = append(pd.Attachments, entry)
				continue
			}
			entry.Status = pdfpack.ManifestEmbedded
			pd.Attachments = append(pd.Attachments, entry)
			pd.Images = append(pd.Images, img)
			deviceImages++
			totalImages++
		}

		doc.Devices = append(doc.Devices, pd)
	}

	raw, err := pdfpack.Build(doc)
	if err != nil {
		return nil, fmt.Errorf("build insurance pack pdf: %w", err)
	}
	result.PDF = raw
	result.EmbeddedImages = totalImages
	return result, nil
}

func insuranceDisplayName(u store.User) string {
	if u.Name != nil {
		if name := strings.TrimSpace(*u.Name); name != "" {
			return name
		}
	}
	return "Người dùng chưa đặt tên"
}

func sanitizeForPDF(s string) string {
	return strings.TrimSpace(strings.ToValidUTF8(s, ""))
}

func ptrString(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}

func timePtr(t pgtype.Timestamp) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func insuranceWarrantyEnd(warranties []store.Warranty) *time.Time {
	var max time.Time
	found := false
	for _, w := range warranties {
		if !w.EndDate.Valid {
			continue
		}
		if !found || w.EndDate.Time.After(max) {
			max = w.EndDate.Time
			found = true
		}
	}
	if !found {
		return nil
	}
	return &max
}

func toPDFWarranty(w store.Warranty) pdfpack.Warranty {
	return pdfpack.Warranty{
		Type:          w.Type,
		Provider:      ptrString(w.Provider),
		StartDate:     timePtr(w.StartDate),
		EndDate:       timePtr(w.EndDate),
		Months:        w.Months,
		Cost:          w.Cost,
		Address:       ptrString(w.Address),
		Phone:         ptrString(w.Phone),
		Notes:         ptrString(w.Notes),
		Component:     ptrString(w.Component),
		Scope:         ptrString(w.Scope),
		Cap:           w.Cap,
		Deductible:    w.Deductible,
		Exclusions:    ptrString(w.Exclusions),
		Region:        ptrString(w.Region),
		Transferable:  w.Transferable,
		ClaimsAllowed: w.ClaimsAllowed,
		ClaimsUsed:    w.ClaimsUsed,
	}
}

func toPDFClaim(c store.Claim) pdfpack.Claim {
	return pdfpack.Claim{
		Status:            c.Status,
		OpenedAt:          timePtr(c.OpenedAt),
		ClosedAt:          timePtr(c.ClosedAt),
		TicketNumber:      ptrString(c.TicketNumber),
		ServiceCenter:     ptrString(c.ServiceCenter),
		Issue:             c.Issue,
		Diagnosis:         ptrString(c.Diagnosis),
		Outcome:           ptrString(c.Outcome),
		Cost:              c.Cost,
		CoveredByWarranty: c.CoveredByWarranty,
	}
}

// embeddableInsuranceImage lists the raster types fpdf/gopdf can embed after we
// have decoded them. GIF and WEBP are included because both are accepted by the
// upload pipeline and both can be decoded to a still image; HEIC is not (no pure
// Go decoder, and the upload path deliberately does not resize it either), and
// PDF is not an image at all. Those two are listed in the manifest with a note.
func embeddableInsuranceImage(mime string) bool {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		return true
	default:
		return false
	}
}

// decodeInsuranceImage reads, decrypts, bounds and re-encodes one attachment
// using the same files primitives as the download path. It deliberately does not
// call OpenStream: the batch query ListAttachmentsByUser has already proven that
// every row belongs to this user, and re-checking per image would add an N+1
// query to the most expensive read in the service.
func decodeInsuranceImage(a store.Attachment, master files.MasterKey, masterErr error) (pdfpack.Image, error) {
	if masterErr != nil {
		return pdfpack.Image{}, fmt.Errorf("load master key: %w", masterErr)
	}
	ciphertext, err := files.ReadEncrypted(files.PrivateUploadRoot(), a.StoragePath)
	if err != nil {
		return pdfpack.Image{}, fmt.Errorf("read blob: %w", err)
	}
	plain, err := files.Decrypt(ciphertext, a.Iv, a.WrappedKey, master)
	if err != nil {
		return pdfpack.Image{}, fmt.Errorf("decrypt blob: %w", err)
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(plain))
	if err != nil {
		return pdfpack.Image{}, fmt.Errorf("decode image config: %w", err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return pdfpack.Image{}, errors.New("image has no pixels")
	}
	// Decompression-bomb guard. The check happens BEFORE the full decode, so a
	// 5 MB PNG describing a gigapixel canvas cannot allocate gigabytes.
	if int64(cfg.Width)*int64(cfg.Height) > int64(pdfpack.MaxImagePixels) {
		return pdfpack.Image{}, fmt.Errorf("image too large: %dx%d", cfg.Width, cfg.Height)
	}

	img, _, err := image.Decode(bytes.NewReader(plain))
	if err != nil {
		return pdfpack.Image{}, fmt.Errorf("decode image: %w", err)
	}
	b := img.Bounds()
	if b.Dx() > pdfpack.MaxImageDimension || b.Dy() > pdfpack.MaxImageDimension {
		img = imaging.Fit(img, pdfpack.MaxImageDimension, pdfpack.MaxImageDimension, imaging.Lanczos)
	}
	flat := flattenOnWhite(img)
	encoded, err := encodeJPEG(flat, 82)
	if err != nil {
		return pdfpack.Image{}, err
	}
	if len(encoded) > 1_500_000 {
		encoded, err = encodeJPEG(flat, 65)
		if err != nil {
			return pdfpack.Image{}, err
		}
	}
	return pdfpack.Image{
		FileName:    a.FileName,
		Description: ptrString(a.Description),
		Data:        encoded,
		Width:       flat.Bounds().Dx(),
		Height:      flat.Bounds().Dy(),
	}, nil
}

func flattenOnWhite(img image.Image) *image.RGBA {
	b := img.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Over)
	return dst
}

func encodeJPEG(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, fmt.Errorf("encode jpeg: %w", err)
	}
	return buf.Bytes(), nil
}
