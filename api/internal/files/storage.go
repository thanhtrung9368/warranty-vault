package files

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// On-disk layout matches the TS implementation in
// website/src/lib/files.ts:
//
//	<PRIVATE_UPLOAD_ROOT>/<deviceId>/<uuid>.enc
//
// We deliberately do NOT include userID in the path: the existing files
// already living in private-uploads/ from the Node service don't have it,
// and this Go code must read those legacy blobs as-is.

var safeSegmentRE = regexp.MustCompile(`^[a-zA-Z0-9_.-]+$`)

// PrivateUploadRoot resolves the on-disk root for encrypted blobs. Reads
// PRIVATE_UPLOAD_ROOT, falls back to "./private-uploads" relative to cwd
// (matching the TS default).
func PrivateUploadRoot() string {
	v := strings.TrimSpace(os.Getenv("PRIVATE_UPLOAD_ROOT"))
	if v == "" {
		v = "private-uploads"
	}
	abs, err := filepath.Abs(v)
	if err != nil {
		return v
	}
	return abs
}

// SafeSegment reports whether s is safe to use as a single path segment
// inside the private upload tree. Mirrors the TS regex.
func SafeSegment(s string) bool {
	return safeSegmentRE.MatchString(s)
}

// ResolveSafe joins root with rel and returns the absolute path, after
// asserting it remains underneath root.
func ResolveSafe(root, rel string) (string, error) {
	if root == "" {
		return "", errors.New("upload root not set")
	}
	abs := filepath.Join(root, rel)
	absClean, err := filepath.Abs(abs)
	if err != nil {
		return "", err
	}
	rootClean, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	if absClean != rootClean &&
		!strings.HasPrefix(absClean, rootClean+string(filepath.Separator)) {
		return "", errors.New("path escape detected")
	}
	return absClean, nil
}

// WriteEncrypted writes ciphertext under <root>/<deviceID>/<fileBase>, where
// fileBase is the bare filename (e.g. "<uuid>.enc"). Creates parent dirs as
// needed. Returns the storagePath relative to root for persistence.
func WriteEncrypted(root, deviceID, fileBase string, ciphertext []byte) (string, error) {
	if !SafeSegment(deviceID) {
		return "", errors.New("invalid deviceId segment")
	}
	if !SafeSegment(fileBase) {
		return "", errors.New("invalid filename segment")
	}
	rel := filepath.Join(deviceID, fileBase)
	abs, err := ResolveSafe(root, rel)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o750); err != nil {
		return "", err
	}
	if err := os.WriteFile(abs, ciphertext, 0o640); err != nil {
		return "", err
	}
	return rel, nil
}

// ReadEncrypted reads the ciphertext blob at <root>/<storagePath>.
func ReadEncrypted(root, storagePath string) ([]byte, error) {
	abs, err := ResolveSafe(root, storagePath)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(abs)
}

// DeleteEncrypted best-effort removes <root>/<storagePath>. A missing file
// is not an error.
func DeleteEncrypted(root, storagePath string) error {
	abs, err := ResolveSafe(root, storagePath)
	if err != nil {
		return err
	}
	if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
