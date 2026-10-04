package files

// Cross-language (TS ↔ Go) interop tests for the encrypted-attachment scheme.
//
// Scheme reference (must stay byte-for-byte identical on both sides):
//
//   - AES-256-GCM, 12-byte random IV, 16-byte auth tag SUFFIXED to ciphertext.
//   - Per-file random 32-byte dataKey is wrapped with FILE_MASTER_KEY (also
//     AES-256-GCM, with its own random wrapIV).
//   - Persisted wrappedKey blob layout = wrapIV(12) || gcm(dataKey, master)(48)
//     i.e. always exactly 12 + 32 + 16 = 60 bytes.
//   - Persisted ciphertext blob layout = ciphertext || tag(16).
//     Go's crypto/cipher gcm.Seal produces this layout natively; the Node
//     side (website/src/lib/files.ts) concats(update,final,getAuthTag) to
//     match.
//
// Known differences between sides (none impacting wire format):
//   - Go uses crypto/cipher.gcm.Seal which fuses ciphertext+tag in one call;
//     Node uses cipher.update + cipher.final + getAuthTag and concats. Output
//     is identical.
//   - Both sides treat FILE_MASTER_KEY length as: decode base64 first; if <32
//     bytes, fall back to hex; truncate to first 32 bytes once decoded ≥32.
//
// Test suite covers (Block 3.1 in NEXT.md):
//
//   - TestInteropTSFixture          — hard-coded base64 fixture from Node was
//                                     captured once with `node -e ...` (see
//                                     comment block above the fixture vars).
//                                     Go must decrypt it to the known plaintext.
//   - TestInteropGoEncryptDump      — Go encrypts a plaintext, dumps the
//                                     bundle (JSON, b64) to a temp file so a
//                                     human can run
//                                     `cat ... | node testdata/decrypt.mjs`
//                                     and verify reverse direction. Self-checks
//                                     Go round-trip too.
//   - TestInteropIVTooShort         — IV != 12 bytes must error.
//   - TestInteropWrappedKeyTooShort — wrappedKey shorter than wrapIV+tag errors.
//   - TestInteropTamperedCiphertext — single-byte flip in ciphertext → GCM
//                                     auth fail.
//   - TestInteropWrongMasterKey     — different master key → unwrap fails.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// ─────────────────────────────────────────────────────────────────────────────
// Hard-coded TS fixture.
//
// Captured once with:
//
//   node -e '
//     const { createCipheriv, randomBytes } = require("node:crypto");
//     const master = Buffer.alloc(32, 0x5A);
//     const plain = Buffer.from("WarrantyVault interop fixture v1 — Tiếng Việt: bảo hành 12 tháng. \n", "utf8");
//     function gcm(p, k){ const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", k, iv); const enc = Buffer.concat([c.update(p), c.final()]); return { iv, ct: Buffer.concat([enc, c.getAuthTag()]) }; }
//     const dataKey = randomBytes(32);
//     const blob = gcm(plain, dataKey);
//     const wrap = gcm(dataKey, master);
//     const wrappedKey = Buffer.concat([wrap.iv, wrap.ct]);
//     console.log(JSON.stringify({master_b64: master.toString("base64"), plain_b64: plain.toString("base64"), iv_b64: blob.iv.toString("base64"), ciphertext_b64: blob.ct.toString("base64"), wrappedKey_b64: wrappedKey.toString("base64")}, null, 2));
//   '
//
// Regenerate only when the on-wire scheme changes (it shouldn't — bump a schema
// version field on the Attachment row instead).
// ─────────────────────────────────────────────────────────────────────────────

const (
	tsFixtureMasterB64     = "WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo="
	tsFixturePlainB64      = "V2FycmFudHlWYXVsdCBpbnRlcm9wIGZpeHR1cmUgdjEg4oCUIFRp4bq/bmcgVmnhu4d0OiBi4bqjbyBow6BuaCAxMiB0aMOhbmcuIAo="
	tsFixtureIVB64         = "nhjqUlV5i0nu69Cf"
	tsFixtureCiphertextB64 = "w63G/rynSlVPPGlZFRl8aPIvpRD4wkOOL4ZDv0J3ynI1NtULDtuEFtep08fx4XKLf0qzOrNaw9kNOQ/vzNSR7giuGXx30me41dZiyIOtpk5WT/N1F6RaHi4yNpAZ"
	tsFixtureWrappedKeyB64 = "hwF99lB1U1jg2AhXYpVw7Um+QQkkRrXrve8LGQjBxbg1+ucCvplOCb8ds6dEZe7d2BsWY99+vCjmrdZE"
)

func mustB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	return b
}

// TestInteropTSFixture is the load-bearing test for this block: a payload
// produced once by the canonical Node implementation must decrypt cleanly in
// Go to the exact plaintext bytes.
func TestInteropTSFixture(t *testing.T) {
	master := mustB64(t, tsFixtureMasterB64)
	wantPlain := mustB64(t, tsFixturePlainB64)
	iv := mustB64(t, tsFixtureIVB64)
	ct := mustB64(t, tsFixtureCiphertextB64)
	wk := mustB64(t, tsFixtureWrappedKeyB64)

	// Sanity-check the on-wire shapes match scheme constants.
	if got, want := len(iv), 12; got != want {
		t.Fatalf("fixture iv len = %d, want %d", got, want)
	}
	if got, want := len(wk), 12+32+16; got != want {
		t.Fatalf("fixture wrappedKey len = %d, want %d", got, want)
	}
	if got, want := len(ct), len(wantPlain)+16; got != want {
		t.Fatalf("fixture ciphertext len = %d, want plain+tag = %d", got, want)
	}

	mk, err := NewMasterKey(master)
	if err != nil {
		t.Fatalf("NewMasterKey: %v", err)
	}
	gotPlain, err := Decrypt(ct, iv, wk, mk)
	if err != nil {
		t.Fatalf("Go decrypt of TS fixture: %v", err)
	}
	if !bytes.Equal(gotPlain, wantPlain) {
		t.Fatalf("plaintext mismatch.\n got: %q\nwant: %q", gotPlain, wantPlain)
	}
}

// TestInteropGoEncryptDump exercises the reverse direction. It:
//
//  1. Encrypts a plaintext with a deterministic master via the Go encoder.
//
//  2. Self-decrypts to confirm the in-process round-trip works (sanity).
//
//  3. Writes a JSON bundle to t.TempDir() and t.Logf's the absolute path so a
//     human can manually run:
//
//     cat <path> | node api/internal/files/testdata/decrypt.mjs
//
//     …and confirm TS recovers the exact plaintext. We do NOT shell out to
//     node here so `go test` stays self-contained; the inline Node-encrypt
//     interop already lives in encrypt_test.go::TestInteropWithNodeEncryption.
func TestInteropGoEncryptDump(t *testing.T) {
	// Reset the cached master in case other tests in this package mutated it.
	resetMasterKeyForTest()

	masterBytes := bytes.Repeat([]byte{0xA7}, 32)
	mk, err := NewMasterKey(masterBytes)
	if err != nil {
		t.Fatal(err)
	}
	plain := []byte("Go→TS interop. Tiếng Việt: thiết bị, bảo hành, hoá đơn. \x00\x01\xff")

	res, err := Encrypt(plain, mk)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	// Sanity round-trip in Go.
	back, err := Decrypt(res.Ciphertext, res.IV, res.WrappedKey, mk)
	if err != nil {
		t.Fatalf("Go round-trip decrypt: %v", err)
	}
	if !bytes.Equal(back, plain) {
		t.Fatalf("Go round-trip plaintext mismatch")
	}

	bundle := map[string]string{
		"master_b64":     base64.StdEncoding.EncodeToString(masterBytes),
		"iv_b64":         base64.StdEncoding.EncodeToString(res.IV),
		"wrappedKey_b64": base64.StdEncoding.EncodeToString(res.WrappedKey),
		"ciphertext_b64": base64.StdEncoding.EncodeToString(res.Ciphertext),
		"plain_b64":      base64.StdEncoding.EncodeToString(plain),
	}
	out, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(t.TempDir(), "go-encrypt-bundle.json")
	if err := os.WriteFile(dst, out, 0o600); err != nil {
		t.Fatalf("write bundle: %v", err)
	}
	t.Logf("Go-encrypted bundle written: %s", dst)
	t.Logf("Verify TS-side decrypt manually with:")
	t.Logf("  cat %s | node internal/files/testdata/decrypt.mjs", dst)
}

// TestInteropIVTooShort confirms the decoder rejects under-length IVs with a
// clear error rather than mis-decoding.
func TestInteropIVTooShort(t *testing.T) {
	mk, err := NewMasterKey(bytes.Repeat([]byte{0x11}, 32))
	if err != nil {
		t.Fatal(err)
	}
	res, err := Encrypt([]byte("payload"), mk)
	if err != nil {
		t.Fatal(err)
	}
	shortIV := res.IV[:8]
	if _, err := Decrypt(res.Ciphertext, shortIV, res.WrappedKey, mk); err == nil {
		t.Error("expected error for 8-byte IV, got nil")
	}
	// Zero-length too.
	if _, err := Decrypt(res.Ciphertext, nil, res.WrappedKey, mk); err == nil {
		t.Error("expected error for nil IV, got nil")
	}
	// 13-byte (over by 1) must also fail since the GCM standard nonce is fixed.
	longIV := append(append([]byte(nil), res.IV...), 0x00)
	if _, err := Decrypt(res.Ciphertext, longIV, res.WrappedKey, mk); err == nil {
		t.Error("expected error for 13-byte IV, got nil")
	}
}

// TestInteropWrappedKeyTooShort confirms a malformed wrappedKey (shorter than
// wrapIV+tag = 28 bytes) is rejected before we attempt the GCM open.
func TestInteropWrappedKeyTooShort(t *testing.T) {
	mk, err := NewMasterKey(bytes.Repeat([]byte{0x22}, 32))
	if err != nil {
		t.Fatal(err)
	}
	res, err := Encrypt([]byte("payload"), mk)
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range []int{0, 11, 12, 27} {
		if _, err := Decrypt(res.Ciphertext, res.IV, res.WrappedKey[:n], mk); err == nil {
			t.Errorf("expected error for wrappedKey[:%d], got nil", n)
		}
	}
	// 28-byte wrappedKey passes the length check but won't authenticate
	// (it's not a valid GCM-sealed dataKey). Must still surface an error.
	if _, err := Decrypt(res.Ciphertext, res.IV, res.WrappedKey[:28], mk); err == nil {
		t.Error("expected unwrap auth failure for truncated wrappedKey, got nil")
	}
}

// TestInteropTamperedCiphertext: flipping a single bit anywhere in the
// ciphertext|tag region must cause GCM authentication to fail rather than
// returning corrupt plaintext.
func TestInteropTamperedCiphertext(t *testing.T) {
	mk, err := NewMasterKey(bytes.Repeat([]byte{0x33}, 32))
	if err != nil {
		t.Fatal(err)
	}
	res, err := Encrypt([]byte("the quick brown fox jumps over the lazy dog"), mk)
	if err != nil {
		t.Fatal(err)
	}
	// Flip in the body.
	body := append([]byte(nil), res.Ciphertext...)
	body[3] ^= 0x80
	if _, err := Decrypt(body, res.IV, res.WrappedKey, mk); err == nil {
		t.Error("expected GCM auth failure for body tamper")
	}
	// Flip in the tag (last 16 bytes).
	tag := append([]byte(nil), res.Ciphertext...)
	tag[len(tag)-1] ^= 0x01
	if _, err := Decrypt(tag, res.IV, res.WrappedKey, mk); err == nil {
		t.Error("expected GCM auth failure for tag tamper")
	}
}

// TestInteropWrongMasterKey: a different (well-formed) master key must fail
// to unwrap the dataKey. Distinct error path from blob tamper since failure
// happens during the unwrap step, not the blob decrypt.
func TestInteropWrongMasterKey(t *testing.T) {
	right, err := NewMasterKey(bytes.Repeat([]byte{0x44}, 32))
	if err != nil {
		t.Fatal(err)
	}
	res, err := Encrypt([]byte("secret"), right)
	if err != nil {
		t.Fatal(err)
	}
	wrong, err := NewMasterKey(bytes.Repeat([]byte{0x45}, 32))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Decrypt(res.Ciphertext, res.IV, res.WrappedKey, wrong); err == nil {
		t.Error("expected unwrap failure with mismatched master key, got nil")
	}
}
