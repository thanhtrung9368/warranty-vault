package handlers

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// RegisterSubscriptions wires the /api/v1/subscriptions endpoints onto mux.
// All routes require a valid bearer token; mutating routes additionally
// run through the per-user write rate limiter (60 writes / 60s).
//
// Named RegisterSubscriptions (not Register) to avoid colliding with the
// auth-register handler in this same package.
func RegisterSubscriptions(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("GET /api/v1/subscriptions",
		requireUser(http.HandlerFunc(listSubscriptionsHandler(deps))))
	mux.Handle("POST /api/v1/subscriptions",
		requireUser(http.HandlerFunc(createSubscriptionHandler(deps))))
	mux.Handle("GET /api/v1/subscriptions/{id}",
		requireUser(http.HandlerFunc(getSubscriptionHandler(deps))))
	mux.Handle("PATCH /api/v1/subscriptions/{id}",
		requireUser(http.HandlerFunc(updateSubscriptionHandler(deps))))
	mux.Handle("DELETE /api/v1/subscriptions/{id}",
		requireUser(http.HandlerFunc(deleteSubscriptionHandler(deps))))
	mux.Handle("POST /api/v1/subscriptions/{id}/payments",
		requireUser(http.HandlerFunc(logSubscriptionPaymentHandler(deps))))
	mux.Handle("POST /api/v1/subscriptions/{id}/renew",
		requireUser(http.HandlerFunc(renewSubscriptionHandler(deps))))
}

// ---- request shapes -------------------------------------------------------

// subscriptionRequest is the JSON body shape for create + update. Optional
// strings come in as *string; "" is treated as nil at the service layer
// (matching TS Zod `blankToNull`).
type subscriptionRequest struct {
	Name          string  `json:"name"`
	Category      *string `json:"category"`
	Brand         *string `json:"brand"`
	Plan          *string `json:"plan"`
	BillingCycle  string  `json:"billingCycle"`
	IntervalDays  *int32  `json:"intervalDays"`
	Price         int32   `json:"price"`
	StartedAt     string  `json:"startedAt"`
	RenewalDate   *string `json:"renewalDate"`
	AutoRenew     bool    `json:"autoRenew"`
	Status        string  `json:"status"`
	AccountEmail  *string `json:"accountEmail"`
	PaymentMethod *string `json:"paymentMethod"`
	ManageURL     *string `json:"manageUrl"`
	CancelURL     *string `json:"cancelUrl"`
	Notes         *string `json:"notes"`
}

type subscriptionPaymentRequest struct {
	Amount int32   `json:"amount"`
	PaidAt *string `json:"paidAt"`
	Note   *string `json:"note"`
}

// parseFlexibleSubDate accepts ISO 8601 / YYYY-MM-DD; returns zero time if
// the input is empty.
func parseFlexibleSubDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, nil
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, errors.New("invalid date")
}

func subscriptionRequestToInput(body subscriptionRequest) (services.SubscriptionInput, map[string][]string) {
	ferrs := map[string][]string{}

	startedAt, err := parseFlexibleSubDate(body.StartedAt)
	if err != nil {
		ferrs["startedAt"] = []string{"Ngày bắt đầu không hợp lệ"}
	}

	var renewalPtr *time.Time
	if body.RenewalDate != nil && strings.TrimSpace(*body.RenewalDate) != "" {
		t, err := parseFlexibleSubDate(*body.RenewalDate)
		if err != nil {
			ferrs["renewalDate"] = []string{"Ngày gia hạn không hợp lệ"}
		} else {
			renewalPtr = &t
		}
	}

	return services.SubscriptionInput{
		Name:          body.Name,
		Category:      body.Category,
		Brand:         body.Brand,
		Plan:          body.Plan,
		BillingCycle:  body.BillingCycle,
		IntervalDays:  body.IntervalDays,
		Price:         body.Price,
		StartedAt:     startedAt,
		RenewalDate:   renewalPtr,
		AutoRenew:     body.AutoRenew,
		Status:        body.Status,
		AccountEmail:  body.AccountEmail,
		PaymentMethod: body.PaymentMethod,
		ManageURL:     body.ManageURL,
		CancelURL:     body.CancelURL,
		Notes:         body.Notes,
	}, ferrs
}

// ---- GET /api/v1/subscriptions ------------------------------------------------

func listSubscriptionsHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())

		var statusArg *string
		if s := strings.TrimSpace(r.URL.Query().Get("status")); s != "" {
			if !services.IsValidSubscriptionStatus(s) {
				badInput(w, map[string][]string{"status": {"Trạng thái không hợp lệ"}})
				return
			}
			statusArg = &s
		}

		rows, err := services.ListSubscriptions(r.Context(), deps.DB, us.UserID, statusArg)
		if err != nil {
			writeServiceError(w, err, "list subscriptions")
			return
		}
		if rows == nil {
			rows = []store.Subscription{}
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"subscriptions": rows})
	}
}

// ---- POST /api/v1/subscriptions -----------------------------------------------

func createSubscriptionHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}

		var body subscriptionRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w)
			return
		}

		input, ferrs := subscriptionRequestToInput(body)
		if len(ferrs) > 0 {
			badInput(w, ferrs)
			return
		}

		created, err := services.CreateSubscription(r.Context(), deps.DB, us.UserID, input)
		if err != nil {
			writeServiceError(w, err, "create subscription")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"subscription": created})
	}
}

// ---- GET /api/v1/subscriptions/{id} -------------------------------------------

// subscriptionDetail is the on-the-wire shape that bundles payments inline
// with the subscription, mirroring the TS `prisma.findFirst({ include })`.
type subscriptionDetailDTO struct {
	store.Subscription
	Payments []store.SubscriptionPayment `json:"payments"`
}

func getSubscriptionHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id", nil)
			return
		}

		detail, err := services.GetSubscription(r.Context(), deps.DB, us.UserID, id)
		if err != nil {
			writeServiceError(w, err, "get subscription")
			return
		}
		out := subscriptionDetailDTO{
			Subscription: detail.Subscription,
			Payments:     detail.Payments,
		}
		if out.Payments == nil {
			out.Payments = []store.SubscriptionPayment{}
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"subscription": out})
	}
}

// ---- PATCH /api/v1/subscriptions/{id} -----------------------------------------

func updateSubscriptionHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id", nil)
			return
		}

		var body subscriptionRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w)
			return
		}

		input, ferrs := subscriptionRequestToInput(body)
		if len(ferrs) > 0 {
			badInput(w, ferrs)
			return
		}

		updated, err := services.UpdateSubscription(r.Context(), deps.DB, us.UserID, id, input)
		if err != nil {
			writeServiceError(w, err, "update subscription")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"subscription": updated})
	}
}

// ---- DELETE /api/v1/subscriptions/{id} ----------------------------------------

func deleteSubscriptionHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id", nil)
			return
		}
		if err := services.DeleteSubscription(r.Context(), deps.DB, us.UserID, id); err != nil {
			writeServiceError(w, err, "delete subscription")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ---- POST /api/v1/subscriptions/{id}/payments ---------------------------------

func logSubscriptionPaymentHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id", nil)
			return
		}

		var body subscriptionPaymentRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w)
			return
		}

		var paidAt time.Time
		if body.PaidAt == nil || strings.TrimSpace(*body.PaidAt) == "" {
			paidAt = time.Now().UTC()
		} else {
			t, err := parseFlexibleSubDate(*body.PaidAt)
			if err != nil {
				badInput(w, map[string][]string{"paidAt": {"Ngày thanh toán không hợp lệ"}})
				return
			}
			paidAt = t
		}

		payment, err := services.LogPayment(r.Context(), deps.DB, us.UserID, id, body.Amount, paidAt, body.Note)
		if err != nil {
			writeServiceError(w, err, "log payment")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"payment": payment})
	}
}

// ---- POST /api/v1/subscriptions/{id}/renew ------------------------------------

func renewSubscriptionHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id", nil)
			return
		}

		updated, err := services.Renew(r.Context(), deps.DB, us.UserID, id)
		if err != nil {
			writeServiceError(w, err, "renew subscription")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"subscription": updated})
	}
}
