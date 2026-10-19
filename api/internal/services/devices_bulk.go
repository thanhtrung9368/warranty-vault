package services

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// MaxBulkDeviceRows is the batch cap of POST /api/v1/devices/bulk. It is a
// request-shape limit, not a per-user quota: a batch of 50 may still be refused
// whole by the device ceilings (50 active / 500 total), and a batch of 50 at the
// ceiling may still succeed for 49 of them if one row fails validation.
//
// 50 matches MaxDevicesPerUser because the feature this endpoint exists for is
// "a user with twelve household devices pastes the shop's order confirmation" —
// one batch should be able to fill an empty account to the active ceiling.
// Raising it would not raise the account ceiling, it would only let a client send
// rows the quota is guaranteed to refuse.
const MaxBulkDeviceRows = 50

// BulkDeviceFailure is one row that did not become a Device. `index` is the
// position in the REQUEST's `devices` array, never the position among failures,
// so a client can put the message back on the row that produced it even when
// successful rows were interleaved.
//
// Code is the lower-case wire code of the single-device endpoint (`validation`,
// `category_invalid`) — the same codes, and the same field keys, a client already
// handles for POST /api/v1/devices. Message is already rendered in the request's
// language; FieldErrors is always an object (never null), even when empty.
type BulkDeviceFailure struct {
	Index       int         `json:"index"`
	Code        string      `json:"code"`
	Message     string      `json:"message"`
	FieldErrors FieldErrors `json:"fieldErrors"`
}

// BulkDeviceResult is the 200 body of POST /api/v1/devices/bulk.
//
// Both arrays are always present and never null: an all-valid batch answers
// `failed: []`, an all-invalid batch answers `created: []`. Created rows are in
// request order (failures are skipped, they do not reorder the survivors).
type BulkDeviceResult struct {
	Created []DeviceVND         `json:"created"`
	Failed  []BulkDeviceFailure `json:"failed"`
}

// catalogCategoryLookup adapts the cached catalog to the same categoryLookup
// interface assertCategoryExists already takes. The bulk path loads the catalog
// ONCE (through ListCatalog's 60s in-process cache) and then answers every row
// from this map, so a 50-row batch still costs zero category queries after the
// first cache miss.
//
// Reusing assertCategoryExists rather than re-implementing the check is
// deliberate: it is the one place that builds CATEGORY_INVALID with the right
// code, headline and `fieldErrors.category` sentence, so the single and bulk
// paths cannot drift.
type catalogCategoryLookup map[string]struct{}

func (m catalogCategoryLookup) GetCategoryByCode(_ context.Context, code string) (store.Category, error) {
	if _, ok := m[code]; ok {
		return store.Category{Code: code, IsActive: true}, nil
	}
	return store.Category{}, pgx.ErrNoRows
}

// bulkCategoryLookup loads the cached category codes for a batch.
func bulkCategoryLookup(ctx context.Context, db *pgxpool.Pool) (catalogCategoryLookup, error) {
	catalog, err := ListCatalog(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("load catalog: %w", err)
	}
	lookup := make(catalogCategoryLookup, len(catalog.Categories))
	for _, c := range catalog.Categories {
		lookup[c.Code] = struct{}{}
	}
	return lookup, nil
}

// bulkCandidate is a row that passed validation and is ready to INSERT.
type bulkCandidate struct {
	index  int
	input  DeviceInput
	values deviceCreateValues
}

// bulkPlan is the pure, database-free result of validating a batch: what can be
// created (in request order) and what must be reported as failed (also in
// request order). Keeping this separate from the transaction makes the
// partial-success rule unit-testable without Postgres.
type bulkPlan struct {
	candidates []bulkCandidate
	failures   []BulkDeviceFailure
}

// ValidateBulkBatchSize enforces the request-shape rules before any row is
// looked at. Over 50 is the contract's 400 `fieldErrors.devices`; an empty array
// is the same shape of error, because a successful empty batch would be a
// no-op the client cannot distinguish from "I sent nothing".
//
// It is exported because the handler calls it before rate-limiting the batch:
// charging 51 write tokens for a request that is about to be rejected for its
// size would be a pointless 429 under load. The service calls it again so a
// direct service caller cannot bypass the cap.
func ValidateBulkBatchSize(ctx context.Context, n int) error {
	switch {
	case n == 0:
		message := i18n.Text(ctx, "Cần ít nhất một thiết bị")
		return ErrValidationKeyed("Cần ít nhất một thiết bị", FieldErrors{
			"devices": {message},
		})
	case n > MaxBulkDeviceRows:
		message := i18n.Text(ctx, "Mỗi lần chỉ thêm tối đa 50 thiết bị")
		return ErrValidationKeyed("Mỗi lần chỉ thêm tối đa 50 thiết bị", FieldErrors{
			"devices": {message},
		})
	default:
		return nil
	}
}

// planBulkDevices validates every row with the same functions the single create
// uses, in the same order: ValidateDeviceInput → category → the create-only
// parsing/currency/brand step. A row that fails is recorded and the next row is
// still processed; a row that passes is prepared for the transaction.
//
// The only possible non-domain error is a bug in one of those helpers; it is
// returned and fails the whole request with a 500 rather than being mislabelled
// as a user error on one row.
func planBulkDevices(ctx context.Context, inputs []DeviceInput, categories catalogCategoryLookup) (bulkPlan, error) {
	plan := bulkPlan{
		candidates: make([]bulkCandidate, 0, len(inputs)),
		failures:   make([]BulkDeviceFailure, 0),
	}
	for i := range inputs {
		in := inputs[i]

		if err := ValidateDeviceInput(ctx, &in); err != nil {
			failure, ok := bulkFailureFromError(ctx, i, err)
			if !ok {
				return bulkPlan{}, err
			}
			plan.failures = append(plan.failures, failure)
			continue
		}
		if err := assertCategoryExists(ctx, categories, in.Category); err != nil {
			failure, ok := bulkFailureFromError(ctx, i, err)
			if !ok {
				return bulkPlan{}, err
			}
			plan.failures = append(plan.failures, failure)
			continue
		}
		values, err := prepareDeviceCreate(ctx, in)
		if err != nil {
			failure, ok := bulkFailureFromError(ctx, i, err)
			if !ok {
				return bulkPlan{}, err
			}
			plan.failures = append(plan.failures, failure)
			continue
		}
		plan.candidates = append(plan.candidates, bulkCandidate{index: i, input: in, values: values})
	}
	return plan, nil
}

// bulkFailureFromError turns one row's domain error into the wire shape. A
// non-domain error returns ok=false so the caller can fail the whole request
// instead of pretending the row was the user's fault.
//
// The message rendering mirrors handlers.writeDevicesErr: MessageKey (when set)
// is translated with i18n.Text, because the key travels as data and must not go
// through the printf-shaped i18n.T. An unconverted error (no MessageKey) is sent
// verbatim, exactly as the single-device envelope would send it.
func bulkFailureFromError(ctx context.Context, index int, err error) (BulkDeviceFailure, bool) {
	svc, ok := As(err)
	if !ok {
		return BulkDeviceFailure{}, false
	}
	message := svc.Message
	if svc.MessageKey != "" {
		message = i18n.Text(ctx, svc.MessageKey)
	}
	fields := svc.FieldErrors
	if fields == nil {
		fields = FieldErrors{}
	}
	return BulkDeviceFailure{
		Index:       index,
		Code:        strings.ToLower(svc.Code),
		Message:     message,
		FieldErrors: fields,
	}, true
}

// BulkCreateDevices implements POST /api/v1/devices/bulk.
//
// # Partial success
//
// Every row is validated independently with the single create's validators. A
// bad row is reported in Failed and does not stop its neighbours; the valid rows
// are inserted in request order.
//
// # Quota
//
// The ceiling is checked against the whole batch of VALID candidates, after
// validation and before any INSERT. A batch that would exceed either ceiling is
// refused whole with LIMIT_REACHED (409) and nothing is created — never 37 rows
// and a confusing error. Rows that failed validation are not counted, because
// they will never become rows; a batch of 50 where one row is invalid is a
// batch of 49 writes and is allowed when 49 fit.
//
// # Atomicity
//
// Counting and every INSERT happen in ONE transaction, serialised per user by
// lockUserDeviceWrites. Validation happens before the transaction, so a
// validation failure is a normal partial-success outcome rather than a rollback.
// But once the first candidate is inserted, either ALL candidates commit or none
// do: a write error (constraint, connection, context cancellation) rolls the
// whole transaction back. There is no state in which some passing rows are
// committed and others from the same request are not.
//
// # Category catalog
//
// Categories are read once through ListCatalog's cache, not once per row. See
// catalogCategoryLookup.
func BulkCreateDevices(ctx context.Context, db *pgxpool.Pool, userID string, inputs []DeviceInput) (*BulkDeviceResult, error) {
	if err := ValidateBulkBatchSize(ctx, len(inputs)); err != nil {
		return nil, err
	}

	categories, err := bulkCategoryLookup(ctx, db)
	if err != nil {
		return nil, err
	}
	plan, err := planBulkDevices(ctx, inputs, categories)
	if err != nil {
		return nil, err
	}

	result := &BulkDeviceResult{
		Created: make([]DeviceVND, 0, len(plan.candidates)),
		Failed:  plan.failures,
	}
	// Nothing valid to write: this is a 200 with every row in `failed`, not a
	// 409. There is no batch to exceed the quota with.
	if len(plan.candidates) == 0 {
		return result, nil
	}

	var incomingActive int64
	for _, c := range plan.candidates {
		incomingActive += deviceActiveIncoming(c.input.Status)
	}
	incomingTotal := int64(len(plan.candidates))

	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// The authoritative quota check. The lock is taken BEFORE the counts and
	// held through COMMIT, so a concurrent CreateDevice (which takes the same
	// lock) cannot slip an INSERT between our count and our writes.
	if err := lockUserDeviceWrites(ctx, tx, userID); err != nil {
		return nil, err
	}
	tq := store.New(tx)
	if err := assertDeviceQuota(ctx, tq, userID, incomingActive, incomingTotal); err != nil {
		return nil, err
	}

	created := make([]store.Device, 0, len(plan.candidates))
	for _, c := range plan.candidates {
		device, err := createDeviceWithWarranty(ctx, tq, userID, c.input, c.values)
		if err != nil {
			return nil, err
		}
		created = append(created, device)
	}

	// One batched warranty read for the whole batch, exactly the rows
	// ListWarrantiesByDevice would return for each device individually. The
	// computed warrantyMismatch on each created device must match what a later
	// GET returns, so it is built from real rows rather than from the input.
	ids := make([]string, 0, len(created))
	for _, d := range created {
		ids = append(ids, d.ID)
	}
	warranties, err := tq.ListWarrantiesByDeviceIDs(ctx, store.ListWarrantiesByDeviceIDsParams{
		Column1: ids,
		UserId:  userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list warranties after bulk create: %w", err)
	}
	warByDevice := make(map[string][]store.Warranty, len(created))
	for _, w := range warranties {
		warByDevice[w.DeviceId] = append(warByDevice[w.DeviceId], w)
	}
	for _, d := range created {
		result.Created = append(result.Created, withVNDAndWarranties(d, warByDevice[d.ID]))
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return result, nil
}
