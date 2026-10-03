package services

import (
	"context"
	"log/slog"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Serial / IMEI post-checks (FEATURE_IDEAS #6).
//
// Why this exists: Vietnamese electronic warranty is keyed to the IMEI or the
// manufacturer serial, so a single wrong digit makes the service centre refuse
// the claim — at the exact moment the user needs the app. The OCR path used to
// check only the *length* of the value and the manual form checked nothing but
// length too, so a 14-digit IMEI or a typo'd check digit went straight into the
// database.
//
// Everything here is ADVISORY. A serial number is not always an IMEI (laptops,
// appliances and accessories all carry manufacturer serials that look nothing
// like one), and refusing a legitimate serial is worse than the typo it would
// prevent. So the findings ride on the same "review this" channel the AI draft
// already had — a list of warnings next to the draft/response — and never turn
// into a 400.
//
// Warning codes. Stable strings; clients bind to them and fall back to Message.
const (
	// WarningIMEIChecksum: 15 digits whose Luhn check digit is wrong — almost
	// always a typo or an OCR misread.
	WarningIMEIChecksum = "IMEI_CHECKSUM"
	// WarningIMEILength: an all-digit value in the IMEI family's length range
	// (14–17) that is not 15 digits long. The 15-digit IMEI is what a VN service
	// centre reads off the box.
	WarningIMEILength = "IMEI_LENGTH"
	// WarningSerialDuplicate: the same serial already exists on ANOTHER device of
	// this user. Advisory: the column has no unique index and shared serials do
	// happen (a family re-entering the same machine, a returned unit).
	WarningSerialDuplicate = "SERIAL_DUPLICATE"
)

// SerialField is the request/draft field these warnings point at, so a client can
// highlight the right input.
const SerialField = "serialNumber"

// Warning is one advisory finding. `Code` is machine-readable, `Field` names the
// input it belongs to, `Message` is the Vietnamese copy to show as-is.
//
// It is the structured sibling of DraftDevice.Unmatched: `unmatched` means "we
// got something but could not bind/drop it", a Warning means "we kept it, but it
// looks wrong". Both are non-blocking review channels; neither is a rejection.
type Warning struct {
	Code    string `json:"code"`
	Field   string `json:"field"`
	Message string `json:"message"`
}

// IMEI geometry. A 15-digit IMEI is the identifier printed on VN warranty cards;
// 16 digits is an IMEISV and 14 the pre-2004 IMEI without check digit, so both
// are worth flagging when they are all-digits — but 13 digits or fewer is simply
// a short manufacturer serial and must stay silent.
const (
	imeiDigits    = 15
	imeiFamilyMin = 14
	imeiFamilyMax = 17
)

// IsValidIMEI reports whether serial is a syntactically valid IMEI: exactly 15
// ASCII digits with a correct Luhn check digit.
//
// Note that a *valid* result proves nothing about the device: the check only
// rejects typos, it cannot confirm the identifier exists. Callers must therefore
// treat a failure as a warning too (see SerialWarnings).
func IsValidIMEI(serial string) bool {
	v := strings.TrimSpace(serial)
	return len(v) == imeiDigits && isASCIIDigits(v) && luhnValid(v)
}

// IsLikelyIMEI reports whether the value is shaped like an IMEI attempt at all:
// all digits, within the 14–17 digit IMEI family range. Used to decide whether a
// checksum/length remark is appropriate (see SerialWarnings).
func IsLikelyIMEI(serial string) bool {
	v := strings.TrimSpace(serial)
	return isASCIIDigits(v) && len(v) >= imeiFamilyMin && len(v) <= imeiFamilyMax
}

// SerialWarnings returns every advisory finding for one serial value.
//
//	duplicateCount — how many OTHER devices of this user already carry the value
//	                 (0 when unknown; the DB-backed wrapper fills this in).
//
// The returned slice is never nil, so the JSON contract is `[]` and not `null`.
//
// Shape rule (deliberately narrow): the IMEI checks only look at values that are
// ALL ASCII digits *and* 14–17 characters long. Anything else — "C02X1234JGH5",
// "SN-A1B2C3", "356938 035643 809", "IMEI356938035643809", a 6-digit serial — is
// treated as an ordinary manufacturer serial and gets no IMEI remark at all. A
// false "your IMEI is wrong" on a perfectly good serial is the failure mode this
// rule exists to avoid.
func SerialWarnings(serial string, duplicateCount int64) []Warning {
	warnings := []Warning{}
	v := strings.TrimSpace(serial)
	if v == "" {
		return warnings
	}

	if IsLikelyIMEI(v) {
		switch {
		case len(v) == imeiDigits && !luhnValid(v):
			warnings = append(warnings, Warning{
				Code:  WarningIMEIChecksum,
				Field: SerialField,
				Message: "15 số này không đúng checksum IMEI (Luhn) — có thể sai một chữ số. " +
					"Vẫn lưu được, nhưng nên đối chiếu lại với tem máy hoặc hoá đơn trước khi đi bảo hành.",
			})
		case len(v) != imeiDigits:
			warnings = append(warnings, Warning{
				Code:  WarningIMEILength,
				Field: SerialField,
				Message: "IMEI chuẩn có đúng 15 chữ số, chuỗi này có " +
					strconv.Itoa(len(v)) + ". Nếu đây là số serial của hãng thì bỏ qua cảnh báo này.",
			})
		}
	}

	if duplicateCount > 0 {
		warnings = append(warnings, Warning{
			Code:  WarningSerialDuplicate,
			Field: SerialField,
			Message: "Số serial/IMEI này đã có ở " + strconv.FormatInt(duplicateCount, 10) +
				" thiết bị khác trong tài khoản của bạn. Kiểm tra để tránh trùng hồ sơ bảo hành.",
		})
	}

	return warnings
}

// DeviceSerialWarnings is the DB-backed wrapper used by the write paths: it
// combines the pure checks above with the one lookup that needs the database —
// whether another device of this user already carries the serial.
//
// excludeDeviceID is the device being edited; pass the row's own id (create and
// update both know it) or "" when there is no device yet (the AI draft path). A
// device therefore never counts as its own duplicate.
//
// A failing lookup is logged and degrades to "no duplicate advisory" rather than
// failing the caller's write: this whole check is advice, and a database hiccup
// must not cost the user a save.
func DeviceSerialWarnings(ctx context.Context, db *pgxpool.Pool, userID string, serial *string, excludeDeviceID string) []Warning {
	if serial == nil {
		return []Warning{}
	}
	v := strings.TrimSpace(*serial)
	if v == "" {
		return []Warning{}
	}

	count, err := store.New(db).CountOtherDevicesBySerial(ctx, store.CountOtherDevicesBySerialParams{
		UserId:    userID,
		Serial:    v,
		ExcludeId: excludeDeviceID,
	})
	if err != nil {
		slog.Warn("duplicate-serial check failed; continuing without it",
			"err", err, "userId", userID)
		return SerialWarnings(v, 0)
	}
	return SerialWarnings(v, count)
}

// luhnValid implements the Luhn checksum IMEIs use: walking from the rightmost
// digit, every second digit is doubled (with 9 subtracted when the result
// exceeds 9) and the total must be divisible by 10.
//
// Callers must have already established that digits is all ASCII digits.
func luhnValid(digits string) bool {
	sum := 0
	double := false
	for i := len(digits) - 1; i >= 0; i-- {
		d := int(digits[i] - '0')
		if double {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		double = !double
	}
	return sum%10 == 0
}

// isASCIIDigits reports whether s is non-empty and made only of '0'-'9'. Unicode
// digits (e.g. Arabic-Indic) are deliberately rejected: an IMEI on a VN warranty
// card is ASCII.
func isASCIIDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}
