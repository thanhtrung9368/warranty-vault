-- TODO: Run `sqlc generate` after migrations are applied.

-- name: HealthCheck :one
SELECT 1 AS ok;
