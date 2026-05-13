package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
)

// NewTokenAndHash generates a 32-byte random token and its sha256 hex digest.
// Format matches website/src/lib/api-auth.ts: base64url for the token,
// sha256-hex for the storage hash. Used for both bearer tokens and
// PasswordReset.tokenHash.
func NewTokenAndHash() (token, hash string, err error) {
	return newTokenAndHash()
}

func newTokenAndHash() (token, hash string, err error) {
	var b [32]byte
	if _, err = rand.Read(b[:]); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(b[:])
	hash = hashTokenString(token)
	return token, hash, nil
}

// hashFromBearer extracts the raw token from an Authorization header value
// and returns its sha256-hex digest. Returns "" if the header is malformed.
func hashFromBearer(authHeader string) string {
	raw := bearerToken(authHeader)
	if raw == "" {
		return ""
	}
	return hashTokenString(raw)
}

func hashTokenString(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	if header == "" {
		return ""
	}
	const prefix = "Bearer "
	if len(header) > len(prefix) && strings.EqualFold(header[:len(prefix)], prefix) {
		return strings.TrimSpace(header[len(prefix):])
	}
	return ""
}
