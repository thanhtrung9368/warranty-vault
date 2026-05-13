package auth

import "golang.org/x/crypto/bcrypt"

// BcryptCost matches the web client's BCRYPT_ROUNDS = 12. Hashes produced
// by bcrypt-ts and golang.org/x/crypto/bcrypt are interoperable.
const BcryptCost = 12

func Hash(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), BcryptCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func Verify(plain, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}
