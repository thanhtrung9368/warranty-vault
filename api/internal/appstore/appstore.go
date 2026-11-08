// Package appstore verifies the signed transactions StoreKit 2 hands to the
// app. The app cannot be trusted to assert "I paid": the JWS is the only thing
// the server can check, and it is checked here before any entitlement is
// written.
//
// StoreKit 2 signs a transaction with ES256. The token header carries the
// certificate chain in `x5c`; the leaf signs the payload, and the chain must
// terminate at Apple Root CA - G3 (embedded next to this file, fetched from
// https://www.apple.com/certificateauthority/AppleRootCA-G3.cer on 2026-11-08,
// SHA-256 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79).
//
// This deliberately does not call the App Store Server API. That would add a
// second credential (an App Store Server API key) and a network dependency to
// every purchase; the signed transaction is already the authoritative answer
// for "is this subscription active right now". Server Notifications V2, which
// handle renewals/refunds while the app is closed, are a later addition (see
// docs/SPEC-PREMIUM.md).
package appstore

import (
	"crypto/x509"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

//go:embed apple_root_ca_g3.pem
var appleRootPEM []byte

var (
	rootsOnce sync.Once
	roots     *x509.CertPool
	rootsErr  error
)

func appleRoots() (*x509.CertPool, error) {
	rootsOnce.Do(func() {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(appleRootPEM) {
			rootsErr = errors.New("appstore: embedded Apple Root CA is not a PEM certificate")
			return
		}
		roots = pool
	})
	return roots, rootsErr
}

// Transaction is the subset of Apple's signed transaction payload the service
// needs. The raw payload is not stored: these fields are enough to decide
// entitlement and to keep an audit trail.
type Transaction struct {
	BundleID              string
	ProductID             string
	Type                  string
	TransactionID         string
	OriginalTransactionID string
	Environment           string
	PurchaseDate          time.Time
	ExpiresAt             time.Time
	RevokedAt             *time.Time
}

// Verify checks the JWS signature and certificate chain, then decodes the
// transaction fields. It does not decide whether the product is one Warrly
// sells; that is the caller's allowlist.
func Verify(jws string) (Transaction, error) {
	var tx Transaction

	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"ES256"}),
		// Apple's transaction payload is not a JWT: it has no iss/aud/exp
		// registered claims. Those are checked here, on the fields Apple does
		// send.
		jwt.WithoutClaimsValidation(),
	)
	claims := jwt.MapClaims{}
	token, err := parser.ParseWithClaims(jws, claims, keyFunc)
	if err != nil {
		return tx, fmt.Errorf("verify jws: %w", err)
	}
	if !token.Valid {
		return tx, errors.New("appstore: token is not valid")
	}

	tx.BundleID = stringClaim(claims, "bundleId")
	tx.ProductID = stringClaim(claims, "productId")
	tx.Type = stringClaim(claims, "type")
	tx.TransactionID = stringClaim(claims, "transactionId")
	tx.OriginalTransactionID = stringClaim(claims, "originalTransactionId")
	tx.Environment = stringClaim(claims, "environment")

	if tx.BundleID == "" || tx.ProductID == "" || tx.TransactionID == "" ||
		tx.OriginalTransactionID == "" || tx.Environment == "" {
		return tx, errors.New("appstore: transaction is missing required fields")
	}
	if tx.Type != "Auto-Renewable Subscription" {
		return tx, fmt.Errorf("appstore: unsupported transaction type %q", tx.Type)
	}

	expires, ok := millisClaim(claims, "expiresDate")
	if !ok {
		return tx, errors.New("appstore: auto-renewable transaction has no expiresDate")
	}
	tx.ExpiresAt = expires

	if purchase, ok := millisClaim(claims, "purchaseDate"); ok {
		tx.PurchaseDate = purchase
	}
	if revoked, ok := millisClaim(claims, "revocationDate"); ok {
		tx.RevokedAt = &revoked
	}
	return tx, nil
}

// keyFunc verifies the x5c chain against the embedded Apple root and returns
// the leaf key the JWT parser uses for the ES256 signature.
func keyFunc(token *jwt.Token) (any, error) {
	raw, ok := token.Header["x5c"]
	if !ok {
		return nil, errors.New("appstore: jws has no x5c header")
	}
	encoded, err := x5cStrings(raw)
	if err != nil {
		return nil, err
	}
	if len(encoded) == 0 {
		return nil, errors.New("appstore: jws has an empty x5c chain")
	}

	certs := make([]*x509.Certificate, 0, len(encoded))
	for _, s := range encoded {
		der, err := base64.StdEncoding.DecodeString(s)
		if err != nil {
			return nil, fmt.Errorf("appstore: decode x5c certificate: %w", err)
		}
		cert, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, fmt.Errorf("appstore: parse x5c certificate: %w", err)
		}
		certs = append(certs, cert)
	}

	roots, err := appleRoots()
	if err != nil {
		return nil, err
	}
	intermediates := x509.NewCertPool()
	for _, cert := range certs[1:] {
		intermediates.AddCert(cert)
	}
	if _, err := certs[0].Verify(x509.VerifyOptions{
		Roots:         roots,
		Intermediates: intermediates,
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	}); err != nil {
		return nil, fmt.Errorf("appstore: x5c chain does not reach Apple Root CA - G3: %w", err)
	}
	return certs[0].PublicKey, nil
}

// x5cStrings accepts the two shapes encoding/json can produce for the header:
// []any (the normal case) and []string (tests, or a future decoder).
func x5cStrings(raw any) ([]string, error) {
	switch v := raw.(type) {
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			s, ok := item.(string)
			if !ok {
				return nil, errors.New("appstore: x5c contains a non-string certificate")
			}
			out = append(out, s)
		}
		return out, nil
	case []string:
		return v, nil
	default:
		return nil, fmt.Errorf("appstore: unexpected x5c header type %T", raw)
	}
}

func stringClaim(claims jwt.MapClaims, key string) string {
	v, ok := claims[key]
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

// millisClaim reads Apple's epoch-millisecond fields. JSON numbers arrive as
// float64; a string is accepted too because the payload is sometimes decoded
// through a looser path. Returns false when the key is absent or unusable.
func millisClaim(claims jwt.MapClaims, key string) (time.Time, bool) {
	v, ok := claims[key]
	if !ok {
		return time.Time{}, false
	}
	var ms float64
	switch n := v.(type) {
	case float64:
		ms = n
	case json.Number:
		f, err := n.Float64()
		if err != nil {
			return time.Time{}, false
		}
		ms = f
	case string:
		f, err := strconv.ParseFloat(n, 64)
		if err != nil {
			return time.Time{}, false
		}
		ms = f
	default:
		return time.Time{}, false
	}
	if ms <= 0 {
		return time.Time{}, false
	}
	return time.UnixMilli(int64(ms)).UTC(), true
}
