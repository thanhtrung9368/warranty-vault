package handlers

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Component-scoped cover on the public handover certificate (migration 0017).
//
// A device can carry two clocks at once: a whole-unit plan and a much longer
// component plan (the 10-year motor). `Reminder` is per-warranty, so each row
// already gets its own retirement — that part was correct. The certificate's
// headline `effectiveWarrantyEnd` is what needed the fix: it must be the max over
// WHOLE-UNIT rows only, or the recipient reads the motor's 2035 as "the whole
// device is covered until 2035".
//
// These tests run only with WV_TEST_DATABASE_URL set (see testhelpers_test.go).

func TestPublicCertificateComponentRowDoesNotInflateWholeUnitEnd(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool) // one whole-unit plan ending 2026-11-20

	// A second plan that ends much later but covers only the motor.
	if _, err := env.pool.Exec(context.Background(),
		`INSERT INTO "Warranty" (id, "deviceId", type, component, provider, "startDate", "endDate", months, "updatedAt")
		 VALUES ('share_war_component', 'share_dev', 'EXTENDED', 'Động cơ', 'Hãng xe',
		         '2025-01-01', '2035-01-01', 120, NOW())`); err != nil {
		t.Fatalf("insert component warranty: %v", err)
	}

	token, rr := createShare(t, env, "share_dev", "")
	if token == "" {
		t.Fatalf("create share failed: %d (%s)", rr.Code, rr.Body.String())
	}
	pub, cert := getPublicJSON(t, env, token)
	if pub.Code != http.StatusOK {
		t.Fatalf("public read = %d (%s)", pub.Code, pub.Body.String())
	}

	// The headline answer is the whole-unit plan, NOT the motor's 2035 clock.
	if cert.EffectiveWarrantyEnd == nil || cert.EffectiveWarrantyEnd.String() != "2026-11-20" {
		t.Fatalf("effectiveWarrantyEnd = %v, want the calendar day 2026-11-20 — a component row must not inflate the whole-unit end",
			cert.EffectiveWarrantyEnd)
	}

	// The component row is still present and labelled, so the recipient can see
	// what the longer clock belongs to.
	var componentRow *services.SharedWarranty
	for i := range cert.Warranties {
		if cert.Warranties[i].Component != nil {
			componentRow = &cert.Warranties[i]
		}
	}
	if componentRow == nil {
		t.Fatalf("certificate lost the component row: %+v", cert.Warranties)
	}
	if *componentRow.Component != "Động cơ" {
		t.Errorf("component = %q, want Động cơ", *componentRow.Component)
	}
	if componentRow.EndDate.String() != "2035-01-01" {
		t.Errorf("component endDate = %q, want the motor clock as a day", componentRow.EndDate.String())
	}

	// And it is legible on the printed page, not just in the JSON projection.
	html := getPublic(t, env, token, "")
	if html.Code != http.StatusOK {
		t.Fatalf("html = %d", html.Code)
	}
	body := html.Body.String()
	for _, want := range []string{"Động cơ", "20/11/2026", "01/01/2035"} {
		if !strings.Contains(body, want) {
			t.Errorf("certificate html is missing %q", want)
		}
	}
}

// When EVERY row is component-scoped there is no whole-unit end date to report.
// The honest answer is nil / "no expiry date", not a max over the component
// rows; the per-row clocks still appear with their names.
func TestPublicCertificateOnlyComponentRowsHasNoWholeUnitEnd(t *testing.T) {
	env := setupShareTest(t)
	ctx := context.Background()

	if _, err := env.pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ('share_dev_comp_only', $1, 'Máy chỉ có bảo hành bộ phận', 'PHONE', '2025-01-01', 1000000, NOW())`,
		shareOwner); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	if _, err := env.pool.Exec(ctx,
		`INSERT INTO "Warranty" (id, "deviceId", type, component, "startDate", "endDate", months, "updatedAt")
		 VALUES ('share_war_comp_only', 'share_dev_comp_only', 'STANDARD', 'Màn hình',
		         '2025-01-01', '2030-01-01', 60, NOW())`); err != nil {
		t.Fatalf("insert component warranty: %v", err)
	}

	token, rr := createShare(t, env, "share_dev_comp_only", "")
	if token == "" {
		t.Fatalf("create share failed: %d (%s)", rr.Code, rr.Body.String())
	}
	_, cert := getPublicJSON(t, env, token)
	if cert.EffectiveWarrantyEnd != nil {
		t.Fatalf("effectiveWarrantyEnd = %v, want null when every row is component-scoped",
			cert.EffectiveWarrantyEnd)
	}
	if len(cert.Warranties) != 1 || cert.Warranties[0].Component == nil || *cert.Warranties[0].Component != "Màn hình" {
		t.Fatalf("component row missing from certificate: %+v", cert.Warranties)
	}

	html := getPublic(t, env, token, "")
	if html.Code != http.StatusOK {
		t.Fatalf("html = %d", html.Code)
	}
	if !strings.Contains(html.Body.String(), "Không có ngày hết hạn") {
		t.Error("html must say there is no whole-unit end date")
	}
	if !strings.Contains(html.Body.String(), "Màn hình") {
		t.Error("html must still show the component-scoped row")
	}
}
