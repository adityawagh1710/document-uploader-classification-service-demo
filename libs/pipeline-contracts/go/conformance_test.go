package contracts

// Conformance/drift gate: the JSON Schema (../schema) is the source of truth.
// These tests marshal the hand-written Go types and validate the JSON against
// the schema. If a hand-written type drifts from the schema (field added,
// renamed, retyped, required changed), the test fails — so the schema stays
// authoritative even though the Go flavor is hand-written (see option A in
// Contracts_Baked_POC_Design.md §3/§4).

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

const schemaID = "https://opus2.com/docuploader/pipeline-contracts.schema.json"
const schemaPath = "../schema/pipeline-contracts.schema.json"

func defSchema(t *testing.T, def string) *jsonschema.Schema {
	t.Helper()
	raw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	doc, err := jsonschema.UnmarshalJSON(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("parse schema: %v", err)
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource(schemaID, doc); err != nil {
		t.Fatalf("add resource: %v", err)
	}
	sch, err := c.Compile(schemaID + "#/$defs/" + def)
	if err != nil {
		t.Fatalf("compile %s: %v", def, err)
	}
	return sch
}

// conforms marshals v, re-parses it as a JSON value, and validates against the
// named $def in the schema.
func conforms(t *testing.T, def string, v any) {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	inst, err := jsonschema.UnmarshalJSON(strings.NewReader(string(b)))
	if err != nil {
		t.Fatalf("reparse: %v", err)
	}
	if err := defSchema(t, def).Validate(inst); err != nil {
		t.Fatalf("%s drifted from the schema:\n%v", def, err)
	}
}

func TestStageRequestConformsToSchema(t *testing.T) {
	conforms(t, "StageRequest", sampleStageRequest())
}

func TestStageStatusUpdateConformsToSchema(t *testing.T) {
	su := StageStatusUpdate{
		Envelope: sampleStageRequest().Envelope,
		Stage:    StageOCR,
		Status:   StatusSuccess,
		Outputs:  []ClaimCheck{{Bucket: "classification-ui-bucket", Key: "out/x.pdf"}},
	}
	su.Kind = KindStageStatusUpdate
	conforms(t, "StageStatusUpdate", su)
}

func TestDocumentPipelineEventConformsToSchema(t *testing.T) {
	e := DocumentPipelineEvent{
		Envelope:       sampleStageRequest().Envelope,
		WorkspaceID:    "wks-ui-001",
		Filename:       "contract.docx",
		ContentType:    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		IdempotencyKey: "exec:event:doc",
	}
	e.Kind = KindDocumentPipelineEvent
	conforms(t, "DocumentPipelineEvent", e)
}

// A deliberately-broken value must be rejected (proves the gate actually bites).
func TestSchemaRejectsBadStage(t *testing.T) {
	m := sampleStageRequest()
	m.Stage = "not-a-real-stage"
	b, _ := json.Marshal(m)
	inst, _ := jsonschema.UnmarshalJSON(strings.NewReader(string(b)))
	if err := defSchema(t, "StageRequest").Validate(inst); err == nil {
		t.Fatal("expected schema to reject an out-of-enum stage, but it passed")
	}
}
