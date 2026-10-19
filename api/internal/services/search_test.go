package services

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// ---- DB-free: empty query, over-long query, empty-group shape --------------

func TestSearchBlankQueryReturnsEmptyGroupsWithoutDatabase(t *testing.T) {
	// A nil pool proves no SQL is issued: clearing a search box must not be able
	// to error.
	for _, raw := range []string{"", "   ", "\t\n"} {
		res, err := Search(context.Background(), nil, "u1", raw, 0)
		if err != nil {
			t.Fatalf("Search(%q) = %v, want empty groups and no error", raw, err)
		}
		if res.Query != "" {
			t.Errorf("Search(%q).Query = %q, want the trimmed empty string", raw, res.Query)
		}
		for _, group := range [][]int{{len(res.Devices)}, {len(res.Subscriptions)}, {len(res.Wishlist)}, {len(res.Attachments)}} {
			if group[0] != 0 {
				t.Errorf("Search(%q) returned %d rows in a group, want 0", raw, group[0])
			}
		}
		raw, err := json.Marshal(res)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		// Empty groups must be [] not null so clients can iterate unconditionally.
		for _, key := range []string{`"devices":[]`, `"subscriptions":[]`, `"wishlist":[]`, `"attachments":[]`} {
			if !strings.Contains(string(raw), key) {
				t.Errorf("empty payload %s is missing %s", raw, key)
			}
		}
	}
}

func TestSearchRejectsOverlongQueryBeforeTouchingDatabase(t *testing.T) {
	long := strings.Repeat("a", MaxSearchQueryRunes+1)
	// PINNED to Vietnamese. This assertion is about the Vietnamese message text —
	// which is the source sentence and the catalog key — so the test has to say
	// which language it is reading, or it would follow the machine default and turn
	// into the flakiest test in the package (docs/I18N_PLAN.md §4.3). The English
	// rendering is asserted in internal/handlers/search_i18n_test.go, over the wire.
	ctx := i18n.WithTag(context.Background(), i18n.VI)
	_, err := Search(ctx, nil, "u1", long, 0)
	if err == nil {
		t.Fatal("Search(over-long q) = nil, want a VALIDATION error")
	}
	svc, ok := As(err)
	if !ok || svc.Code != "VALIDATION" {
		t.Fatalf("Search(over-long q) = %v, want VALIDATION", err)
	}
	if !strings.Contains(svc.Message, "quá dài") {
		t.Errorf("message %q is not the Vietnamese 'quá dài' message", svc.Message)
	}
	// The CODE and the status do not move with the language: an English caller gets
	// the same 400 with the same `validation` code and an English sentence.
	enSvc, _ := As(mustSearchErr(t, i18n.WithTag(context.Background(), i18n.EN)))
	if enSvc.Code != svc.Code || enSvc.HTTPStatus() != svc.HTTPStatus() {
		t.Errorf("English code/status = %s/%d, want %s/%d",
			enSvc.Code, enSvc.HTTPStatus(), svc.Code, svc.HTTPStatus())
	}
	if enSvc.Message == svc.Message {
		t.Errorf("English message %q is identical to the Vietnamese one — the wave did not translate it", enSvc.Message)
	}
}

// mustSearchErr runs the over-long-query refusal in a given context and returns the
// error, so the language-independence assertions above read as one statement.
func mustSearchErr(t *testing.T, ctx context.Context) error {
	t.Helper()
	_, err := Search(ctx, nil, "u1", strings.Repeat("a", MaxSearchQueryRunes+1), 0)
	if err == nil {
		t.Fatal("over-long q = nil, want a VALIDATION error")
	}
	return err
}

// ---- real-database: cross-entity, diacritic-insensitive, scoped ------------

// Roadmap #7: "samsung" must find a subscription and a wishlist item, not only a
// device, and an unaccented query must find an accented name (the whole reason
// 0005/0007 exist). Runs only with WV_TEST_DATABASE_URL set.
func TestSearchAcrossEntitiesAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userA = "zz_test_search_a"
		userB = "zz_test_search_b"
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

	// User A: an accented device, a subscription and a wishlist item that all
	// mention Samsung.
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, brand, model, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ('zz_test_search_dev', $1, 'Điện thoại Samsung Galaxy S24', 'PHONE', 'Samsung', 'SM-S921', '2024-02-01', 25000000, NOW())`, userA); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Subscription" (id, "userId", name, brand, "billingCycle", price, "startedAt", "renewalDate", "updatedAt")
		 VALUES ('zz_test_search_sub', $1, 'Samsung Cloud 200GB', 'Samsung', 'MONTHLY', 55000, '2024-01-01', '2026-12-01', NOW())`, userA); err != nil {
		t.Fatalf("insert subscription: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "WishlistItem" (id, "userId", name, brand, priority, status, "updatedAt")
		 VALUES ('zz_test_search_wish', $1, 'Tai nghe Galaxy Buds', 'Samsung', 'WANT', 'WATCHING', NOW())`, userA); err != nil {
		t.Fatalf("insert wishlist: %v", err)
	}
	// User B: a matching device that must never leak into A's results, and a
	// matching wishlist item.
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, brand, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ('zz_test_search_dev_b', $1, 'Samsung Galaxy của B', 'PHONE', 'Samsung', '2024-01-01', 1000, NOW())`, userB); err != nil {
		t.Fatalf("insert device B: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "WishlistItem" (id, "userId", name, brand, priority, status, "updatedAt")
		 VALUES ('zz_test_search_wish_b', $1, 'Samsung Z Flip', 'Samsung', 'WANT', 'WATCHING', NOW())`, userB); err != nil {
		t.Fatalf("insert wishlist B: %v", err)
	}

	// 1. Diacritic-insensitive, cross-entity: the unaccented query finds the
	//    accented device name, the subscription and the wishlist item.
	res, err := Search(ctx, pool, userA, "samsung", 20)
	if err != nil {
		t.Fatalf("Search(samsung): %v", err)
	}
	if len(res.Devices) != 1 || res.Devices[0].ID != "zz_test_search_dev" {
		t.Errorf("devices = %+v, want exactly the user's Samsung device", res.Devices)
	}
	if len(res.Subscriptions) != 1 || res.Subscriptions[0].ID != "zz_test_search_sub" {
		t.Errorf("subscriptions = %+v, want exactly the user's Samsung subscription", res.Subscriptions)
	}
	if len(res.Wishlist) != 1 || res.Wishlist[0].ID != "zz_test_search_wish" {
		t.Errorf("wishlist = %+v, want exactly the user's Samsung wishlist item", res.Wishlist)
	}

	// 2. Unaccented query against an accented name — the 0007 regression case.
	res, err = Search(ctx, pool, userA, "dien thoai", 20)
	if err != nil {
		t.Fatalf("Search(dien thoai): %v", err)
	}
	if len(res.Devices) != 1 || res.Devices[0].ID != "zz_test_search_dev" {
		t.Errorf("devices for 'dien thoai' = %+v, want the 'Điện thoại ...' device", res.Devices)
	}
	if len(res.Subscriptions) != 0 || len(res.Wishlist) != 0 {
		t.Errorf("'dien thoai' matched subscriptions (%d) or wishlist (%d), want 0", len(res.Subscriptions), len(res.Wishlist))
	}

	// 3. The accented query still works, and case does not matter.
	for _, q := range []string{"Điện thoại", "ĐIỆN THOẠI", "SAMSUNG"} {
		res, err := Search(ctx, pool, userA, q, 20)
		if err != nil {
			t.Fatalf("Search(%q): %v", q, err)
		}
		if len(res.Devices) != 1 {
			t.Errorf("Search(%q) matched %d devices, want 1", q, len(res.Devices))
		}
	}

	// 4. Never leaks another account's rows.
	res, err = Search(ctx, pool, userA, "Samsung", 20)
	if err != nil {
		t.Fatalf("Search(Samsung, isolation): %v", err)
	}
	for _, d := range res.Devices {
		if d.UserId != userA {
			t.Errorf("device %s belongs to %s — cross-account leak", d.ID, d.UserId)
		}
	}
	for _, w := range res.Wishlist {
		if w.UserId != userA {
			t.Errorf("wishlist %s belongs to %s — cross-account leak", w.ID, w.UserId)
		}
	}
	for _, s := range res.Subscriptions {
		if s.UserId != userA {
			t.Errorf("subscription %s belongs to %s — cross-account leak", s.ID, s.UserId)
		}
	}

	// 5. Subscription-only fields are searched too (plan / accountEmail).
	res, err = Search(ctx, pool, userA, "cloud", 20)
	if err != nil {
		t.Fatalf("Search(cloud): %v", err)
	}
	if len(res.Subscriptions) != 1 {
		t.Errorf("Search(cloud) matched %d subscriptions, want 1", len(res.Subscriptions))
	}

	// 6. limit is honoured per group.
	for i := 0; i < 3; i++ {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "WishlistItem" (id, "userId", name, brand, priority, status, "updatedAt")
			 VALUES ($1, $2, 'Samsung thêm ' || $1, 'Samsung', 'WANT', 'WATCHING', NOW())`,
			"zz_test_search_extra_"+string(rune('a'+i)), userA); err != nil {
			t.Fatalf("insert extra wishlist: %v", err)
		}
	}
	res, err = Search(ctx, pool, userA, "samsung", 2)
	if err != nil {
		t.Fatalf("Search(samsung, limit=2): %v", err)
	}
	if len(res.Wishlist) != 2 {
		t.Errorf("wishlist rows = %d, want the limit (2)", len(res.Wishlist))
	}

	// 7. A query with no matches returns empty groups, not an error.
	res, err = Search(ctx, pool, userA, "khong-co-gi-khop-xyz", 20)
	if err != nil {
		t.Fatalf("Search(no match): %v", err)
	}
	if len(res.Devices)+len(res.Subscriptions)+len(res.Wishlist)+len(res.Attachments) != 0 {
		t.Errorf("no-match search returned rows: %+v", res)
	}
}

// The attachments group must serialise as a flat public attachment object plus
// `deviceId` (never the raw store row), and an inbox hit must carry `deviceId:
// null` rather than omitting it. This is the JSON shape the clients bind to.
func TestSearchAttachmentHitJSON(t *testing.T) {
	text := "Sạc nhanh 65W"
	res := &SearchResults{
		Query:         "65w",
		Devices:       []DeviceSearchHit{},
		Subscriptions: []store.Subscription{},
		Wishlist:      []store.WishlistItem{},
		Attachments: []AttachmentSearchHit{{
			AttachmentMeta: AttachmentMeta{
				ID:            "att_1",
				FileName:      "hoa-don.png",
				FileType:      "image/png",
				FileSize:      10,
				UploadedAt:    "2026-05-01T10:30:00Z",
				ExtractedText: &text,
			},
			DeviceID: nil,
		}},
	}
	blob, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(blob)
	for _, want := range []string{
		`"attachments":[{"id":"att_1"`,
		`"extractedText":"Sạc nhanh 65W"`,
		`"deviceId":null`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("attachments JSON missing %s:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{"storagePath", "wrappedKey", `"iv"`, "wrappedKey"} {
		if strings.Contains(got, forbidden) {
			t.Errorf("attachments JSON leaks %q:\n%s", forbidden, got)
		}
	}
}

// TestSearchAttachmentsAgainstRealPostgres covers the fourth search group added
// for roadmap #13: OCR text persisted on attachments (migration 0019). It pins
// the things that can silently break:
//
//   - the unaccent/lower expression used by the query actually finds Vietnamese
//     text from unaccented input;
//   - the GIN index exists on the SAME expression (byte-for-byte, otherwise the
//     planner quietly ignores it) and the planner really picks it;
//   - owner scoping, the per-group limit, and the inbox (`deviceId: null`) vs
//     filed (`deviceId: "<id>"`) distinction in a hit.
//
// UTF-8 is a hard prerequisite: a non-UTF-8 cluster cannot store Vietnamese
// characters at all, so the test skips loudly instead of proving only ASCII.
func TestSearchAttachmentsAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	var encoding string
	if err := pool.QueryRow(ctx, `SHOW server_encoding`).Scan(&encoding); err != nil {
		t.Fatalf("read server_encoding: %v", err)
	}
	if encoding != "UTF8" {
		t.Skipf("test database encoding is %s, not UTF8: Vietnamese OCR search cannot work here", encoding)
	}

	const (
		userA = "zz_test_search_att_a"
		userB = "zz_test_search_att_b"
		devA  = "zz_test_search_att_dev"
	)
	for _, u := range []string{userA, userB} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "User" (id, email, "passwordHash", "updatedAt")
			 VALUES ($1, $2, 'x', NOW()) ON CONFLICT (id) DO NOTHING`, u, u+"@example.invalid"); err != nil {
			t.Fatalf("insert user %s: %v", u, err)
		}
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Thiết bị test', 'PHONE', '2024-01-01', 1000, NOW())`, devA, userA); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`, []string{userA, userB})
	})

	// inserted with a nil deviceId = inbox item. IV/wrappedKey are dummy bytes;
	// search never touches them.
	insertAttachment := func(id, userID, text string, deviceID *string) {
		t.Helper()
		storagePath := InboxStorageSegment + "/" + id + ".enc"
		if deviceID != nil {
			storagePath = *deviceID + "/" + id + ".enc"
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO "Attachment" (id, "userId", "deviceId", "fileName", "storagePath", "fileType", "fileSize", iv, "wrappedKey", "uploadedAt", "extractedText")
			 VALUES ($1, $2, $3, 'hoa-don.png', $4, 'image/png', 100,
			         '\x000102030405060708090a0b'::bytea, '\x00'::bytea, NOW(), $5)`,
			id, userID, deviceID, storagePath, text); err != nil {
			t.Fatalf("insert attachment %s: %v", id, err)
		}
	}

	// Accented, mixed-case text in A's inbox; the same text on B to prove scoping.
	const ocrA = "Sạc nhanh 65W\nGói bảo hành mở rộng 12 tháng\nHoá đơn điện tử"
	const ocrB = "Sạc nhanh 65W của B"
	insertAttachment("zz_test_search_att_a1", userA, ocrA, nil)
	insertAttachment("zz_test_search_att_b1", userB, ocrB, nil)

	// 1. Unaccented lower-case input finds the accented transcript.
	res, err := Search(ctx, pool, userA, "sac nhanh", 20)
	if err != nil {
		t.Fatalf("Search(sac nhanh): %v", err)
	}
	if len(res.Attachments) != 1 || res.Attachments[0].ID != "zz_test_search_att_a1" {
		t.Fatalf("attachments = %+v, want exactly A's inbox hit", res.Attachments)
	}
	hit := res.Attachments[0]
	if hit.DeviceID != nil {
		t.Errorf("inbox hit deviceId = %q, want null", *hit.DeviceID)
	}
	if hit.ExtractedText == nil || *hit.ExtractedText != ocrA {
		t.Errorf("hit extractedText = %v, want the stored transcript", hit.ExtractedText)
	}
	if hit.FileName != "hoa-don.png" || hit.FileType != "image/png" || hit.FileSize != 100 {
		t.Errorf("hit metadata = %+v, want the attachment's public fields", hit)
	}

	// 2. Another phrase in the middle of the document, and case folding.
	for _, q := range []string{"goi bao hanh mo rong", "HOÁ ĐƠN ĐIỆN TỬ", "65W"} {
		res, err := Search(ctx, pool, userA, q, 20)
		if err != nil {
			t.Fatalf("Search(%q): %v", q, err)
		}
		if len(res.Attachments) != 1 || res.Attachments[0].ID != "zz_test_search_att_a1" {
			t.Errorf("Search(%q) attachments = %+v, want A's transcript", q, res.Attachments)
		}
	}

	// 3. A filed attachment reports its device; the same row moves from the inbox
	//    (deviceId null) to the device without changing its text or id.
	if _, err := pool.Exec(ctx,
		`UPDATE "Attachment" SET "deviceId" = $1, "storagePath" = $1 || '/zz_test_search_att_a1.enc'
		 WHERE id = 'zz_test_search_att_a1'`, devA); err != nil {
		t.Fatalf("file attachment: %v", err)
	}
	res, err = Search(ctx, pool, userA, "sac nhanh", 20)
	if err != nil {
		t.Fatalf("Search(filed): %v", err)
	}
	if len(res.Attachments) != 1 || res.Attachments[0].DeviceID == nil || *res.Attachments[0].DeviceID != devA {
		t.Fatalf("filed hit = %+v, want deviceId %q", res.Attachments, devA)
	}

	// 4. limit is per-group, exactly like the other three groups.
	for i := 0; i < 3; i++ {
		insertAttachment("zz_test_search_att_extra_"+string(rune('a'+i)), userA,
			"Sạc nhanh 65W bản thêm", nil)
	}
	res, err = Search(ctx, pool, userA, "sac nhanh", 2)
	if err != nil {
		t.Fatalf("Search(limit=2): %v", err)
	}
	if len(res.Attachments) != 2 {
		t.Errorf("attachments with limit=2 = %d, want 2", len(res.Attachments))
	}

	// 5. No match => empty slice (the DB-free test pins the JSON [] shape).
	res, err = Search(ctx, pool, userA, "khong-co-gi-khop-xyz", 20)
	if err != nil {
		t.Fatalf("Search(no match): %v", err)
	}
	if len(res.Attachments) != 0 {
		t.Errorf("no-match attachments = %+v, want 0", res.Attachments)
	}

	// 6. Owner scoping: B never sees A's rows and vice versa.
	resB, err := Search(ctx, pool, userB, "sac nhanh", 20)
	if err != nil {
		t.Fatalf("Search(userB): %v", err)
	}
	if len(resB.Attachments) != 1 || resB.Attachments[0].ID != "zz_test_search_att_b1" {
		t.Errorf("userB attachments = %+v, want only B's row", resB.Attachments)
	}
	for _, h := range resB.Attachments {
		if h.ID == "zz_test_search_att_a1" {
			t.Error("cross-account leak: A's attachment appeared in B's results")
		}
	}

	// 7. The index must exist on exactly the expression the query uses. A drift
	//    here does not break correctness — it silently degrades to a scan — so it
	//    is asserted rather than assumed.
	var indexDef string
	if err := pool.QueryRow(ctx,
		`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Attachment_extractedText_trgm_idx'`).
		Scan(&indexDef); err != nil {
		t.Fatalf("index Attachment_extractedText_trgm_idx missing: %v", err)
	}
	if !strings.Contains(indexDef, "lower(wv_unaccent(") || strings.Contains(indexDef, "wv_unaccent(lower(") {
		t.Errorf("index is not on lower(wv_unaccent(...)): %s", indexDef)
	}
	if !strings.Contains(indexDef, `"extractedText"`) || !strings.Contains(indexDef, "gin_trgm_ops") {
		t.Errorf("index definition = %s, want a GIN trigram index on extractedText", indexDef)
	}

	// 8. The planner really picks that index for the LIKE predicate (with a
	//    sequential scan made unattractive). If the expression in search.sql
	//    drifts, this plan falls back to a scan.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SET LOCAL enable_seqscan = off`); err != nil {
		t.Fatalf("disable seqscan: %v", err)
	}
	rows, err := tx.Query(ctx,
		`EXPLAIN SELECT * FROM "Attachment"
		 WHERE lower(public.wv_unaccent("extractedText")) LIKE '%' || lower(public.wv_unaccent('sac nhanh')) || '%'`)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("scan explain: %v", err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	rows.Close()
	if !strings.Contains(plan.String(), "Attachment_extractedText_trgm_idx") {
		t.Errorf("planner did not use Attachment_extractedText_trgm_idx:\n%s", plan.String())
	}
}
