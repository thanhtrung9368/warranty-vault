package services

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Warranty contract terms (migration 0017) — unit rules first, then the real
// Postgres round trip (backup included). The nine fields exist so a plan can say
// WHAT it covers and what a claim costs; every rule below is a 400 with a
// fieldErrors key, so each case asserts BOTH the field and the sentence language
// (this suite pins Vietnamese via viCtx, matching the other validation tests).

func warrantyTermI32(v int32) *int32 { return &v }
func warrantyTermBool(v bool) *bool  { return &v }

// baseWarrantyInput is a valid pre-0017 warranty body: none of the nine contract
// terms is set. It is the "user never touches these fields" fixture, used both
// by the no-change test and as the base every mutation starts from.
func baseWarrantyInput() WarrantyInput {
	return WarrantyInput{
		Type:      "STANDARD",
		StartDate: "2026-01-15",
		Months:    24,
	}
}

// allWarrantyTerms fills every contract term with a plausible value.
func allWarrantyTerms(in *WarrantyInput) {
	component := "Động cơ"
	scope := "Động cơ và hộp số, bao gồm rò rỉ dầu"
	exclusions := "Hao mòn tự nhiên, tai nạn, ngập nước"
	region := "Việt Nam"
	in.Component = &component
	in.Scope = &scope
	in.Cap = warrantyTermI32(20_000_000)
	in.Deductible = warrantyTermI32(500_000)
	in.Exclusions = &exclusions
	in.Region = &region
	in.Transferable = warrantyTermBool(true)
	in.ClaimsAllowed = warrantyTermI32(3)
	in.ClaimsUsed = warrantyTermI32(1)
}

func assertWarrantyFieldError(t *testing.T, err error, field string) {
	t.Helper()
	if err == nil {
		t.Fatalf("ValidateWarrantyInput = nil, want fieldErrors[%s]", field)
	}
	svc, ok := As(err)
	if !ok {
		t.Fatalf("error is %T, want *services.Error", err)
	}
	if len(svc.FieldErrors[field]) == 0 {
		t.Fatalf("fieldErrors = %v, want a message for %q", svc.FieldErrors, field)
	}
	if svc.Code != "VALIDATION" {
		t.Errorf("code = %q, want VALIDATION", svc.Code)
	}
	if msg := svc.FieldErrors[field][0]; msg == "" {
		t.Errorf("fieldErrors[%s] is empty", field)
	}
}

func assertWarrantyValid(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("ValidateWarrantyInput = %v, want nil", err)
	}
}

// A user who never sets any of the nine fields must see no change: the body that
// was valid before migration 0017 is still valid, and the zero values mean "no
// contract terms recorded" / "zero claims used".
func TestValidateWarrantyInputWithoutContractTermsIsUnchanged(t *testing.T) {
	in := baseWarrantyInput()
	assertWarrantyValid(t, ValidateWarrantyInput(viCtx(), &in))

	if in.Component != nil || in.Scope != nil || in.Cap != nil || in.Deductible != nil ||
		in.Exclusions != nil || in.Region != nil || in.Transferable != nil ||
		in.ClaimsAllowed != nil || in.ClaimsUsed != nil {
		t.Errorf("validation invented contract terms: %+v", in)
	}
	// The old fields still behave exactly as before.
	bad := baseWarrantyInput()
	bad.Cost = warrantyTermI32(-1)
	assertWarrantyFieldError(t, ValidateWarrantyInput(viCtx(), &bad), "cost")
}

func TestValidateWarrantyContractTerms(t *testing.T) {
	long := func(n int) string { return strings.Repeat("ộ", n) } // 3 bytes/char in UTF-8

	for _, tc := range []struct {
		name   string
		mutate func(*WarrantyInput)
		bad    string // "" = valid
	}{
		{name: "no terms", mutate: func(*WarrantyInput) {}},
		{name: "all terms", mutate: allWarrantyTerms},
		{name: "cap negative", mutate: func(in *WarrantyInput) {
			in.Cap = warrantyTermI32(-1)
		}, bad: "cap"},
		{name: "deductible negative", mutate: func(in *WarrantyInput) {
			in.Deductible = warrantyTermI32(-1)
		}, bad: "deductible"},
		{name: "claimsUsed negative", mutate: func(in *WarrantyInput) {
			in.ClaimsUsed = warrantyTermI32(-1)
		}, bad: "claimsUsed"},
		{name: "claimsAllowed negative", mutate: func(in *WarrantyInput) {
			in.ClaimsAllowed = warrantyTermI32(-1)
		}, bad: "claimsAllowed"},
		{name: "claimsUsed over allowance", mutate: func(in *WarrantyInput) {
			in.ClaimsAllowed = warrantyTermI32(2)
			in.ClaimsUsed = warrantyTermI32(3)
		}, bad: "claimsUsed"},
		{name: "claimsUsed equal to allowance", mutate: func(in *WarrantyInput) {
			in.ClaimsAllowed = warrantyTermI32(2)
			in.ClaimsUsed = warrantyTermI32(2)
		}},
		{name: "zero allowance and zero used", mutate: func(in *WarrantyInput) {
			in.ClaimsAllowed = warrantyTermI32(0)
			in.ClaimsUsed = warrantyTermI32(0)
		}},
		{name: "no allowance means any used", mutate: func(in *WarrantyInput) {
			in.ClaimsUsed = warrantyTermI32(99)
		}},
		{name: "zero deductible is valid", mutate: func(in *WarrantyInput) {
			in.Deductible = warrantyTermI32(0)
		}},
		{name: "zero cap is valid", mutate: func(in *WarrantyInput) {
			in.Cap = warrantyTermI32(0)
		}},
		{name: "component at the 200-rune bound", mutate: func(in *WarrantyInput) {
			v := long(MaxWarrantyComponentRunes)
			in.Component = &v
		}},
		{name: "component over the bound", mutate: func(in *WarrantyInput) {
			v := long(MaxWarrantyComponentRunes + 1)
			in.Component = &v
		}, bad: "component"},
		{name: "region over the bound", mutate: func(in *WarrantyInput) {
			v := long(MaxWarrantyRegionRunes + 1)
			in.Region = &v
		}, bad: "region"},
		{name: "scope at the 500-rune bound", mutate: func(in *WarrantyInput) {
			v := long(MaxWarrantyScopeRunes)
			in.Scope = &v
		}},
		{name: "scope over the bound", mutate: func(in *WarrantyInput) {
			v := long(MaxWarrantyScopeRunes + 1)
			in.Scope = &v
		}, bad: "scope"},
		{name: "exclusions over the bound", mutate: func(in *WarrantyInput) {
			v := long(MaxWarrantyExclusionsRunes + 1)
			in.Exclusions = &v
		}, bad: "exclusions"},
		{name: "blank strings clear rather than fail", mutate: func(in *WarrantyInput) {
			v := "   "
			in.Component, in.Scope, in.Exclusions, in.Region = &v, &v, &v, &v
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := baseWarrantyInput()
			tc.mutate(&in)
			err := ValidateWarrantyInput(viCtx(), &in)
			if tc.bad == "" {
				assertWarrantyValid(t, err)
				return
			}
			assertWarrantyFieldError(t, err, tc.bad)
		})
	}

	// A negative allowance is explained ONCE, on claimsAllowed. The pair rule
	// must not also flag claimsUsed: comparing 0 against an invalid -1 would put
	// two field errors on a body whose single problem is the allowance.
	negativeAllowance := baseWarrantyInput()
	negativeAllowance.ClaimsAllowed = warrantyTermI32(-1)
	err := ValidateWarrantyInput(viCtx(), &negativeAllowance)
	assertWarrantyFieldError(t, err, "claimsAllowed")
	svc, _ := As(err)
	if _, ok := svc.FieldErrors["claimsUsed"]; ok {
		t.Errorf("negative claimsAllowed also flagged claimsUsed: %v", svc.FieldErrors)
	}
}

// The update-only half of the claims pair: when claimsUsed is omitted the stored
// counter is what the pair rule must use. "Stored 2, new allowance 1" is a 400 on
// claimsUsed, not a silently impossible contract.
func TestValidateWarrantyInputUsesStoredClaimsUsed(t *testing.T) {
	in := baseWarrantyInput()
	in.ClaimsAllowed = warrantyTermI32(1) // claimsUsed omitted

	assertWarrantyValid(t, validateWarrantyInput(viCtx(), &in, 1))
	assertWarrantyFieldError(t, validateWarrantyInput(viCtx(), &in, 2), "claimsUsed")
}

// NO cross-field inference from Type. Every type accepts every term. If a future
// edit "cleans up" by rejecting, say, a cap on THIRD_PARTY, this test fails.
func TestWarrantyTermsDoNotDependOnType(t *testing.T) {
	for _, typ := range []string{"STANDARD", "EXTENDED", "THIRD_PARTY"} {
		t.Run(typ, func(t *testing.T) {
			in := baseWarrantyInput()
			in.Type = typ
			allWarrantyTerms(&in)
			assertWarrantyValid(t, ValidateWarrantyInput(viCtx(), &in))
		})
	}

	// The two concrete contracts named in the feature brief: a THIRD_PARTY plan
	// with a cap, and a STANDARD one with exclusions.
	thirdParty := baseWarrantyInput()
	thirdParty.Type = "THIRD_PARTY"
	thirdParty.Cap = warrantyTermI32(15_000_000)
	thirdParty.Deductible = warrantyTermI32(1_000_000)
	assertWarrantyValid(t, ValidateWarrantyInput(viCtx(), &thirdParty))

	standard := baseWarrantyInput()
	standard.Type = "STANDARD"
	excl := "Không bảo hành màn hình nứt vỡ"
	standard.Exclusions = &excl
	assertWarrantyValid(t, ValidateWarrantyInput(viCtx(), &standard))
}

// The catalog has to carry BOTH languages for every new sentence; the shared
// catalog test enforces that mechanically, but this pins the English wording
// clients will actually render for the two most important refusals.
func TestWarrantyTermMessagesAreBilingual(t *testing.T) {
	en := enCtx()

	in := baseWarrantyInput()
	in.ClaimsAllowed = warrantyTermI32(1)
	in.ClaimsUsed = warrantyTermI32(2)
	err := ValidateWarrantyInput(en, &in)
	if err == nil {
		t.Fatal("want a claimsUsed error")
	}
	svc, _ := As(err)
	if got := svc.FieldErrors["claimsUsed"][0]; got != "Claims used cannot exceed claims allowed" {
		t.Errorf("English claimsUsed message = %q", got)
	}

	in2 := baseWarrantyInput()
	in2.Cap = warrantyTermI32(-1)
	err = ValidateWarrantyInput(en, &in2)
	if err == nil {
		t.Fatal("want a cap error")
	}
	svc, _ = As(err)
	if got := svc.FieldErrors["cap"][0]; got != "Value must not be negative" {
		t.Errorf("English cap message = %q", got)
	}
}

// ---- real database ---------------------------------------------------------

// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres.
//
// Proves, against the actual migration:
//  1. all nine fields are written and read back;
//  2. an update that omits claimsUsed keeps the stored counter, an explicit 0
//     resets it, and reducing claimsAllowed below the counter is a 400;
//  3. a warranty written before migration 0017 (no terms) still round-trips
//     through export + import; and
//  4. a pre-0017 JSON payload with none of the new keys still imports.
func TestWarrantyContractTermsAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := viCtx()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userA   = "zz_test_terms_a"
		userB   = "zz_test_terms_b"
		deviceA = "zz_test_terms_device_a"
		warA    = "zz_test_terms_war_a"
	)
	for _, u := range []string{userA, userB} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
			 ON CONFLICT (id) DO NOTHING`, u, u+"@example.invalid"); err != nil {
			t.Fatalf("insert test user %s: %v", u, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`, []string{userA, userB})
	})
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Máy test điều khoản', 'PHONE', '2026-01-15', 1000000, NOW())`, deviceA, userA); err != nil {
		t.Fatalf("insert device: %v", err)
	}

	component := "Động cơ"
	scope := "Động cơ và hộp số"
	exclusions := "Hao mòn tự nhiên"
	region := "Việt Nam"
	in := WarrantyInput{
		Type:          "THIRD_PARTY",
		StartDate:     "2026-01-15",
		Months:        24,
		Component:     &component,
		Scope:         &scope,
		Cap:           warrantyTermI32(20_000_000),
		Deductible:    warrantyTermI32(500_000),
		Exclusions:    &exclusions,
		Region:        &region,
		Transferable:  warrantyTermBool(true),
		ClaimsAllowed: warrantyTermI32(3),
		ClaimsUsed:    warrantyTermI32(1),
	}
	// The id is generated by CreateWarranty; read it back through the list.
	created, err := CreateWarranty(ctx, pool, userA, deviceA, in)
	if err != nil {
		t.Fatalf("CreateWarranty: %v", err)
	}
	rowID := created.ID
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "Warranty" WHERE id = $1`, rowID)
	})

	assertTerms := func(t *testing.T, got storeWarrantyView) {
		t.Helper()
		if got.Component == nil || *got.Component != component {
			t.Errorf("component = %v, want %q", got.Component, component)
		}
		if got.Scope == nil || *got.Scope != scope {
			t.Errorf("scope = %v", got.Scope)
		}
		if got.Cap == nil || *got.Cap != 20_000_000 {
			t.Errorf("cap = %v", got.Cap)
		}
		if got.Deductible == nil || *got.Deductible != 500_000 {
			t.Errorf("deductible = %v", got.Deductible)
		}
		if got.Exclusions == nil || *got.Exclusions != exclusions {
			t.Errorf("exclusions = %v", got.Exclusions)
		}
		if got.Region == nil || *got.Region != region {
			t.Errorf("region = %v", got.Region)
		}
		if got.Transferable == nil || !*got.Transferable {
			t.Errorf("transferable = %v", got.Transferable)
		}
		if got.ClaimsAllowed == nil || *got.ClaimsAllowed != 3 {
			t.Errorf("claimsAllowed = %v", got.ClaimsAllowed)
		}
		if got.ClaimsUsed != 1 {
			t.Errorf("claimsUsed = %d, want 1", got.ClaimsUsed)
		}
	}

	if created.Component == nil || *created.Component != component ||
		created.ClaimsUsed != 1 || created.Transferable == nil || !*created.Transferable {
		t.Fatalf("created warranty does not carry the terms: %+v", created)
	}

	read := func(id string) storeWarrantyView {
		t.Helper()
		var v storeWarrantyView
		if err := pool.QueryRow(ctx,
			`SELECT component, scope, cap, deductible, exclusions, region, transferable,
			        "claimsAllowed", "claimsUsed"
			 FROM "Warranty" WHERE id = $1`, id).Scan(
			&v.Component, &v.Scope, &v.Cap, &v.Deductible, &v.Exclusions, &v.Region,
			&v.Transferable, &v.ClaimsAllowed, &v.ClaimsUsed); err != nil {
			t.Fatalf("read warranty terms: %v", err)
		}
		return v
	}
	assertTerms(t, read(rowID))

	// 1b. The "never touches these fields" user. A pre-0017 body must still be
	// valid and must persist as the old state: all terms NULL, claimsUsed 0. Its
	// update (also with no terms) must succeed and leave those columns alone.
	plain, err := CreateWarranty(ctx, pool, userA, deviceA, baseWarrantyInput())
	if err != nil {
		t.Fatalf("CreateWarranty(no terms): %v", err)
	}
	if plain.ClaimsUsed != 0 || plain.Component != nil || plain.Scope != nil ||
		plain.Cap != nil || plain.Deductible != nil || plain.Exclusions != nil ||
		plain.Region != nil || plain.Transferable != nil || plain.ClaimsAllowed != nil {
		t.Errorf("a body with no contract terms did not persist the old state: %+v", plain)
	}
	if _, err := UpdateWarranty(ctx, pool, userA, plain.ID, baseWarrantyInput()); err != nil {
		t.Fatalf("UpdateWarranty(no terms): %v", err)
	}
	if got := read(plain.ID); got.ClaimsUsed != 0 || got.Component != nil || got.Scope != nil ||
		got.Cap != nil || got.Deductible != nil || got.Exclusions != nil || got.Region != nil ||
		got.Transferable != nil || got.ClaimsAllowed != nil {
		t.Errorf("a terms-free update changed a terms-free warranty: %+v", got)
	}

	// 2a. Omitted claimsUsed on update keeps the stored counter. The rest of the
	// body is a full replacement (the client sends the contract it is editing).
	update := in
	update.ClaimsUsed = nil
	update.ClaimsAllowed = warrantyTermI32(2)
	updated, err := UpdateWarranty(ctx, pool, userA, rowID, update)
	if err != nil {
		t.Fatalf("UpdateWarranty(keep claimsUsed): %v", err)
	}
	if updated.ClaimsUsed != 1 {
		t.Errorf("claimsUsed after omitted update = %d, want the stored 1", updated.ClaimsUsed)
	}

	// 2b. Explicit 0 resets it.
	zero := int32(0)
	update.ClaimsUsed = &zero
	updated, err = UpdateWarranty(ctx, pool, userA, rowID, update)
	if err != nil {
		t.Fatalf("UpdateWarranty(reset claimsUsed): %v", err)
	}
	if updated.ClaimsUsed != 0 {
		t.Errorf("claimsUsed after explicit 0 = %d, want 0", updated.ClaimsUsed)
	}

	// 2c. A contract cannot be over-used: stored/requested 2 against an
	// allowance of 1 is a 400 on claimsUsed, and the row is untouched.
	update.ClaimsUsed = warrantyTermI32(2)
	update.ClaimsAllowed = warrantyTermI32(1)
	_, err = UpdateWarranty(ctx, pool, userA, rowID, update)
	assertWarrantyFieldError(t, err, "claimsUsed")
	if got := read(rowID); got.ClaimsUsed != 0 || got.ClaimsAllowed == nil || *got.ClaimsAllowed != 2 {
		t.Errorf("failed update changed the row: used=%d allowed=%v", got.ClaimsUsed, got.ClaimsAllowed)
	}

	// 3. Export → import round trip: the terms must survive, not just the old
	// columns. Restore onto a second account (delete the source first because
	// the device id is a global primary key).
	update.ClaimsUsed = warrantyTermI32(2)
	update.ClaimsAllowed = warrantyTermI32(2)
	if _, err := UpdateWarranty(ctx, pool, userA, rowID, update); err != nil {
		t.Fatalf("UpdateWarranty(final): %v", err)
	}

	// 2d. The reminders feed is a hand-built projection, not `store.Warranty`
	// directly: it must carry the terms too, or a reminder card would claim the
	// plan has no component/cap even though the detail read has them.
	feed, err := ListUpcomingReminders(ctx, pool, userA, 10_000, false)
	if err != nil {
		t.Fatalf("ListUpcomingReminders: %v", err)
	}
	var feedRow *ReminderRow
	for i := range feed {
		if feed[i].ID == rowID {
			feedRow = &feed[i]
		}
	}
	if feedRow == nil {
		t.Fatalf("warranty %s missing from the reminders feed", rowID)
	}
	if feedRow.Component == nil || *feedRow.Component != component ||
		feedRow.Cap == nil || *feedRow.Cap != 20_000_000 ||
		feedRow.ClaimsUsed != 2 || feedRow.ClaimsAllowed == nil || *feedRow.ClaimsAllowed != 2 {
		t.Errorf("reminders feed dropped the contract terms: %+v", feedRow.Warranty)
	}

	payload, err := ExportBackup(ctx, pool, userA)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	var exported *BackupWarranty
	for i := range payload.Devices {
		for j := range payload.Devices[i].Warranties {
			if payload.Devices[i].Warranties[j].ID == rowID {
				exported = &payload.Devices[i].Warranties[j]
			}
		}
	}
	if exported == nil {
		t.Fatalf("warranty %s missing from export", rowID)
	}
	if exported.Component == nil || *exported.Component != component ||
		exported.ClaimsUsed != 2 || exported.ClaimsAllowed == nil || *exported.ClaimsAllowed != 2 {
		t.Errorf("exported terms are wrong: %+v", exported)
	}

	if _, err := pool.Exec(ctx, `DELETE FROM "Device" WHERE id = $1`, deviceA); err != nil {
		t.Fatalf("clear source device: %v", err)
	}
	if _, err := ImportBackup(ctx, pool, userB, payload, ImportMerge); err != nil {
		t.Fatalf("ImportBackup: %v", err)
	}
	var importedDeviceOwner string
	if err := pool.QueryRow(ctx, `SELECT "userId" FROM "Device" WHERE id = $1`, deviceA).Scan(&importedDeviceOwner); err != nil {
		t.Fatalf("read imported device: %v", err)
	}
	if importedDeviceOwner != userB {
		t.Errorf("imported device owner = %q, want %q", importedDeviceOwner, userB)
	}
	if got := read(rowID); got.Component == nil || *got.Component != component ||
		got.ClaimsUsed != 2 || got.ClaimsAllowed == nil || *got.ClaimsAllowed != 2 ||
		got.Transferable == nil || !*got.Transferable {
		t.Errorf("imported terms are wrong: %+v", got)
	}

	// 4. A pre-0017 payload (no contract-term keys at all) still imports. This is
	// the actual JSON an older server wrote; unmarshalling it must leave the new
	// fields nil/0, and the importer must accept it.
	const oldPayloadJSON = `{
	  "version": 5,
	  "exportedAt": "2025-01-01T00:00:00Z",
	  "includesAttachmentBytes": false,
	  "attachmentBytesNote": "KHÔNG chứa nội dung ảnh",
	  "subscriptions": [],
	  "wishlist": [],
	  "devices": [{
	    "id": "zz_test_terms_old_device",
	    "name": "Máy cũ không có điều khoản",
	    "category": "PHONE",
	    "purchaseDate": "2024-05-05T00:00:00Z",
	    "purchasePrice": 1000000,
	    "status": "ACTIVE",
	    "createdAt": "2024-05-05T00:00:00Z",
	    "updatedAt": "2024-05-05T00:00:00Z",
	    "warranties": [{
	      "id": "zz_test_terms_old_war",
	      "type": "STANDARD",
	      "startDate": "2024-05-05T00:00:00Z",
	      "endDate": "2026-05-05T00:00:00Z",
	      "months": 24,
	      "createdAt": "2024-05-05T00:00:00Z",
	      "updatedAt": "2024-05-05T00:00:00Z",
	      "reminders": []
	    }],
	    "attachments": []
	  }]
	}`
	var oldPayload BackupExport
	if err := json.Unmarshal([]byte(oldPayloadJSON), &oldPayload); err != nil {
		t.Fatalf("decode old payload: %v", err)
	}
	if len(oldPayload.Devices) != 1 || len(oldPayload.Devices[0].Warranties) != 1 {
		t.Fatalf("decoded old payload shape = %+v", oldPayload.Devices)
	}
	oldWar := oldPayload.Devices[0].Warranties[0]
	if oldWar.Component != nil || oldWar.Scope != nil || oldWar.Cap != nil ||
		oldWar.Deductible != nil || oldWar.Exclusions != nil || oldWar.Region != nil ||
		oldWar.Transferable != nil || oldWar.ClaimsAllowed != nil || oldWar.ClaimsUsed != 0 {
		t.Fatalf("old payload did not decode to empty terms: %+v", oldWar)
	}
	if _, err := ImportBackup(ctx, pool, userB, &oldPayload, ImportMerge); err != nil {
		t.Fatalf("ImportBackup(old payload): %v", err)
	}
	if got := read("zz_test_terms_old_war"); got.Component != nil || got.Scope != nil ||
		got.Cap != nil || got.Deductible != nil || got.Exclusions != nil || got.Region != nil ||
		got.Transferable != nil || got.ClaimsAllowed != nil || got.ClaimsUsed != 0 {
		t.Errorf("old payload imported unexpected terms: %+v", got)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "Device" WHERE id = $1`, "zz_test_terms_old_device")
	})
}

// storeWarrantyView is the nullable shape the assertions above scan into. It
// mirrors the column nullability added by migration 0017, independently of the
// generated store.Warranty so the test fails if the generated scan is wrong.
type storeWarrantyView struct {
	Component     *string
	Scope         *string
	Cap           *int32
	Deductible    *int32
	Exclusions    *string
	Region        *string
	Transferable  *bool
	ClaimsAllowed *int32
	ClaimsUsed    int32
}
