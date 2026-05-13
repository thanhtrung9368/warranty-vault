package validate

import (
	"sync"

	"github.com/go-playground/validator/v10"
)

var (
	once sync.Once
	v    *validator.Validate
)

// Validator returns a process-wide singleton validator instance.
// Custom rules and translations will be registered here in later phases.
func Validator() *validator.Validate {
	once.Do(func() {
		v = validator.New(validator.WithRequiredStructEnabled())
	})
	return v
}
