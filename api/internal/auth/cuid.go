package auth

import "github.com/lucsky/cuid"

// NewID returns a cuid-format id matching the format used by the existing
// Prisma-managed rows (e.g. "clx...").
func NewID() string {
	return cuid.New()
}
