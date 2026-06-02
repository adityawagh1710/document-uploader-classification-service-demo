//go:build tools

// Package tools pins gqlgen as a build-time codegen dependency so `go mod tidy`
// keeps it. Not compiled into the service binary.
package tools

import _ "github.com/99designs/gqlgen"
