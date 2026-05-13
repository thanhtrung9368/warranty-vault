package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/thanhtrung9368/warranty-vault/api/internal/config"
)

const migrationsDir = "migrations"

var allowedCommands = map[string]struct{}{
	"up":      {},
	"down":    {},
	"status":  {},
	"version": {},
	"redo":    {},
	"reset":   {},
}

// Destructive commands an AI agent must not run without explicit user approval
// (per CLAUDE.md). We let humans run them by setting WV_ALLOW_DESTRUCTIVE=1.
var destructiveCommands = map[string]struct{}{
	"reset": {},
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	flag.Usage = usage
	flag.Parse()
	args := flag.Args()
	if len(args) < 1 {
		usage()
		os.Exit(2)
	}

	cmd := strings.ToLower(args[0])
	if _, ok := allowedCommands[cmd]; !ok {
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", cmd)
		usage()
		os.Exit(2)
	}

	for _, a := range args {
		if strings.Contains(a, "--force-reset") || strings.EqualFold(a, "force-reset") {
			fmt.Fprintln(os.Stderr, "error: --force-reset is blocked. set WV_ALLOW_DESTRUCTIVE=1 and use a different goose command if you really mean it.")
			os.Exit(2)
		}
	}
	if _, dangerous := destructiveCommands[cmd]; dangerous && os.Getenv("WV_ALLOW_DESTRUCTIVE") != "1" {
		fmt.Fprintf(os.Stderr, "error: %q is destructive. re-run with WV_ALLOW_DESTRUCTIVE=1 if intended.\n", cmd)
		os.Exit(2)
	}

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load failed", "err", err)
		os.Exit(1)
	}

	db, err := sql.Open("pgx", cfg.DatabaseURL)
	if err != nil {
		slog.Error("db open failed", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		slog.Error("db ping failed", "err", err)
		os.Exit(1)
	}

	if err := goose.SetDialect("postgres"); err != nil {
		slog.Error("goose set dialect failed", "err", err)
		os.Exit(1)
	}

	dir, err := resolveMigrationsDir()
	if err != nil {
		slog.Error("resolve migrations dir failed", "err", err)
		os.Exit(1)
	}

	runCtx, runCancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer runCancel()

	if err := goose.RunContext(runCtx, cmd, db, dir, args[1:]...); err != nil {
		if errors.Is(err, goose.ErrNoCurrentVersion) {
			slog.Warn("no migrations applied yet")
		}
		slog.Error("goose command failed", "cmd", cmd, "err", err)
		os.Exit(1)
	}
	slog.Info("goose command ok", "cmd", cmd, "dir", dir)
}

func resolveMigrationsDir() (string, error) {
	candidates := []string{
		migrationsDir,
		filepath.Join("..", migrationsDir),
		filepath.Join("..", "..", migrationsDir),
	}
	for _, p := range candidates {
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			return p, nil
		}
	}
	return "", fmt.Errorf("migrations directory not found; expected one of %v", candidates)
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: migrate <up|down|status|version|redo|reset> [args...]")
	fmt.Fprintln(os.Stderr, "  reads DATABASE_URL from env (or .env file).")
	fmt.Fprintln(os.Stderr, "  destructive commands (reset) require WV_ALLOW_DESTRUCTIVE=1.")
}
