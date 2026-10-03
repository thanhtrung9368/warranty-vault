package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	"github.com/thanhtrung9368/warranty-vault/api/internal/config"
	"github.com/thanhtrung9368/warranty-vault/api/internal/email"
	"github.com/thanhtrung9368/warranty-vault/api/internal/handlers"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/push"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	// -healthcheck: chạy đúng một lần rồi thoát, KHÔNG khởi động server.
	// Image cuối là distroless (không shell, không curl/wget) nên Docker
	// HEALTHCHECK phải gọi thẳng binary này — xem docker-compose.yml.
	healthcheck := flag.Bool("healthcheck", false, "gọi GET /readyz một lần rồi thoát (0 = khỏe, 1 = lỗi)")
	healthcheckURL := flag.String("healthcheck-url", "", "URL đầy đủ cho -healthcheck (mặc định http://127.0.0.1:$PORT/readyz)")
	flag.Parse()

	if *healthcheck {
		os.Exit(runHealthcheck(*healthcheckURL))
	}

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load failed", "err", err)
		os.Exit(1)
	}

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	poolCtx, cancel := context.WithTimeout(rootCtx, 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(poolCtx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("db pool init failed", "err", err)
		os.Exit(1) //nolint:gocritic // process is exiting; deferred cancel is moot
	}
	defer pool.Close()

	deps := handlers.Deps{
		DB:         pool,
		Limiter:    ratelimit.NewFromEnv(),
		Email:      email.NewFromEnv(),
		Dispatcher: push.NewFromEnv(),
		AI:         ai.NewFromEnv(),
	}

	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/v1/auth/register", handlers.Register(deps))
	mux.HandleFunc("POST /api/v1/auth/login", handlers.Login(deps))
	mux.HandleFunc("POST /api/v1/auth/logout", handlers.Logout(deps))
	mux.HandleFunc("GET /api/v1/auth/me", handlers.Me(deps))
	mux.HandleFunc("DELETE /api/v1/auth/me", handlers.DeleteMe(deps))
	mux.HandleFunc("POST /api/v1/auth/forgot", handlers.Forgot(deps))
	mux.HandleFunc("POST /api/v1/auth/reset-password", handlers.ResetPassword(deps))
	mux.HandleFunc("POST /api/v1/auth/change-password", handlers.ChangePassword(deps))
	mux.HandleFunc("POST /api/v1/auth/change-email", handlers.RequestEmailChange(deps))
	mux.HandleFunc("POST /api/v1/auth/confirm-email-change", handlers.ConfirmEmailChange(deps))
	handlers.RegisterProfile(mux, deps)
	handlers.RegisterSessions(mux, deps)

	handlers.RegisterDevices(mux, deps)
	handlers.RegisterWarranties(mux, deps)
	handlers.RegisterReminders(mux, deps)
	handlers.RegisterAttachments(mux, deps)
	handlers.RegisterSubscriptions(mux, deps)
	handlers.RegisterWishlist(mux, deps)
	handlers.RegisterCatalog(mux, deps)
	handlers.RegisterSearch(mux, deps)
	handlers.RegisterStats(mux, deps)
	handlers.RegisterForecast(mux, deps)
	handlers.RegisterPush(mux, deps)
	mux.HandleFunc("POST /api/v1/push/test", handlers.TestPush(deps))
	handlers.RegisterCron(mux, deps)
	handlers.RegisterBackup(mux, deps)
	handlers.RegisterAI(mux, deps)

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			slog.Warn("readyz db ping failed", "err", err)
			httpx.WriteError(w, http.StatusServiceUnavailable, "db_unavailable", "database not reachable", nil)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	handler := httpx.RequestID(httpx.Logging(httpx.Recover(mux)))

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		slog.Info("server starting", "addr", ":"+cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		slog.Error("server error", "err", err)
		os.Exit(1)
	case <-rootCtx.Done():
		slog.Info("shutdown signal received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "err", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}

// healthcheckTimeout bounds one /readyz probe. Deliberately shorter than the
// healthcheck `timeout` in docker-compose.yml (5s) so the probe reports its own
// failure instead of being SIGKILLed by Docker (exit 137) first.
const healthcheckTimeout = 4 * time.Second

// runHealthcheck probes the readiness endpoint of the server running in this
// same container and returns the process exit code for Docker: 0 = healthy,
// 1 = unhealthy (exit code 2 is reserved by Docker). Success is silent so the
// container log does not grow by one line every interval.
func runHealthcheck(url string) int {
	if strings.TrimSpace(url) == "" {
		url = readyzURL(os.Getenv("PORT"))
	}

	ctx, cancel := context.WithTimeout(context.Background(), healthcheckTimeout)
	defer cancel()
	// Timeout on the client as well: it covers dial + body read even if the
	// context is cancelled later than expected.
	client := &http.Client{Timeout: healthcheckTimeout}

	if err := probeReadyz(ctx, client, url); err != nil {
		slog.Error("healthcheck failed", "url", url, "err", err)
		return 1
	}
	return 0
}

// readyzURL builds the default probe target from PORT, mirroring the "4000"
// fallback in config.Load so probe and server always agree on the port.
func readyzURL(port string) string {
	port = strings.TrimSpace(port)
	if port == "" {
		port = "4000"
	}
	return "http://127.0.0.1:" + port + "/readyz"
}

// probeReadyz performs GET <url> and returns nil only on HTTP 200. /readyz is
// the right target (not /healthz) because it pings the DB, so a container is
// reported healthy only when the API can actually serve reads/writes.
func probeReadyz(ctx context.Context, client *http.Client, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	// Drain the (tiny) body so the connection can be closed cleanly.
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: HTTP %d", resp.StatusCode)
	}
	return nil
}
