# pipeline-contracts: schema is the source of truth (schema/), the Go flavor is
# hand-written (go/), and codegen + a conformance gate keep them aligned.
#
#   make codegen   regenerate the Go reference package from the schema
#   make verify    codegen is up to date (no drift) + conformance tests pass
#   make test      just the Go tests (incl. schema conformance)

SCHEMA := schema/pipeline-contracts.schema.json
GOJSONSCHEMA := github.com/atombender/go-jsonschema@latest

.PHONY: codegen verify test

codegen:
	go run $(GOJSONSCHEMA) --capitalization ID --only-models -p schemaref -o go/schemaref/generated.go $(SCHEMA)

verify: codegen
	@git diff --exit-code -- go/schemaref/generated.go \
		|| { echo "schemaref is stale — run 'make codegen' and commit the result"; exit 1; }
	cd go && go test ./...

test:
	cd go && go test ./...
