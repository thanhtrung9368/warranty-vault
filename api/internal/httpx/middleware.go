package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"
)

type ctxKey string

const requestIDKey ctxKey = "request_id"

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = newRequestID()
		}
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func RequestIDFrom(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDKey).(string); ok {
		return v
	}
	return ""
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += n
	return n, err
}

func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		slog.Info("http",
			"method", r.Method,
			"path", RedactPath(r.URL.Path),
			"status", rec.status,
			"bytes", rec.bytes,
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", RequestIDFrom(r.Context()),
			"remote", r.RemoteAddr,
		)
	})
}

// sharePathPrefix is the one route whose PATH SEGMENT is a credential
// (FEATURE_IDEAS #2). Everywhere else the bearer token travels in a header, which
// the logger never touches.
const sharePathPrefix = "/api/v1/public/shares/"

// RedactPath replaces a credential carried in the URL path with a fixed marker
// before the path is logged.
//
// Request logs are the longest-lived copy of a URL: they go to stdout, into
// journald / a log shipper, and often into a third-party aggregator, and they are
// read by people who have no business holding a live read capability. A share URL
// is a bearer credential in path form — anyone who can read the log line can open
// the certificate — so the token must never be written there. The replacement is
// positional (`.../{token}`) so the line still shows WHICH route was hit, which is
// all the log is for.
//
// A query string is not logged today (only r.URL.Path is); if that ever changes,
// it needs the same treatment.
func RedactPath(path string) string {
	if !strings.HasPrefix(path, sharePathPrefix) {
		return path
	}
	rest := path[len(sharePathPrefix):]
	if rest == "" {
		return path
	}
	return sharePathPrefix + "{token}"
}

func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic",
					"err", rec,
					"path", r.URL.Path,
					"request_id", RequestIDFrom(r.Context()),
					"stack", string(debug.Stack()),
				)
				WriteError(w, http.StatusInternalServerError, "internal_error", "internal server error", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func newRequestID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "0"
	}
	return hex.EncodeToString(b[:])
}
