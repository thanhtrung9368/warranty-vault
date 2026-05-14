package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

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

	handlers.RegisterDevices(mux, deps)
	handlers.RegisterWarranties(mux, deps)
	handlers.RegisterReminders(mux, deps)
	handlers.RegisterAttachments(mux, deps)
	handlers.RegisterSubscriptions(mux, deps)
	handlers.RegisterWishlist(mux, deps)
	handlers.RegisterCatalog(mux, deps)
	handlers.RegisterStats(mux, deps)
	handlers.RegisterPush(mux, deps)
	mux.HandleFunc("POST /api/v1/push/test", handlers.TestPush(deps))
	handlers.RegisterCron(mux, deps)
	handlers.RegisterBackup(mux, deps)

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
