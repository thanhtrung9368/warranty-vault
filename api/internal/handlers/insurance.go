package handlers

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterInsurance wires GET /api/v1/insurance-pack.
//
// The endpoint is authenticated and expensive (it decrypts and re-encodes up to
// 100 images), so it uses its own per-user bucket rather than the shared write
// bucket. The response is a binary PDF; every failure BEFORE the first byte uses
// the normal JSON error envelope, in the request's language.
func RegisterInsurance(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/insurance-pack", requireUser(http.HandlerFunc(insurancePackHandler(deps))))
}

func insurancePackHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)

		rl, _ := ratelimit.CheckInsurancePack(ctx, deps.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		includeSold, ok := parseBoolQuery(r.URL.Query().Get("includeSold"))
		if !ok {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Tham số includeSold không hợp lệ"),
				map[string][]string{"includeSold": {i18n.Text(ctx, "Phải là true hoặc false")}})
			return
		}

		opts := services.InsurancePackOptions{
			DeviceIDs:   services.ParseInsuranceDeviceIDs(r.URL.Query().Get("deviceIds")),
			IncludeSold: includeSold,
		}
		result, err := services.BuildInsurancePack(ctx, deps.DB, us.UserID, opts)
		if err != nil {
			writeServiceError(w, ctx, err, "insurance pack")
			return
		}

		filename := fmt.Sprintf("warrly-insurance-pack-%s.pdf",
			time.Now().In(time.FixedZone("ICT", 7*60*60)).Format("2006-01-02"))
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		w.Header().Set("Content-Length", strconv.Itoa(len(result.PDF)))
		w.Header().Set("Content-Language", "vi")
		w.Header().Set("Cache-Control", "private, no-store, max-age=0")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		if _, werr := w.Write(result.PDF); werr != nil {
			slog.Warn("insurance pack response write failed", "err", werr, "userId", us.UserID)
		}
		slog.Info("insurance pack generated",
			"userId", us.UserID,
			"devices", result.DeviceCount,
			"attachments", result.AttachmentCount,
			"images", result.EmbeddedImages,
			"bytes", len(result.PDF))
	}
}
