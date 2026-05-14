package auth

import "golang.org/x/crypto/bcrypt"

const BcryptCost = 12

// bcrypt-ts (used historically by the website) silently truncates passwords
// longer than 72 bytes; golang.org/x/crypto/bcrypt rejects them with
// ErrPasswordTooLong. Match the web behavior so users with long passwords
// keep working after the Go cutover.
func truncate72(plain string) []byte {
	b := []byte(plain)
	if len(b) > 72 {
		return b[:72]
	}
	return b
}

func Hash(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword(truncate72(plain), BcryptCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func Verify(plain, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), truncate72(plain)) == nil
}
