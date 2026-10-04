package services

import (
	"context"
	"strings"
	"testing"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// Pure tests for the device ceilings (FEATURE_IDEAS #14). The database-backed
// boundary test lives in internal/handlers (per-test scratch database); this file
// pins the arithmetic and the two Vietnamese messages, both of which are pure.
//
// The messages are rendered in the language resolved from the context, and the
// product default is English (docs/I18N_PLAN.md §2.2), so every call here passes
// a context with Vietnamese PINNED to it. That is the i18n rule for tests: pin
// the language, never soften the assertion — the two sentences below were
// correct before Phase 1 and stay correct after it.
func viCtx() context.Context { return i18n.WithTag(context.Background(), i18n.VI) }

func TestEnforceDeviceQuotaBoundaries(t *testing.T) {
	cases := []struct {
		name                        string
		active, total               int64
		incomingActive, incomingTot int64
		wantErr                     bool
	}{
		{"49 active + 3 sold, add 1 active → allowed", 49, 52, 1, 1, false},
		{"50 active + 1 sold, add 1 active → refused", 50, 51, 1, 1, true},
		{"50 active, add 1 sold → allowed (no active slot used)", 50, 50, 0, 1, false},
		{"49 active, add 1 active → allowed (the 50th)", 49, 49, 1, 1, false},
		{"499 rows total, add 1 sold → allowed (the 500th)", 0, 499, 0, 1, false},
		{"500 rows total, add 1 sold → refused by the storage ceiling", 0, 500, 0, 1, true},
		{"499 rows total, add 1 active → allowed", 40, 499, 1, 1, false},
		{"501 sold-only device payload → refused", 0, 0, 0, 501, true},
		{"replace import of 50 active onto 50 active → allowed (base is zero)", 0, 0, 50, 50, false},
		{"merge import that adds 1 active to 50 → refused", 50, 51, 1, 1, true},
		{"no incoming rows → always allowed", 50, 5000, 0, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := enforceDeviceQuota(viCtx(), tc.active, tc.total, tc.incomingActive, tc.incomingTot)
			if tc.wantErr && err == nil {
				t.Fatal("expected a limit error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected success, got %v", err)
			}
			if tc.wantErr {
				svc, ok := As(err)
				if !ok || svc.Code != "LIMIT_REACHED" {
					t.Fatalf("error = %#v, want LIMIT_REACHED", err)
				}
			}
		})
	}
}

// The old message was a flat "Đã đạt giới hạn 50 thiết bị", wrong on two counts: it
// implied sold devices counted, and it named no way out. Pin the facts a user needs
// in order to act.
func TestDeviceQuotaMessagesAreTruthful(t *testing.T) {
	errActive := enforceDeviceQuota(viCtx(), MaxDevicesPerUser, MaxDevicesPerUser+3, 1, 1)
	if errActive == nil {
		t.Fatal("expected the active ceiling to be enforced")
	}
	for _, want := range []string{"50", "Đã bán", "không chiếm suất", "chưa bán"} {
		if !strings.Contains(errActive.Error(), want) {
			t.Errorf("active-limit message %q must mention %q", errActive.Error(), want)
		}
	}

	errTotal := enforceDeviceQuota(viCtx(), 0, MaxDevicesTotalPerUser, 0, 1)
	if errTotal == nil {
		t.Fatal("expected the storage ceiling to be enforced")
	}
	for _, want := range []string{"500", "đã bán", "Xoá"} {
		if !strings.Contains(errTotal.Error(), want) {
			t.Errorf("total-limit message %q must mention %q", errTotal.Error(), want)
		}
	}
}

func TestDeviceActiveIncomingMatchesTheSQLPredicate(t *testing.T) {
	// CountActiveDevicesByUser counts `status <> 'SOLD'`, a LITERAL comparison.
	// This function must agree with it byte for byte, so a padded or lower-cased
	// status counts as active — the strict direction, which cannot be used to slip
	// past the ceiling.
	cases := []struct {
		status string
		want   int64
	}{
		{"SOLD", 0},
		{"ACTIVE", 1},
		{"EXPIRED", 1},
		{"BROKEN", 1},
		{"LOST", 1},
		{"", 1},
		{"sold", 1},   // lower case is not the stored code
		{" SOLD ", 1}, // nor is a padded value
		{"SOLD\n", 1}, // nor one with a trailing byte
		{"ĐÃ BÁN", 1}, // nor the Vietnamese label
	}
	for _, tc := range cases {
		if got := deviceActiveIncoming(tc.status); got != tc.want {
			t.Errorf("deviceActiveIncoming(%q) = %d, want %d", tc.status, got, tc.want)
		}
	}
}
