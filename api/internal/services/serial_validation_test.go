package services

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// IMEI / serial post-checks (FEATURE_IDEAS #6).
//
// The pure half runs everywhere; the duplicate-serial lookup needs a database and
// is skipped without WV_TEST_DATABASE_URL.

func warningCodes(ws []Warning) []string {
	out := make([]string, 0, len(ws))
	for _, w := range ws {
		out = append(out, w.Code)
	}
	return out
}

func codesEqual(got []string, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

func TestIsValidIMEI(t *testing.T) {
	for _, tc := range []struct {
		name   string
		serial string
		want   bool
	}{
		// Two well-known valid IMEIs (correct Luhn check digit).
		{name: "IMEI hợp lệ 1", serial: "356938035643809", want: true},
		{name: "IMEI hợp lệ 2", serial: "490154203237518", want: true},
		{name: "hợp lệ, có khoảng trắng hai đầu", serial: "  356938035643809 ", want: true},
		// Same identifiers with the last digit changed: the typo this feature exists for.
		{name: "sai check digit", serial: "356938035643808"},
		{name: "sai check digit 2", serial: "490154203237510"},
		{name: "14 số (thiếu 1 số)", serial: "35693803564380"},
		{name: "16 số", serial: "3569380356438091"},
		{name: "quá ngắn", serial: "12345"},
		{name: "rỗng", serial: ""},
		{name: "chỉ khoảng trắng", serial: "   "},
		{name: "serial có chữ", serial: "C02X1234JGH5"},
		{name: "serial có gạch nối", serial: "SN-356938035643809"},
		{name: "có tiền tố IMEI", serial: "IMEI356938035643809"},
		{name: "có dấu cách bên trong", serial: "356938 035643 809"},
		{name: "chữ số Ả Rập - Ấn (không phải ASCII)", serial: "٣٥٦٩٣٨٠٣٥٦٤٣٨٠٩"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsValidIMEI(tc.serial); got != tc.want {
				t.Errorf("IsValidIMEI(%q) = %v, want %v", tc.serial, got, tc.want)
			}
		})
	}
}

func TestIsLikelyIMEI(t *testing.T) {
	for _, tc := range []struct {
		serial string
		want   bool
	}{
		{"356938035643809", true},   // 15
		{"35693803564380", true},    // 14
		{"3569380356438091", true},  // 16
		{"12345678901234567", true}, // 17
		{"1234567890123", false},    // 13 — a short manufacturer serial, not an IMEI
		{"123456789012345678", false},
		{"C02X1234JGH5", false},
		{"", false},
	} {
		if got := IsLikelyIMEI(tc.serial); got != tc.want {
			t.Errorf("IsLikelyIMEI(%q) = %v, want %v", tc.serial, got, tc.want)
		}
	}
}

// The single source of truth for "what does the user see": advisories, never a
// rejection, and never a remark on a plain manufacturer serial.
func TestSerialWarnings(t *testing.T) {
	for _, tc := range []struct {
		name       string
		serial     string
		duplicates int64
		wantCodes  []string
	}{
		{name: "IMEI hợp lệ — im lặng", serial: "356938035643809", wantCodes: []string{}},
		{name: "IMEI hợp lệ có khoảng trắng — im lặng", serial: "  490154203237518 ", wantCodes: []string{}},
		{name: "sai check digit → IMEI_CHECKSUM", serial: "356938035643808", wantCodes: []string{WarningIMEIChecksum}},
		{name: "sai check digit lần 2 → IMEI_CHECKSUM", serial: "490154203237510", wantCodes: []string{WarningIMEIChecksum}},
		{name: "14 số → IMEI_LENGTH", serial: "35693803564380", wantCodes: []string{WarningIMEILength}},
		{name: "16 số → IMEI_LENGTH", serial: "3569380356438091", wantCodes: []string{WarningIMEILength}},
		{name: "17 số → IMEI_LENGTH", serial: "12345678901234567", wantCodes: []string{WarningIMEILength}},
		{name: "quá ngắn — im lặng", serial: "12345678", wantCodes: []string{}},
		{name: "serial chữ của hãng — im lặng", serial: "C02X1234JGH5", wantCodes: []string{}},
		{name: "serial có gạch — im lặng", serial: "SN-A1B2C3D4", wantCodes: []string{}},
		{name: "có tiền tố — im lặng (không đoán bừa)", serial: "IMEI356938035643809", wantCodes: []string{}},
		{name: "có dấu cách bên trong — im lặng", serial: "356938 035643 809", wantCodes: []string{}},
		{name: "rỗng — im lặng", serial: "", wantCodes: []string{}},
		{name: "trùng 1 thiết bị", serial: "356938035643809", duplicates: 1, wantCodes: []string{WarningSerialDuplicate}},
		{name: "trùng 2 thiết bị", serial: "C02X1234JGH5", duplicates: 2, wantCodes: []string{WarningSerialDuplicate}},
		{
			name: "vừa sai checksum vừa trùng", serial: "356938035643808", duplicates: 1,
			wantCodes: []string{WarningIMEIChecksum, WarningSerialDuplicate},
		},
		{
			name: "14 số và trùng", serial: "35693803564380", duplicates: 3,
			wantCodes: []string{WarningIMEILength, WarningSerialDuplicate},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ws := SerialWarnings(viCtx(), tc.serial, tc.duplicates)
			if ws == nil {
				t.Fatal("SerialWarnings returned nil; the JSON contract is [] not null")
			}
			if got := warningCodes(ws); !codesEqual(got, tc.wantCodes) {
				t.Fatalf("SerialWarnings(%q, %d) codes = %v, want %v", tc.serial, tc.duplicates, got, tc.wantCodes)
			}
			for _, w := range ws {
				if w.Field != SerialField {
					t.Errorf("warning %s field = %q, want %q", w.Code, w.Field, SerialField)
				}
				if strings.TrimSpace(w.Message) == "" {
					t.Errorf("warning %s has an empty Vietnamese message", w.Code)
				}
			}
		})
	}
}

// The length warning must state the actual length — it is the only part of the
// message the server can be precise about.
func TestSerialWarningsLengthMessageNamesTheLength(t *testing.T) {
	ws := SerialWarnings(viCtx(), "35693803564380", 0) // 14 digits
	if len(ws) != 1 || ws[0].Code != WarningIMEILength {
		t.Fatalf("warnings = %v, want one IMEI_LENGTH", warningCodes(ws))
	}
	if !strings.Contains(ws[0].Message, "14") || !strings.Contains(ws[0].Message, "15 chữ số") {
		t.Errorf("message = %q, want it to mention 14 and the expected 15 digits", ws[0].Message)
	}
}

// ---- real-database assertions ----------------------------------------------

func TestDeviceSerialWarningsDuplicateLookup(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userA = "zz_test_serial_a"
		userB = "zz_test_serial_b"
		devA1 = "zz_test_serial_dev_a1"
		devA2 = "zz_test_serial_dev_a2"
		devA3 = "zz_test_serial_dev_a3"
		devB1 = "zz_test_serial_dev_b1"
	)
	for _, u := range []string{userA, userB} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
			 ON CONFLICT (id) DO NOTHING`, u, u+"@example.invalid"); err != nil {
			t.Fatalf("insert user %s: %v", u, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`, []string{userA, userB})
	})

	insertDevice := func(id, user, serial string) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO "Device" (id, "userId", name, category, "serialNumber", "purchaseDate", "purchasePrice", "updatedAt")
			 VALUES ($1, $2, 'Máy test', 'PHONE', $3, '2025-01-01', 1000000, NOW())`, id, user, serial); err != nil {
			t.Fatalf("insert device %s: %v", id, err)
		}
	}
	insertDevice(devA1, userA, "356938035643809")
	insertDevice(devA2, userA, "C02X1234JGH5")
	insertDevice(devB1, userB, "356938035643809") // same value, other user

	// No index, no constraint: the second device exists, and the *advisory* is
	// what tells the user about it. Note the two halves of the exclusion contract:
	// with no exclude id the row itself counts, and excluding the row being edited
	// drops it — which is exactly what the create/update handlers pass.
	count, err := store.New(pool).CountOtherDevicesBySerial(ctx, store.CountOtherDevicesBySerialParams{
		UserId: userA, Serial: "356938035643809",
	})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Errorf("count without an exclude id = %d, want 1 (devA1 itself; user B's row must not count)", count)
	}
	countExcl, err := store.New(pool).CountOtherDevicesBySerial(ctx, store.CountOtherDevicesBySerialParams{
		UserId: userA, Serial: "356938035643809", ExcludeId: devA1,
	})
	if err != nil {
		t.Fatalf("count with exclude: %v", err)
	}
	if countExcl != 0 {
		t.Errorf("count excluding devA1 = %d, want 0", countExcl)
	}

	nilSerial := (*string)(nil)
	if ws := DeviceSerialWarnings(ctx, pool, userA, nilSerial, ""); len(ws) != 0 {
		t.Errorf("nil serial warnings = %v, want none", warningCodes(ws))
	}
	blank := "   "
	if ws := DeviceSerialWarnings(ctx, pool, userA, &blank, ""); len(ws) != 0 {
		t.Errorf("blank serial warnings = %v, want none", warningCodes(ws))
	}

	valid := "356938035643809"
	if ws := DeviceSerialWarnings(ctx, pool, userA, &valid, devA1); len(ws) != 0 {
		t.Errorf("warnings for a device's own serial = %v, want none (self-exclusion)", warningCodes(ws))
	}

	// A second device of the SAME user now carries the same IMEI — the real
	// duplicate this check is for.
	insertDevice(devA3, userA, "356938035643809")

	// viCtx(), not the bare ctx: the assertion below reads the Vietnamese copy,
	// and the product default is now English (docs/I18N_PLAN.md §4.3). Pinning the
	// language keeps the assertion exactly as it was.
	ws := DeviceSerialWarnings(viCtx(), pool, userA, &valid, devA1)
	if got := warningCodes(ws); !codesEqual(got, []string{WarningSerialDuplicate}) {
		t.Fatalf("warnings = %v, want SERIAL_DUPLICATE", got)
	}
	if !strings.Contains(ws[0].Message, "1 thiết bị khác") {
		t.Errorf("message = %q, want it to name the number of other devices", ws[0].Message)
	}

	// Case-insensitive: the same sticker read as lower case is the same serial.
	lower := "c02x1234jgh5"
	if got := warningCodes(DeviceSerialWarnings(ctx, pool, userA, &lower, devA1)); !codesEqual(got, []string{WarningSerialDuplicate}) {
		t.Errorf("case-insensitive lookup failed: %v", got)
	}
	// …and devA2's own value does not duplicate itself.
	if ws := DeviceSerialWarnings(ctx, pool, userA, &lower, devA2); len(ws) != 0 {
		t.Errorf("warnings for devA2's own serial = %v, want none", warningCodes(ws))
	}
	// User B sees no duplicate: A's devices are not B's devices.
	if got := warningCodes(DeviceSerialWarnings(ctx, pool, userB, &valid, devB1)); len(got) != 0 {
		t.Errorf("user B warnings = %v, want none (A's device is not B's duplicate)", got)
	}
}

// The OCR path is the one the feature was written for: a hallucinated or misread
// IMEI reaches the draft pre-filled AND flagged — never dropped, never a 400.
func TestExtractReceiptWarnsOnSuspiciousSerial(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const userID = "zz_test_ocr_warn_user"
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt", "aiOptIn") VALUES ($1, $2, 'x', NOW(), true)
		 ON CONFLICT (id) DO UPDATE SET "aiOptIn" = true`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert test user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	// An existing device already carries the serial the receipt will produce.
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "serialNumber", "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ('zz_test_ocr_warn_dev', $1, 'Máy cũ', 'PHONE', '356938035643809', '2024-01-01', 5000000, NOW())`,
		userID); err != nil {
		t.Fatalf("insert device: %v", err)
	}

	draft, err := ExtractReceipt(ctx, pool, &fakeExtractor{result: ai.ExtractedReceipt{
		Name:         strp("iPhone 15 Pro"),
		SerialNumber: strp("356938035643809"),
	}}, userID, ExtractInput{Body: []byte{0xFF, 0xD8, 0xFF, 0xE0}, MediaType: "image/jpeg"})
	if err != nil {
		t.Fatalf("ExtractReceipt: %v", err)
	}
	if draft.SerialNumber == nil || *draft.SerialNumber != "356938035643809" {
		t.Errorf("draft.serialNumber = %v, want the value kept", draft.SerialNumber)
	}
	if got := warningCodes(draft.Warnings); !codesEqual(got, []string{WarningSerialDuplicate}) {
		t.Errorf("draft warnings = %v, want SERIAL_DUPLICATE", got)
	}

	// A Luhn-failing 15-digit value is kept and flagged, never dropped: the client
	// must be able to show it next to the warning.
	bad, err := ExtractReceipt(ctx, pool, &fakeExtractor{result: ai.ExtractedReceipt{
		SerialNumber: strp("356938035643808"),
	}}, userID, ExtractInput{Body: []byte{0xFF, 0xD8, 0xFF, 0xE0}, MediaType: "image/jpeg"})
	if err != nil {
		t.Fatalf("ExtractReceipt (bad checksum): %v", err)
	}
	if bad.SerialNumber == nil || *bad.SerialNumber != "356938035643808" {
		t.Errorf("draft.serialNumber = %v, want the suspicious value kept", bad.SerialNumber)
	}
	if got := warningCodes(bad.Warnings); !codesEqual(got, []string{WarningIMEIChecksum}) {
		t.Errorf("draft warnings = %v, want IMEI_CHECKSUM", got)
	}
	if contains(bad.Unmatched, SerialField) {
		t.Errorf("unmatched = %v: a kept value must NOT be reported as unmatched", bad.Unmatched)
	}

	// A clean IMEI draft carries an empty (non-nil) warning list.
	clean, err := ExtractReceipt(ctx, pool, &fakeExtractor{result: ai.ExtractedReceipt{
		SerialNumber: strp("490154203237518"),
	}}, userID, ExtractInput{Body: []byte{0xFF, 0xD8, 0xFF, 0xE0}, MediaType: "image/jpeg"})
	if err != nil {
		t.Fatalf("ExtractReceipt (clean): %v", err)
	}
	if clean.Warnings == nil {
		t.Error("clean draft warnings = nil, want [] (JSON contract)")
	}
	if len(clean.Warnings) != 0 {
		t.Errorf("clean draft warnings = %v, want none", warningCodes(clean.Warnings))
	}
}
