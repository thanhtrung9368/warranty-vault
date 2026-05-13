package httpx

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type ErrorEnvelope struct {
	Error       string              `json:"error"`
	Message     string              `json:"message,omitempty"`
	FieldErrors map[string][]string `json:"fieldErrors,omitempty"`
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("write json failed", "err", err)
	}
}

func WriteError(w http.ResponseWriter, status int, code, message string, fieldErrors map[string][]string) {
	WriteJSON(w, status, ErrorEnvelope{
		Error:       code,
		Message:     message,
		FieldErrors: fieldErrors,
	})
}
