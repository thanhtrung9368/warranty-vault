// Package files implements the AES-256-GCM encrypted attachment storage
// scheme used by WarrantyVault. The on-disk + on-row layout matches the TS
// implementation in website/src/lib/files.ts byte-for-byte so a Go service
// and the legacy Node service can decrypt each other's writes.
//
// Layout
//
//	ON DISK    <PRIVATE_UPLOAD_ROOT>/<deviceId>/<uuid>.enc
//	             ciphertext = AES-256-GCM(plaintext, dataKey, iv)
//	             with the 16-byte GCM tag APPENDED to the ciphertext
//	             (Go's crypto/cipher.gcm.Seal already does this).
//
//	ON ROW     iv          12 bytes        (per-file random nonce for blob)
//	           wrappedKey  12 + 32 + 16    wrapIV(12) || wrapped dataKey ciphertext+tag
//
//	wrappedKey = wrapIV || AES-256-GCM(dataKey, masterKey, wrapIV) {tag suffixed}
//
// Disk alone or DB alone can't decrypt — both are needed.
package files

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
)

const (
	keyLen = 32 // AES-256 = 32 bytes
	ivLen  = 12 // GCM standard nonce length
	tagLen = 16 // GCM auth tag length
)

// MasterKey is the wrapping key used to encrypt/decrypt per-file data keys.
// Construct with LoadMasterKey() (env-driven) or NewMasterKey(raw32).
type MasterKey struct {
	bytes []byte
}

// Bytes returns the underlying 32-byte master key. Treat as secret.
func (m MasterKey) Bytes() []byte {
	out := make([]byte, len(m.bytes))
	copy(out, m.bytes)
	return out
}

// IsZero reports whether the key has been initialised.
func (m MasterKey) IsZero() bool { return len(m.bytes) == 0 }

var (
	cachedMasterKeyMu sync.Mutex
	cachedMasterKey   MasterKey
)

// LoadMasterKey reads FILE_MASTER_KEY from the environment, accepting either
// base64 (preferred) or hex encoding. Mirrors the Node helper getMasterKey().
//
// The decoded byte length must be ≥ 32; only the first 32 bytes are used.
// The result is cached process-wide for cheap repeat access.
//
// i18n: both refusal messages are Vietnamese source text that also serve as i18n
// catalog keys (internal/i18n/catalog.go). They reach a user through the 500 the
// attachment pipeline returns, which renders them via services.filesText; an
// unconverted caller keeps sending err.Error() verbatim. See the note in mime.go.
func LoadMasterKey() (MasterKey, error) {
	cachedMasterKeyMu.Lock()
	defer cachedMasterKeyMu.Unlock()
	if !cachedMasterKey.IsZero() {
		return cachedMasterKey, nil
	}
	raw := strings.TrimSpace(os.Getenv("FILE_MASTER_KEY"))
	if raw == "" {
		return MasterKey{}, errors.New("FILE_MASTER_KEY chưa được cấu hình")
	}
	mk, err := parseMasterKey(raw)
	if err != nil {
		return MasterKey{}, err
	}
	cachedMasterKey = mk
	return mk, nil
}

// NewMasterKey constructs a MasterKey from raw 32-byte material. Useful in
// tests where you don't want to touch env.
func NewMasterKey(raw []byte) (MasterKey, error) {
	if len(raw) < keyLen {
		return MasterKey{}, fmt.Errorf("master key must be ≥ %d bytes (got %d)", keyLen, len(raw))
	}
	cp := make([]byte, keyLen)
	copy(cp, raw[:keyLen])
	return MasterKey{bytes: cp}, nil
}

// resetMasterKeyForTest is exposed via a package-private function used by
// _test.go files in the same package.
func resetMasterKeyForTest() {
	cachedMasterKeyMu.Lock()
	defer cachedMasterKeyMu.Unlock()
	cachedMasterKey = MasterKey{}
}

// parseMasterKey accepts base64 or hex input; falls back to hex when base64
// yields fewer than 32 bytes (matching the TS preference order).
func parseMasterKey(raw string) (MasterKey, error) {
	// Try base64 (standard encoding) first. The TS code uses Buffer.from(raw, 'base64')
	// which is permissive about padding, so try Std then RawStd.
	if buf, err := base64.StdEncoding.DecodeString(raw); err == nil && len(buf) >= keyLen {
		return MasterKey{bytes: buf[:keyLen]}, nil
	}
	if buf, err := base64.RawStdEncoding.DecodeString(raw); err == nil && len(buf) >= keyLen {
		return MasterKey{bytes: buf[:keyLen]}, nil
	}
	// Fall back to hex.
	if buf, err := hex.DecodeString(raw); err == nil && len(buf) >= keyLen {
		return MasterKey{bytes: buf[:keyLen]}, nil
	}
	return MasterKey{}, errors.New("FILE_MASTER_KEY phải decode được (base64 hoặc hex) thành ≥ 32 byte")
}

// EncryptResult holds the values that must be persisted to recover the
// plaintext later: the ciphertext (with appended tag), the per-file nonce,
// and the wrappedKey opaque blob.
type EncryptResult struct {
	// Ciphertext is the encrypted file blob. The trailing 16 bytes are the
	// GCM auth tag — i.e. layout: ciphertext || tag(16). Matches the
	// Node helper which concats cipher.update()+cipher.final()+getAuthTag().
	Ciphertext []byte
	// IV is the random 12-byte nonce used to encrypt the blob. Persist on
	// the Attachment row.
	IV []byte
	// WrappedKey is the opaque blob persisted on the Attachment row:
	// layout = wrapIV(12) || ciphertext+tag(48).
	WrappedKey []byte
}

// Encrypt encrypts plain with a freshly generated 32-byte data key, wraps
// that data key with master, and returns the persistable values.
func Encrypt(plain []byte, master MasterKey) (EncryptResult, error) {
	if master.IsZero() {
		return EncryptResult{}, errors.New("master key not initialised")
	}
	dataKey := make([]byte, keyLen)
	if _, err := rand.Read(dataKey); err != nil {
		return EncryptResult{}, fmt.Errorf("rand: %w", err)
	}
	dataIV, ciphertext, err := gcmSeal(plain, dataKey)
	if err != nil {
		return EncryptResult{}, err
	}
	wrapIV, wrapped, err := gcmSeal(dataKey, master.bytes)
	if err != nil {
		return EncryptResult{}, err
	}
	wrappedKey := make([]byte, 0, len(wrapIV)+len(wrapped))
	wrappedKey = append(wrappedKey, wrapIV...)
	wrappedKey = append(wrappedKey, wrapped...)
	return EncryptResult{
		Ciphertext: ciphertext,
		IV:         dataIV,
		WrappedKey: wrappedKey,
	}, nil
}

// Decrypt unwraps the dataKey from wrappedKey using master, then decrypts
// ciphertext (which must include the 16-byte trailing tag) with the data key
// and supplied iv.
func Decrypt(ciphertext, iv, wrappedKey []byte, master MasterKey) ([]byte, error) {
	if master.IsZero() {
		return nil, errors.New("master key not initialised")
	}
	if len(iv) != ivLen {
		return nil, fmt.Errorf("iv must be %d bytes (got %d)", ivLen, len(iv))
	}
	if len(wrappedKey) < ivLen+tagLen {
		return nil, errors.New("wrappedKey malformed")
	}
	wrapIV := wrappedKey[:ivLen]
	wrappedCT := wrappedKey[ivLen:]
	dataKey, err := gcmOpen(wrappedCT, wrapIV, master.bytes)
	if err != nil {
		return nil, fmt.Errorf("unwrap data key: %w", err)
	}
	defer zeroBytes(dataKey)
	plain, err := gcmOpen(ciphertext, iv, dataKey)
	if err != nil {
		return nil, fmt.Errorf("decrypt blob: %w", err)
	}
	return plain, nil
}

// gcmSeal generates a fresh 12-byte random IV and returns iv, ciphertext+tag.
func gcmSeal(plain, key []byte) (iv, ciphertext []byte, err error) {
	if len(key) != keyLen {
		return nil, nil, fmt.Errorf("key must be %d bytes (got %d)", keyLen, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, fmt.Errorf("aes new: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, fmt.Errorf("gcm new: %w", err)
	}
	iv = make([]byte, ivLen)
	if _, err := rand.Read(iv); err != nil {
		return nil, nil, fmt.Errorf("rand iv: %w", err)
	}
	// Seal appends the 16-byte tag to the ciphertext, matching the Node
	// concat(update,final,getAuthTag) layout used by encryptGcm() in TS.
	ciphertext = gcm.Seal(nil, iv, plain, nil)
	return iv, ciphertext, nil
}

// gcmOpen splits the trailing 16-byte tag from ciphertext (Node-style layout)
// and returns the verified plaintext.
func gcmOpen(ciphertextWithTag, iv, key []byte) ([]byte, error) {
	if len(ciphertextWithTag) < tagLen {
		return nil, errors.New("ciphertext shorter than tag")
	}
	if len(iv) != ivLen {
		return nil, fmt.Errorf("iv must be %d bytes", ivLen)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("aes new: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm new: %w", err)
	}
	// crypto/cipher.gcm.Open expects ciphertext||tag, which is exactly the
	// layout we receive — no manual splitting needed.
	plain, err := gcm.Open(nil, iv, ciphertextWithTag, nil)
	if err != nil {
		return nil, fmt.Errorf("gcm open: %w", err)
	}
	return plain, nil
}

func zeroBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
