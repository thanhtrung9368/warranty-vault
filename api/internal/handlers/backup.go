package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// 50 MB cap on import body — matches the legacy TS comment + is plenty for
// the realistic per-user data graph (encrypted attachments dominate, but
// each is bounded to 5 MB and per-user total bytes capped at 100 MB anyway).
const maxImportBodyBytes = 50 * 1024 * 1024

// RegisterBackup wires GET /api/v1/backup/export + POST /api/v1/backup/import
// behind RequireUser.
func RegisterBackup(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("GET /api/v1/backup/export",
		requireUser(http.HandlerFunc(exportBackupHandler(deps))))
	mux.Handle("POST /api/v1/backup/import",
		requireUser(http.HandlerFunc(importBackupHandler(deps))))
}

func exportBackupHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())

		out, err := services.ExportBackup(r.Context(), deps.DB, us.UserID)
		if err != nil {
			slog.Error("backup export failed", "err", err, "userId", us.UserID)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		fname := fmt.Sprintf("warranty-vault-%s-%s.json",
			safeFilenameSegment(us.UserID), time.Now().UTC().Format("2006-01-02"))
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", fname))
		w.Header().Set("Cache-Control", "private, no-store")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(out); err != nil {
			slog.Error("backup export write failed", "err", err)
		}
	}
}

func importBackupHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}

		mode := services.ImportMode(strings.TrimSpace(r.URL.Query().Get("mode")))
		if mode == "" {
			mode = services.ImportMerge
		}
		if mode != services.ImportMerge && mode != services.ImportReplace {
			badInput(w, nil, "Mode không hợp lệ")
			return
		}

		// Cap the body size; the limit-reader returns an error on overflow
		// that we turn into a clear 413-style 400.
		r.Body = http.MaxBytesReader(w, r.Body, maxImportBodyBytes)
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			// MaxBytesReader sets a typed error; surface as a friendly Vietnamese msg.
			var mberr *http.MaxBytesError
			if errors.As(err, &mberr) {
				httpx.WriteError(w, http.StatusRequestEntityTooLarge, "bad_input",
					"File backup quá lớn (giới hạn 50MB)", nil)
				return
			}
			badInput(w, nil, "Không đọc được nội dung file")
			return
		}

		var payload services.BackupExport
		dec := json.NewDecoder(strings.NewReader(string(raw)))
		// Allow unknown fields — older / future versions might carry extras.
		if err := dec.Decode(&payload); err != nil {
			badInput(w, nil, "File JSON không hợp lệ")
			return
		}

		result, err := services.ImportBackup(r.Context(), deps.DB, us.UserID, &payload, mode)
		if err != nil {
			var svc *services.Error
			if errors.As(err, &svc) {
				httpx.WriteError(w, svc.HTTPStatus(), strings.ToLower(svc.Code), svc.Message, svc.FieldErrors)
				return
			}
			slog.Error("backup import failed", "err", err, "userId", us.UserID)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":     true,
			"result": result,
		})
	}
}

// safeFilenameSegment strips anything outside [A-Za-z0-9_-] from s so it's
// safe to drop straight into a Content-Disposition filename without quoting
// games. Keeps the user id readable for ops debugging.
func safeFilenameSegment(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '-' || r == '_':
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "user"
	}
	return b.String()
}
