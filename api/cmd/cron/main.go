// Command cron runs one warranty-check pass and exits.
//
// Designed for systemd timer / k8s CronJob / cloud scheduler. The HTTP
// endpoint POST /api/v1/cron/warranty-check shares the same internal/cron.Run
// logic for callers that prefer to hit the live server (Vercel Cron etc).
//
// Usage:
//
//	go run ./cmd/cron       # one-shot
//	./cron                  # built binary
//
// Exit codes:
//
//	0 — pass completed (some pushes may have failed; see logs)
//	1 — config / DB / unrecoverable error
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/config"
	"github.com/thanhtrung9368/warranty-vault/api/internal/cron"
	"github.com/thanhtrung9368/warranty-vault/api/internal/push"
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

	dispatcher := push.NewFromEnv()

	runCtx, runCancel := context.WithTimeout(rootCtx, 5*time.Minute)
	defer runCancel()

	started := time.Now()
	stats, err := cron.Run(runCtx, pool, dispatcher)
	if err != nil {
		slog.Error("cron run failed",
			"err", err,
			"duration_ms", time.Since(started).Milliseconds(),
			"warranty_notices", stats.WarrantyNotices,
			"wishlist_target", stats.WishlistTargetHits,
			"wishlist_checkin", stats.WishlistCheckins,
			"sub_renewals", stats.SubscriptionRenewals,
			"sub_expired", stats.SubscriptionExpired,
			"sessions_pruned", stats.SessionsPruned,
			"pushes_sent", stats.PushesSent,
			"pushes_failed", stats.PushesFailed,
			"pushes_gone", stats.PushesGone,
		)
		os.Exit(1)
	}

	slog.Info("cron run complete",
		"duration_ms", time.Since(started).Milliseconds(),
		"warranty_notices", stats.WarrantyNotices,
		"wishlist_target", stats.WishlistTargetHits,
		"wishlist_checkin", stats.WishlistCheckins,
		"sub_renewals", stats.SubscriptionRenewals,
		"sub_expired", stats.SubscriptionExpired,
		"sessions_pruned", stats.SessionsPruned,
		"pushes_sent", stats.PushesSent,
		"pushes_failed", stats.PushesFailed,
		"pushes_gone", stats.PushesGone,
	)
}
