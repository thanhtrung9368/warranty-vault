package services

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Migration 0016: Device activation / extended cover (Feature A) and the
// subscription trial (Feature B).
//
// Two things are proven here that the cron tests cannot prove:
//
//  1. The validation rules, in both languages, including the two deliberately
//     ABSENT rules: `activatedAt` before `purchaseDate` is accepted, and no
//     brand-specific day count is asserted anywhere.
//  2. The default state. A user who never sends any of the new fields must keep
//     the old behaviour: `activationRequired = false`, both dates NULL, and a
//     subscription with no trial. That is the "byte-identical behaviour" promise
//     at the data layer (the cron test proves the notification side).
//
// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres.

func ptrToString(s string) *string { return &s }
func ptrToInt32(n int32) *int32    { return &n }

// ─── Device validation ───────────────────────────────────────────────────────

func TestValidateDeviceInputActivationFields(t *testing.T) {
	t.Run("absent fields keep the old state", func(t *testing.T) {
		in := validDeviceInput()
		if err := ValidateDeviceInput(viCtx(), &in); err != nil {
			t.Fatalf("ValidateDeviceInput(no activation fields) = %v, want nil", err)
		}
		if in.ActivationRequired {
			t.Error("ActivationRequired defaulted to true")
		}
		if in.ActivatedAt != nil || in.ExtendedCoverBuyBy != nil {
			t.Errorf("dates defaulted to %v / %v, want nil", in.ActivatedAt, in.ExtendedCoverBuyBy)
		}
	})

	t.Run("valid dates are accepted", func(t *testing.T) {
		in := validDeviceInput()
		in.ActivationRequired = true
		in.ActivatedAt = ptrToString("2026-01-15T10:30:00Z")
		in.ExtendedCoverBuyBy = ptrToString("2026-03-01")
		if err := ValidateDeviceInput(viCtx(), &in); err != nil {
			t.Fatalf("ValidateDeviceInput(valid dates) = %v, want nil", err)
		}
	})

	t.Run("activatedAt before purchaseDate is legitimate and allowed", func(t *testing.T) {
		in := validDeviceInput()
		in.PurchaseDate = "2026-01-15"
		in.ActivatedAt = ptrToString("2025-12-20") // shop pre-activated before the invoice
		if err := ValidateDeviceInput(viCtx(), &in); err != nil {
			t.Fatalf("ValidateDeviceInput(pre-activation) = %v, want nil — the contract explicitly allows it", err)
		}
		// And the parse helper must accept it too: no cross-field comparison is
		// performed anywhere on the write path.
		if _, err := parseActivatedAt(viCtx(), in.ActivatedAt); err != nil {
			t.Fatalf("parseActivatedAt(pre-activation) = %v, want nil", err)
		}
	})

	t.Run("activationRequired with no activatedAt is allowed", func(t *testing.T) {
		in := validDeviceInput()
		in.ActivationRequired = true
		if err := ValidateDeviceInput(viCtx(), &in); err != nil {
			t.Fatalf("ValidateDeviceInput(required, not activated) = %v, want nil", err)
		}
	})

	t.Run("invalid activatedAt is a field error in both languages", func(t *testing.T) {
		in := validDeviceInput()
		in.ActivatedAt = ptrToString("not-a-date")
		err := ValidateDeviceInput(viCtx(), &in)
		svc, ok := As(err)
		if !ok || svc.HTTPStatus() != 400 {
			t.Fatalf("ValidateDeviceInput(bad activatedAt) = %v, want a 400 domain error", err)
		}
		if got := svc.FieldErrors["activatedAt"]; !reflect.DeepEqual(got, []string{"Ngày kích hoạt không hợp lệ"}) {
			t.Errorf("fieldErrors.activatedAt = %v", got)
		}

		in = validDeviceInput()
		in.ActivatedAt = ptrToString("not-a-date")
		err = ValidateDeviceInput(enCtx(), &in)
		svc, ok = As(err)
		if !ok {
			t.Fatalf("ValidateDeviceInput(bad activatedAt, en) = %v, want a domain error", err)
		}
		if got := svc.FieldErrors["activatedAt"]; !reflect.DeepEqual(got, []string{"Invalid activation date"}) {
			t.Errorf("fieldErrors.activatedAt (en) = %v", got)
		}
	})

	t.Run("invalid extendedCoverBuyBy is a field error in both languages", func(t *testing.T) {
		in := validDeviceInput()
		in.ExtendedCoverBuyBy = ptrToString("2026-02-30") // not a real calendar day
		err := ValidateDeviceInput(viCtx(), &in)
		svc, ok := As(err)
		if !ok || svc.HTTPStatus() != 400 {
			t.Fatalf("ValidateDeviceInput(bad extendedCoverBuyBy) = %v, want a 400 domain error", err)
		}
		if got := svc.FieldErrors["extendedCoverBuyBy"]; !reflect.DeepEqual(got, []string{"Hạn mua bảo hiểm mở rộng không hợp lệ"}) {
			t.Errorf("fieldErrors.extendedCoverBuyBy = %v", got)
		}

		in = validDeviceInput()
		in.ExtendedCoverBuyBy = ptrToString("2026-02-30")
		err = ValidateDeviceInput(enCtx(), &in)
		svc, ok = As(err)
		if !ok {
			t.Fatalf("ValidateDeviceInput(bad extendedCoverBuyBy, en) = %v, want a domain error", err)
		}
		if got := svc.FieldErrors["extendedCoverBuyBy"]; !reflect.DeepEqual(got, []string{"Invalid extended-cover purchase deadline"}) {
			t.Errorf("fieldErrors.extendedCoverBuyBy (en) = %v", got)
		}
	})
}

// ─── Subscription validation ─────────────────────────────────────────────────

func TestValidateSubscriptionInputTrialRules(t *testing.T) {
	trial := time.Date(2026, time.November, 12, 0, 0, 0, 0, time.UTC)

	t.Run("convertsToPrice without trialEndsAt is rejected", func(t *testing.T) {
		in := validSubscriptionInput()
		in.ConvertsToPrice = ptrToInt32(260000)
		err := validateSubscriptionInput(viCtx(), &in)
		svc, ok := As(err)
		if !ok || svc.HTTPStatus() != 400 {
			t.Fatalf("validateSubscriptionInput(price only) = %v, want a 400 domain error", err)
		}
		got := svc.FieldErrors["convertsToPrice"]
		if !reflect.DeepEqual(got, []string{"Chỉ đặt giá sau dùng thử khi đã có ngày kết thúc dùng thử"}) {
			t.Errorf("fieldErrors.convertsToPrice = %v", got)
		}

		in = validSubscriptionInput()
		in.ConvertsToPrice = ptrToInt32(260000)
		err = validateSubscriptionInput(enCtx(), &in)
		svc, ok = As(err)
		if !ok {
			t.Fatalf("validateSubscriptionInput(price only, en) = %v, want a domain error", err)
		}
		if got := svc.FieldErrors["convertsToPrice"]; !reflect.DeepEqual(got, []string{"A post-trial price needs a trial end date"}) {
			t.Errorf("fieldErrors.convertsToPrice (en) = %v", got)
		}
	})

	t.Run("trialEndsAt without convertsToPrice is allowed", func(t *testing.T) {
		in := validSubscriptionInput()
		in.TrialEndsAt = &trial
		if err := validateSubscriptionInput(viCtx(), &in); err != nil {
			t.Fatalf("validateSubscriptionInput(date only) = %v, want nil", err)
		}
	})

	t.Run("both fields together are valid", func(t *testing.T) {
		in := validSubscriptionInput()
		in.TrialEndsAt = &trial
		in.ConvertsToPrice = ptrToInt32(260000)
		if err := validateSubscriptionInput(viCtx(), &in); err != nil {
			t.Fatalf("validateSubscriptionInput(date + price) = %v, want nil", err)
		}
	})

	t.Run("negative convertsToPrice is rejected", func(t *testing.T) {
		in := validSubscriptionInput()
		in.TrialEndsAt = &trial
		in.ConvertsToPrice = ptrToInt32(-1)
		err := validateSubscriptionInput(viCtx(), &in)
		svc, ok := As(err)
		if !ok || len(svc.FieldErrors["convertsToPrice"]) == 0 {
			t.Fatalf("validateSubscriptionInput(negative price) = %v, want fieldErrors.convertsToPrice", err)
		}
		if got := svc.FieldErrors["convertsToPrice"][0]; got != "Giá sau dùng thử không hợp lệ" {
			t.Errorf("fieldErrors.convertsToPrice = %q", got)
		}
	})

	t.Run("zero convertsToPrice is meaningful", func(t *testing.T) {
		in := validSubscriptionInput()
		in.TrialEndsAt = &trial
		in.ConvertsToPrice = ptrToInt32(0) // converts to a free plan
		if err := validateSubscriptionInput(viCtx(), &in); err != nil {
			t.Fatalf("validateSubscriptionInput(zero price) = %v, want nil", err)
		}
	})
}

// ─── Real database: create/read/update + the untouched defaults ─────────────

func TestActivationAndTrialRoundTripAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const userID = "zz_test_activation_trial_user"
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	// ── A user who never sets the new fields keeps the old state. ──────────
	legacy := validDeviceInput()
	legacyDevice, err := CreateDevice(ctx, pool, userID, legacy, "")
	if err != nil {
		t.Fatalf("CreateDevice(legacy payload): %v", err)
	}
	if legacyDevice.ActivationRequired {
		t.Error("legacy device ActivationRequired = true, want false")
	}
	if legacyDevice.ActivatedAt.Valid || legacyDevice.ExtendedCoverBuyBy.Valid {
		t.Errorf("legacy device dates = %v / %v, want NULL",
			legacyDevice.ActivatedAt, legacyDevice.ExtendedCoverBuyBy)
	}
	if legacyDevice.ActivationNotifiedAt.Valid || legacyDevice.ExtendedCoverNotifiedAt.Valid {
		t.Error("legacy device has a cron stamp, want NULL")
	}

	legacySub, err := CreateSubscription(ctx, pool, userID, validSubscriptionInput())
	if err != nil {
		t.Fatalf("CreateSubscription(legacy payload): %v", err)
	}
	if legacySub.TrialEndsAt.Valid || legacySub.ConvertsToPrice != nil {
		t.Errorf("legacy subscription trial = %v / %v, want NULL/NULL",
			legacySub.TrialEndsAt, legacySub.ConvertsToPrice)
	}

	// ── Device: create with all three fields, read it back, update it. ─────
	in := validDeviceInput()
	in.Name = "Máy kích hoạt"
	in.ActivationRequired = true
	in.ActivatedAt = ptrToString("2025-12-20") // BEFORE purchaseDate 2026-01-15: allowed
	in.ExtendedCoverBuyBy = ptrToString("2026-03-01")
	created, err := CreateDevice(ctx, pool, userID, in, "")
	if err != nil {
		t.Fatalf("CreateDevice(activation fields): %v", err)
	}
	if !created.ActivationRequired {
		t.Error("created ActivationRequired = false, want true")
	}
	if !created.ActivatedAt.Valid || created.ActivatedAt.Time.Format("2006-01-02") != "2025-12-20" {
		t.Errorf("created ActivatedAt = %v, want 2025-12-20", created.ActivatedAt)
	}
	if created.ActivatedAt.Time.After(created.PurchaseDate.Time) {
		t.Errorf("pre-activation was stored as %v, after purchase %v — the accepted state changed",
			created.ActivatedAt.Time, created.PurchaseDate.Time)
	}
	if !created.ExtendedCoverBuyBy.Valid || created.ExtendedCoverBuyBy.Time.Format("2006-01-02") != "2026-03-01" {
		t.Errorf("created ExtendedCoverBuyBy = %v, want 2026-03-01", created.ExtendedCoverBuyBy)
	}

	detail, err := GetDevice(ctx, pool, userID, created.ID)
	if err != nil {
		t.Fatalf("GetDevice: %v", err)
	}
	if !detail.ActivationRequired || detail.ActivatedAt != created.ActivatedAt ||
		detail.ExtendedCoverBuyBy != created.ExtendedCoverBuyBy {
		t.Errorf("GetDevice lost the activation fields: %+v", detail.Device)
	}

	list, err := ListDevices(ctx, pool, userID, DeviceFilter{})
	if err != nil {
		t.Fatalf("ListDevices: %v", err)
	}
	found := false
	for _, d := range list {
		if d.ID == created.ID {
			found = true
			if !d.ActivationRequired || d.ActivatedAt != created.ActivatedAt ||
				d.ExtendedCoverBuyBy != created.ExtendedCoverBuyBy {
				t.Errorf("DeviceListItem lost the activation fields: %+v", d.Device)
			}
		}
	}
	if !found {
		t.Error("device missing from ListDevices")
	}

	// Update: PATCH replaces all three, matching the existing replace semantics.
	upd := validDeviceInput()
	upd.Name = "Máy đã kích hoạt"
	upd.ActivationRequired = true
	upd.ActivatedAt = ptrToString("2026-01-20T09:00:00Z")
	upd.ExtendedCoverBuyBy = ptrToString("2026-04-01")
	updated, err := UpdateDevice(ctx, pool, userID, created.ID, upd)
	if err != nil {
		t.Fatalf("UpdateDevice: %v", err)
	}
	if !updated.ActivatedAt.Valid || updated.ActivatedAt.Time.Format("2006-01-02") != "2026-01-20" {
		t.Errorf("updated ActivatedAt = %v", updated.ActivatedAt)
	}
	if !updated.ExtendedCoverBuyBy.Valid || updated.ExtendedCoverBuyBy.Time.Format("2006-01-02") != "2026-04-01" {
		t.Errorf("updated ExtendedCoverBuyBy = %v", updated.ExtendedCoverBuyBy)
	}

	// Clearing works exactly like the other optional dates: omit = NULL.
	clear := validDeviceInput()
	clear.Name = "Máy xoá ngày"
	cleared, err := UpdateDevice(ctx, pool, userID, created.ID, clear)
	if err != nil {
		t.Fatalf("UpdateDevice(clear): %v", err)
	}
	if cleared.ActivationRequired || cleared.ActivatedAt.Valid || cleared.ExtendedCoverBuyBy.Valid {
		t.Errorf("clear left activation state behind: %+v", cleared)
	}

	// ── Subscription: create with trial, read it back, update and clear. ───
	trialEnd := time.Date(2026, time.November, 12, 0, 0, 0, 0, time.UTC)
	subIn := validSubscriptionInput()
	subIn.Name = "Trial plan"
	subIn.TrialEndsAt = &trialEnd
	subIn.ConvertsToPrice = ptrToInt32(260000)
	sub, err := CreateSubscription(ctx, pool, userID, subIn)
	if err != nil {
		t.Fatalf("CreateSubscription(trial): %v", err)
	}
	if !sub.TrialEndsAt.Valid || sub.TrialEndsAt.Time.Format("2006-01-02") != "2026-11-12" {
		t.Errorf("created TrialEndsAt = %v", sub.TrialEndsAt)
	}
	if sub.ConvertsToPrice == nil || *sub.ConvertsToPrice != 260000 {
		t.Errorf("created ConvertsToPrice = %v", sub.ConvertsToPrice)
	}

	detailSub, err := GetSubscription(ctx, pool, userID, sub.ID)
	if err != nil {
		t.Fatalf("GetSubscription: %v", err)
	}
	if detailSub.Subscription.ConvertsToPrice == nil || *detailSub.Subscription.ConvertsToPrice != 260000 {
		t.Errorf("GetSubscription lost ConvertsToPrice: %v", detailSub.Subscription.ConvertsToPrice)
	}

	subs, err := ListSubscriptions(ctx, pool, userID, nil)
	if err != nil {
		t.Fatalf("ListSubscriptions: %v", err)
	}
	foundSub := false
	for _, s := range subs {
		if s.ID == sub.ID {
			foundSub = true
			if !s.TrialEndsAt.Valid || s.ConvertsToPrice == nil {
				t.Errorf("ListSubscriptions lost the trial: %+v", s)
			}
		}
	}
	if !foundSub {
		t.Error("trial subscription missing from ListSubscriptions")
	}

	// PATCH without the trial fields clears both (replace semantics).
	subClear := validSubscriptionInput()
	subClear.Name = "Trial plan cleared"
	clearedSub, err := UpdateSubscription(ctx, pool, userID, sub.ID, subClear)
	if err != nil {
		t.Fatalf("UpdateSubscription(clear): %v", err)
	}
	if clearedSub.TrialEndsAt.Valid || clearedSub.ConvertsToPrice != nil {
		t.Errorf("clear left trial state behind: %v / %v",
			clearedSub.TrialEndsAt, clearedSub.ConvertsToPrice)
	}

	// A price without a date is rejected at the service boundary too.
	badSub := validSubscriptionInput()
	badSub.ConvertsToPrice = ptrToInt32(1000)
	if _, err := CreateSubscription(ctx, pool, userID, badSub); err == nil {
		t.Fatal("CreateSubscription(price without date) = nil, want a validation error")
	} else if svc, ok := As(err); !ok || len(svc.FieldErrors["convertsToPrice"]) == 0 {
		t.Fatalf("CreateSubscription(price without date) = %v, want fieldErrors.convertsToPrice", err)
	}
}

// The migration's SQL defaults: insert with the minimum column set and read the
// new columns back. Kept separate from the round-trip above so a dropped DEFAULT
// is reported as "the migration changed", not as a service bug.
func TestActivationDefaultsInDatabase(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const userID = "zz_test_activation_defaults_user"
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	const deviceID = "zz_test_activation_defaults_device"
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "createdAt", "updatedAt")
		VALUES ($1, $2, 'Default', 'PHONE', NOW(), 0, 'ACTIVE', NOW(), NOW())`, deviceID, userID); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "Device" WHERE id = $1`, deviceID)
	})

	var activationRequired bool
	var activatedAt, extendedCover, activationNotified, extendedCoverNotified *time.Time
	var extendedCoverLeadDay *int32
	if err := pool.QueryRow(ctx, `
		SELECT "activationRequired", "activatedAt", "extendedCoverBuyBy",
		       "activationNotifiedAt", "extendedCoverNotifiedAt", "extendedCoverNotifiedLeadDay"
		FROM "Device" WHERE id = $1`, deviceID).Scan(
		&activationRequired, &activatedAt, &extendedCover,
		&activationNotified, &extendedCoverNotified, &extendedCoverLeadDay); err != nil {
		t.Fatalf("read defaults: %v", err)
	}
	if activationRequired {
		t.Error("activationRequired default = true, want false")
	}
	if activatedAt != nil || extendedCover != nil || activationNotified != nil ||
		extendedCoverNotified != nil || extendedCoverLeadDay != nil {
		t.Errorf("new Device columns defaulted to non-NULL: %v %v %v %v %v",
			activatedAt, extendedCover, activationNotified, extendedCoverNotified, extendedCoverLeadDay)
	}

	const subID = "zz_test_activation_defaults_sub"
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, "startedAt", "renewalDate", "createdAt", "updatedAt")
		VALUES ($1, $2, 'Default', 'MONTHLY', 0, NOW(), NOW(), NOW(), NOW())`, subID, userID); err != nil {
		t.Fatalf("insert subscription: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "Subscription" WHERE id = $1`, subID)
	})

	var trialEndsAt, trialNotifiedAt *time.Time
	var convertsToPrice *int32
	var trialLeadDay *int32
	if err := pool.QueryRow(ctx, `
		SELECT "trialEndsAt", "convertsToPrice", "trialNotifiedAt", "trialNotifiedLeadDay"
		FROM "Subscription" WHERE id = $1`, subID).Scan(
		&trialEndsAt, &convertsToPrice, &trialNotifiedAt, &trialLeadDay); err != nil {
		t.Fatalf("read subscription defaults: %v", err)
	}
	if trialEndsAt != nil || convertsToPrice != nil || trialNotifiedAt != nil || trialLeadDay != nil {
		t.Errorf("new Subscription columns defaulted to non-NULL: %v %v %v %v",
			trialEndsAt, convertsToPrice, trialNotifiedAt, trialLeadDay)
	}
}

// The backup payload carries the new fields. Without this, an export→restore
// would silently delete a user-entered activation date / extended-cover deadline
// and the trial they were tracking, and would reset the cron markers so the next
// run re-notifies them. The import half is covered by the existing round-trip
// suite, which now runs with the wider payload shape.
func TestBackupCarriesActivationAndTrialFields(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userID   = "zz_test_activation_backup_user"
		deviceID = "zz_test_activation_backup_dev"
		subID    = "zz_test_activation_backup_sub"
	)
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status,
		                      "activationRequired", "activatedAt", "extendedCoverBuyBy",
		                      "activationNotifiedAt", "extendedCoverNotifiedAt", "extendedCoverNotifiedLeadDay",
		                      "createdAt", "updatedAt")
		VALUES ($1, $2, 'Backup device', 'PHONE', '2026-01-15', 1000000, 'ACTIVE',
		        true, '2025-12-20', '2026-03-01', '2026-01-02', '2026-02-01', 7, NOW(), NOW())`,
		deviceID, userID); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "Device" WHERE id = $1`, deviceID)
	})

	if _, err := pool.Exec(ctx, `
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, "startedAt", "renewalDate",
		                            "trialEndsAt", "convertsToPrice", "trialNotifiedAt", "trialNotifiedLeadDay",
		                            "createdAt", "updatedAt")
		VALUES ($1, $2, 'Backup trial', 'MONTHLY', 0, NOW(), NOW() + INTERVAL '1 year',
		        '2026-11-12', 260000, '2026-11-09', 3, NOW(), NOW())`,
		subID, userID); err != nil {
		t.Fatalf("insert subscription: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "Subscription" WHERE id = $1`, subID)
	})

	out, err := ExportBackup(ctx, pool, userID)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}

	var gotDevice *BackupDevice
	for i := range out.Devices {
		if out.Devices[i].ID == deviceID {
			gotDevice = &out.Devices[i]
		}
	}
	if gotDevice == nil {
		t.Fatal("device missing from backup export")
	}
	if !gotDevice.ActivationRequired {
		t.Error("backup activationRequired = false, want true")
	}
	if gotDevice.ActivatedAt == nil || !strings.HasPrefix(*gotDevice.ActivatedAt, "2025-12-20") {
		t.Errorf("backup activatedAt = %v", gotDevice.ActivatedAt)
	}
	if gotDevice.ExtendedCoverBuyBy == nil || !strings.HasPrefix(*gotDevice.ExtendedCoverBuyBy, "2026-03-01") {
		t.Errorf("backup extendedCoverBuyBy = %v", gotDevice.ExtendedCoverBuyBy)
	}
	if gotDevice.ActivationNotifiedAt == nil || !strings.HasPrefix(*gotDevice.ActivationNotifiedAt, "2026-01-02") {
		t.Errorf("backup activationNotifiedAt = %v", gotDevice.ActivationNotifiedAt)
	}
	if gotDevice.ExtendedCoverNotifiedAt == nil || !strings.HasPrefix(*gotDevice.ExtendedCoverNotifiedAt, "2026-02-01") {
		t.Errorf("backup extendedCoverNotifiedAt = %v", gotDevice.ExtendedCoverNotifiedAt)
	}
	if gotDevice.ExtendedCoverNotifiedLeadDay == nil || *gotDevice.ExtendedCoverNotifiedLeadDay != 7 {
		t.Errorf("backup extendedCoverNotifiedLeadDay = %v", gotDevice.ExtendedCoverNotifiedLeadDay)
	}

	var gotSub *BackupSubscription
	for i := range out.Subscriptions {
		if out.Subscriptions[i].ID == subID {
			gotSub = &out.Subscriptions[i]
		}
	}
	if gotSub == nil {
		t.Fatal("subscription missing from backup export")
	}
	if gotSub.TrialEndsAt == nil || !strings.HasPrefix(*gotSub.TrialEndsAt, "2026-11-12") {
		t.Errorf("backup trialEndsAt = %v", gotSub.TrialEndsAt)
	}
	if gotSub.ConvertsToPrice == nil || *gotSub.ConvertsToPrice != 260000 {
		t.Errorf("backup convertsToPrice = %v", gotSub.ConvertsToPrice)
	}
	if gotSub.TrialNotifiedAt == nil || !strings.HasPrefix(*gotSub.TrialNotifiedAt, "2026-11-09") {
		t.Errorf("backup trialNotifiedAt = %v", gotSub.TrialNotifiedAt)
	}
	if gotSub.TrialNotifiedLeadDay == nil || *gotSub.TrialNotifiedLeadDay != 3 {
		t.Errorf("backup trialNotifiedLeadDay = %v", gotSub.TrialNotifiedLeadDay)
	}
}
