package services

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// Reminder lead days (migration 0015): every rule in the frozen contract, plus
// the create-default / update-unchanged split that is easy to get wrong by
// reading the migration alone.

func enCtx() context.Context { return i18n.WithTag(context.Background(), i18n.EN) }

// ─── Pure validation ─────────────────────────────────────────────────────────

func TestLeadDaysValidationRules(t *testing.T) {
	cases := []struct {
		name   string
		in     []int32
		wantVI string
		wantEN string
	}{
		{
			name:   "nil is empty and rejected",
			in:     nil,
			wantVI: "Số ngày nhắc phải có từ 1 đến 5 giá trị",
			wantEN: "Lead days must contain between 1 and 5 values",
		},
		{
			name:   "empty array is a 400, not no reminders",
			in:     []int32{},
			wantVI: "Số ngày nhắc phải có từ 1 đến 5 giá trị",
			wantEN: "Lead days must contain between 1 and 5 values",
		},
		{
			name:   "six values is too many",
			in:     []int32{1, 2, 3, 4, 5, 6},
			wantVI: "Số ngày nhắc phải có từ 1 đến 5 giá trị",
			wantEN: "Lead days must contain between 1 and 5 values",
		},
		{
			name:   "below range",
			in:     []int32{-1},
			wantVI: "Mỗi ngày nhắc phải nằm trong khoảng 0 đến 365",
			wantEN: "Each lead day must be between 0 and 365",
		},
		{
			name:   "above range",
			in:     []int32{366},
			wantVI: "Mỗi ngày nhắc phải nằm trong khoảng 0 đến 365",
			wantEN: "Each lead day must be between 0 and 365",
		},
		{
			name:   "duplicate values",
			in:     []int32{7, 7},
			wantVI: "Số ngày nhắc không được trùng nhau",
			wantEN: "Lead days must not contain duplicates",
		},
		{
			// An out-of-range value is reported before the duplicate rule, so a
			// payload that violates both gets the rule a user can act on first.
			name:   "range before duplicate",
			in:     []int32{-1, -1},
			wantVI: "Mỗi ngày nhắc phải nằm trong khoảng 0 đến 365",
			wantEN: "Each lead day must be between 0 and 365",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sorted, msgVI := normalizeLeadDays(viCtx(), tc.in)
			if sorted != nil {
				t.Errorf("normalizeLeadDays(%v) returned %v on an invalid input", tc.in, sorted)
			}
			if msgVI != tc.wantVI {
				t.Errorf("VI message = %q, want %q", msgVI, tc.wantVI)
			}
			if _, msgEN := normalizeLeadDays(enCtx(), tc.in); msgEN != tc.wantEN {
				t.Errorf("EN message = %q, want %q", msgEN, tc.wantEN)
			}
		})
	}
}

func TestLeadDaysNormalizeSortsDescending(t *testing.T) {
	cases := []struct {
		name string
		in   []int32
		want []int32
	}{
		{"already descending", []int32{30, 7}, []int32{30, 7}},
		{"ascending input", []int32{7, 30}, []int32{30, 7}},
		{"single boundary low", []int32{0}, []int32{0}},
		{"single boundary high", []int32{365}, []int32{365}},
		{"five values in random order", []int32{0, 365, 14, 3, 7}, []int32{365, 14, 7, 3, 0}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, msg := normalizeLeadDays(viCtx(), tc.in)
			if msg != "" {
				t.Fatalf("unexpected validation error: %s", msg)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("normalizeLeadDays(%v) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}

	// The input slice must not be sorted in place: a handler DTO and a test
	// fixture can both hold it, and a request should not mutate behind the caller.
	in := []int32{7, 30}
	if _, _ = normalizeLeadDays(viCtx(), in); !reflect.DeepEqual(in, []int32{7, 30}) {
		t.Errorf("normalizeLeadDays mutated its input to %v", in)
	}
}

// ─── Create default vs update unchanged ─────────────────────────────────────

func TestLeadDaysCreateDefaultAndUpdateUnchanged(t *testing.T) {
	// The two subjects have DIFFERENT defaults because the two old crons had
	// different schedules: Device fired at 7 and 30 days, Subscription at 3, 1
	// and 0. A single default would have moved every existing subscription's
	// renewal warnings two weeks earlier.
	if got := leadDaysForCreate(nil, DefaultDeviceLeadDays); !reflect.DeepEqual(got, []int32{30, 7}) {
		t.Errorf("device default = %v, want [30 7]", got)
	}
	if got := leadDaysForCreate(nil, DefaultSubscriptionLeadDays); !reflect.DeepEqual(got, []int32{3, 1, 0}) {
		t.Errorf("subscription default = %v, want [3 1 0]", got)
	}
	// An explicitly empty array is NOT nil and must not be defaulted: validation
	// rejects it, and silently turning it into a default would hide the 400.
	if got := leadDaysForCreate([]int32{}, DefaultDeviceLeadDays); got == nil || len(got) != 0 {
		t.Errorf("leadDaysForCreate(empty) = %v, want an empty non-nil slice", got)
	}
	if got := leadDaysForCreate([]int32{14, 3}, DefaultDeviceLeadDays); !reflect.DeepEqual(got, []int32{14, 3}) {
		t.Errorf("leadDaysForCreate(custom) = %v, want the input", got)
	}

	// Update: absent/null keeps the stored value, whatever it is.
	if got := leadDaysForUpdate(nil, []int32{14, 3}); !reflect.DeepEqual(got, []int32{14, 3}) {
		t.Errorf("leadDaysForUpdate(nil, [14 3]) = %v, want [14 3]", got)
	}
	if got := leadDaysForUpdate([]int32{7}, []int32{14, 3}); !reflect.DeepEqual(got, []int32{7}) {
		t.Errorf("leadDaysForUpdate([7], [14 3]) = %v, want [7]", got)
	}
	// Defensive: a legacy/hand-edited row with a NULL array must still produce a
	// non-NULL write, because the column is NOT NULL.
	if got := leadDaysForUpdate(nil, nil); !reflect.DeepEqual(got, []int32{30, 7}) {
		t.Errorf("leadDaysForUpdate(nil, nil) = %v, want the default", got)
	}

	// The exported default must not be reachable through the returned slice: one
	// caller mutating its copy must not change every future create.
	got := leadDaysForCreate(nil, DefaultDeviceLeadDays)
	got[0] = 1
	if DefaultDeviceLeadDays[0] != 30 {
		t.Fatalf("DefaultDeviceLeadDays was mutated through a returned copy: %v", DefaultDeviceLeadDays)
	}
	if DefaultSubscriptionLeadDays[2] != 0 {
		t.Fatalf("DefaultSubscriptionLeadDays was mutated through a returned copy: %v", DefaultSubscriptionLeadDays)
	}
}

// ─── The two validators that carry the rule ─────────────────────────────────

func validDeviceInput() DeviceInput {
	return DeviceInput{
		Name:          "Máy",
		Category:      "PHONE",
		PurchaseDate:  "2026-01-15",
		PurchasePrice: 1000,
	}
}

func TestValidateDeviceInputLeadDays(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   []int32
	}{
		{"empty", []int32{}},
		{"too many", []int32{1, 2, 3, 4, 5, 6}},
		{"negative", []int32{-1}},
		{"over 365", []int32{366}},
		{"duplicate", []int32{7, 7}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := validDeviceInput()
			in.LeadDays = tc.in
			err := ValidateDeviceInput(viCtx(), &in)
			svc, ok := As(err)
			if !ok {
				t.Fatalf("ValidateDeviceInput(%v) = %v, want a domain error", tc.in, err)
			}
			if svc.HTTPStatus() != 400 {
				t.Errorf("status = %d, want 400", svc.HTTPStatus())
			}
			if len(svc.FieldErrors["leadDays"]) == 0 {
				t.Errorf("fieldErrors.leadDays missing: %v", svc.FieldErrors)
			}
		})
	}

	// Valid input is sorted in place and accepted.
	in := validDeviceInput()
	in.LeadDays = []int32{7, 30}
	if err := ValidateDeviceInput(viCtx(), &in); err != nil {
		t.Fatalf("ValidateDeviceInput(valid) = %v", err)
	}
	if !reflect.DeepEqual(in.LeadDays, []int32{30, 7}) {
		t.Errorf("validated leadDays = %v, want descending [30 7]", in.LeadDays)
	}

	// nil is valid: it means "absent", not "invalid". The create/update paths
	// decide what absent means (default vs unchanged).
	in = validDeviceInput()
	if err := ValidateDeviceInput(viCtx(), &in); err != nil {
		t.Fatalf("ValidateDeviceInput(absent leadDays) = %v", err)
	}
	if in.LeadDays != nil {
		t.Errorf("absent leadDays was materialized by validation: %v", in.LeadDays)
	}
}

func validSubscriptionInput() SubscriptionInput {
	return SubscriptionInput{
		Name:         "Netflix",
		BillingCycle: BillingCycleMonthly,
		Price:        1000,
		StartedAt:    time.Date(2026, time.January, 15, 0, 0, 0, 0, time.UTC),
	}
}

func TestValidateSubscriptionInputLeadDays(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   []int32
	}{
		{"empty", []int32{}},
		{"too many", []int32{1, 2, 3, 4, 5, 6}},
		{"negative", []int32{-1}},
		{"over 365", []int32{366}},
		{"duplicate", []int32{7, 7}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := validSubscriptionInput()
			in.LeadDays = tc.in
			err := validateSubscriptionInput(viCtx(), &in)
			svc, ok := As(err)
			if !ok {
				t.Fatalf("validateSubscriptionInput(%v) = %v, want a domain error", tc.in, err)
			}
			if svc.HTTPStatus() != 400 {
				t.Errorf("status = %d, want 400", svc.HTTPStatus())
			}
			if len(svc.FieldErrors["leadDays"]) == 0 {
				t.Errorf("fieldErrors.leadDays missing: %v", svc.FieldErrors)
			}
		})
	}

	in := validSubscriptionInput()
	in.LeadDays = []int32{7, 30}
	if err := validateSubscriptionInput(viCtx(), &in); err != nil {
		t.Fatalf("validateSubscriptionInput(valid) = %v", err)
	}
	if !reflect.DeepEqual(in.LeadDays, []int32{30, 7}) {
		t.Errorf("validated leadDays = %v, want descending [30 7]", in.LeadDays)
	}

	in = validSubscriptionInput()
	if err := validateSubscriptionInput(viCtx(), &in); err != nil {
		t.Fatalf("validateSubscriptionInput(absent leadDays) = %v", err)
	}
	if in.LeadDays != nil {
		t.Errorf("absent leadDays was materialized by validation: %v", in.LeadDays)
	}
}

// ─── Real database: create default, update unchanged, every read ────────────

// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres.
func TestLeadDaysRoundTripAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const userID = "zz_test_lead_days_user"
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	// 1. Create with no leadDays -> default [30, 7].
	base := validDeviceInput()
	created, err := CreateDevice(ctx, pool, userID, base, "")
	if err != nil {
		t.Fatalf("CreateDevice(default): %v", err)
	}
	if !reflect.DeepEqual(created.LeadDays, []int32{30, 7}) {
		t.Errorf("created leadDays = %v, want the [30 7] default", created.LeadDays)
	}

	// 2. Create with an unsorted custom schedule -> stored descending.
	custom := validDeviceInput()
	custom.Name = "Custom"
	custom.LeadDays = []int32{3, 14}
	customDevice, err := CreateDevice(ctx, pool, userID, custom, "")
	if err != nil {
		t.Fatalf("CreateDevice(custom): %v", err)
	}
	if !reflect.DeepEqual(customDevice.LeadDays, []int32{14, 3}) {
		t.Errorf("created custom leadDays = %v, want descending [14 3]", customDevice.LeadDays)
	}

	// 3. Update without leadDays -> unchanged (NOT reset to [30, 7]).
	patch := validDeviceInput()
	patch.Name = "Custom renamed"
	updated, err := UpdateDevice(ctx, pool, userID, customDevice.ID, patch)
	if err != nil {
		t.Fatalf("UpdateDevice(without leadDays): %v", err)
	}
	if !reflect.DeepEqual(updated.LeadDays, []int32{14, 3}) {
		t.Errorf("updated leadDays = %v, want the stored [14 3]", updated.LeadDays)
	}

	// 4. Update with an explicit empty array -> normal 400, nothing written.
	patch.LeadDays = []int32{}
	if _, err := UpdateDevice(ctx, pool, userID, customDevice.ID, patch); err == nil {
		t.Fatal("UpdateDevice(empty leadDays) = nil, want a validation error")
	} else if svc, ok := As(err); !ok || len(svc.FieldErrors["leadDays"]) == 0 {
		t.Fatalf("UpdateDevice(empty leadDays) = %v, want fieldErrors.leadDays", err)
	}

	// 5. Every device read carries the field: list and detail.
	items, err := ListDevices(ctx, pool, userID, DeviceFilter{})
	if err != nil {
		t.Fatalf("ListDevices: %v", err)
	}
	foundList := false
	for _, it := range items {
		if it.ID == customDevice.ID {
			foundList = true
			if !reflect.DeepEqual(it.LeadDays, []int32{14, 3}) {
				t.Errorf("DeviceListItem.leadDays = %v, want [14 3]", it.LeadDays)
			}
		}
	}
	if !foundList {
		t.Error("custom device missing from ListDevices")
	}
	detail, err := GetDevice(ctx, pool, userID, customDevice.ID)
	if err != nil {
		t.Fatalf("GetDevice: %v", err)
	}
	if !reflect.DeepEqual(detail.LeadDays, []int32{14, 3}) {
		t.Errorf("DeviceDetail.leadDays = %v, want [14 3]", detail.LeadDays)
	}

	// 6. Subscriptions follow the same create/update rules.
	subBase := validSubscriptionInput()
	sub, err := CreateSubscription(ctx, pool, userID, subBase)
	if err != nil {
		t.Fatalf("CreateSubscription(default): %v", err)
	}
	if !reflect.DeepEqual(sub.LeadDays, []int32{30, 7}) {
		t.Errorf("created subscription leadDays = %v, want the [30 7] default", sub.LeadDays)
	}

	subCustom := validSubscriptionInput()
	subCustom.Name = "Custom sub"
	subCustom.LeadDays = []int32{3, 14}
	customSub, err := CreateSubscription(ctx, pool, userID, subCustom)
	if err != nil {
		t.Fatalf("CreateSubscription(custom): %v", err)
	}
	if !reflect.DeepEqual(customSub.LeadDays, []int32{14, 3}) {
		t.Errorf("created custom subscription leadDays = %v, want descending [14 3]", customSub.LeadDays)
	}

	subPatch := validSubscriptionInput()
	subPatch.Name = "Custom sub renamed"
	updatedSub, err := UpdateSubscription(ctx, pool, userID, customSub.ID, subPatch)
	if err != nil {
		t.Fatalf("UpdateSubscription(without leadDays): %v", err)
	}
	if !reflect.DeepEqual(updatedSub.LeadDays, []int32{14, 3}) {
		t.Errorf("updated subscription leadDays = %v, want the stored [14 3]", updatedSub.LeadDays)
	}

	subPatch.LeadDays = []int32{}
	if _, err := UpdateSubscription(ctx, pool, userID, customSub.ID, subPatch); err == nil {
		t.Fatal("UpdateSubscription(empty leadDays) = nil, want a validation error")
	} else if svc, ok := As(err); !ok || len(svc.FieldErrors["leadDays"]) == 0 {
		t.Fatalf("UpdateSubscription(empty leadDays) = %v, want fieldErrors.leadDays", err)
	}

	// 7. Every subscription read carries the field: list and detail.
	subs, err := ListSubscriptions(ctx, pool, userID, nil)
	if err != nil {
		t.Fatalf("ListSubscriptions: %v", err)
	}
	foundSub := false
	for _, s := range subs {
		if s.ID == customSub.ID {
			foundSub = true
			if !reflect.DeepEqual(s.LeadDays, []int32{14, 3}) {
				t.Errorf("Subscription list leadDays = %v, want [14 3]", s.LeadDays)
			}
		}
	}
	if !foundSub {
		t.Error("custom subscription missing from ListSubscriptions")
	}
	subDetail, err := GetSubscription(ctx, pool, userID, customSub.ID)
	if err != nil {
		t.Fatalf("GetSubscription: %v", err)
	}
	if !reflect.DeepEqual(subDetail.Subscription.LeadDays, []int32{14, 3}) {
		t.Errorf("SubscriptionDetail.leadDays = %v, want [14 3]", subDetail.Subscription.LeadDays)
	}
}

// A backup restore must not silently reset a custom schedule. The payload is
// additive (version stays 5/6), so an older file has no leadDays and imports as
// [30, 7]; a file written by this build carries the user's values.
func TestLeadDaysSurviveBackupRoundTrip(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	source, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect source: %v", err)
	}
	t.Cleanup(source.Close)

	const userID = "zz_test_lead_days_backup"
	if _, err := source.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert source user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = source.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	deviceIn := validDeviceInput()
	deviceIn.Name = "Backup custom"
	deviceIn.LeadDays = []int32{3, 14}
	createdDevice, err := CreateDevice(ctx, source, userID, deviceIn, "")
	if err != nil {
		t.Fatalf("CreateDevice: %v", err)
	}

	subIn := validSubscriptionInput()
	subIn.Name = "Backup custom sub"
	subIn.LeadDays = []int32{3, 14}
	createdSub, err := CreateSubscription(ctx, source, userID, subIn)
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	payload, err := ExportBackup(ctx, source, userID)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	var exportedDevice *BackupDevice
	for i := range payload.Devices {
		if payload.Devices[i].ID == createdDevice.ID {
			exportedDevice = &payload.Devices[i]
		}
	}
	if exportedDevice == nil || !reflect.DeepEqual(exportedDevice.LeadDays, []int32{14, 3}) {
		t.Fatalf("exported device leadDays = %+v, want [14 3]", exportedDevice)
	}
	var exportedSub *BackupSubscription
	for i := range payload.Subscriptions {
		if payload.Subscriptions[i].ID == createdSub.ID {
			exportedSub = &payload.Subscriptions[i]
		}
	}
	if exportedSub == nil || !reflect.DeepEqual(exportedSub.LeadDays, []int32{14, 3}) {
		t.Fatalf("exported subscription leadDays = %+v, want [14 3]", exportedSub)
	}

	targetDSN := createScratchDatabase(t, dsn)
	gooseUp(t, targetDSN)
	target, err := pgxpool.New(ctx, targetDSN)
	if err != nil {
		t.Fatalf("connect target: %v", err)
	}
	t.Cleanup(target.Close)
	if _, err := target.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())`,
		userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert target user: %v", err)
	}

	if _, err := ImportBackup(ctx, target, userID, payload, ImportReplace); err != nil {
		t.Fatalf("ImportBackup: %v", err)
	}
	restoredDevice, err := GetDevice(ctx, target, userID, createdDevice.ID)
	if err != nil {
		t.Fatalf("GetDevice after import: %v", err)
	}
	if !reflect.DeepEqual(restoredDevice.LeadDays, []int32{14, 3}) {
		t.Errorf("restored device leadDays = %v, want [14 3]", restoredDevice.LeadDays)
	}
	restoredSub, err := GetSubscription(ctx, target, userID, createdSub.ID)
	if err != nil {
		t.Fatalf("GetSubscription after import: %v", err)
	}
	if !reflect.DeepEqual(restoredSub.Subscription.LeadDays, []int32{14, 3}) {
		t.Errorf("restored subscription leadDays = %v, want [14 3]", restoredSub.Subscription.LeadDays)
	}
}
