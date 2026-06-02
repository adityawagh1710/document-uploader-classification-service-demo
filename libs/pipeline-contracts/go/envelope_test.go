package contracts

import (
	"encoding/json"
	"errors"
	"testing"
)

func sampleStageRequest() StageRequest {
	return StageRequest{
		Envelope: Envelope{
			SchemaVersion:       SchemaVersion,
			Kind:                KindStageRequest,
			MessageID:           "11111111-1111-1111-1111-111111111111",
			CorrelationID:       "22222222-2222-2222-2222-222222222222",
			PipelineExecutionID: "22222222-2222-2222-2222-222222222222",
			TenantID:            "tenant-a",
			DocumentID:          "33333333-3333-3333-3333-333333333333",
			Source:              ClaimCheck{Bucket: "classification-ui-bucket", Key: "ui/doc/x.docx"},
			Traceparent:         "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
		},
		Stage:          StageClassify,
		Options:        map[string]any{},
		IdempotencyKey: "exec:classify:doc",
	}
}

// Round-trip through JSON proves ingestion (router) and a stage agree by
// construction — the wire-contract compatibility gate.
func TestStageRequestRoundTrip(t *testing.T) {
	in := sampleStageRequest()
	if err := in.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, err := ParseStageRequest(b)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.Stage != StageClassify || got.Source.Bucket != in.Source.Bucket || got.SchemaVersion != SchemaVersion {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
}

func TestUnknownStageRejected(t *testing.T) {
	m := sampleStageRequest()
	m.Stage = "totally-made-up-stage"
	if err := m.Validate(); !errors.Is(err, ErrUnknownStage) {
		t.Fatalf("expected ErrUnknownStage, got %v", err)
	}
}

func TestMajorVersionGuard(t *testing.T) {
	if err := AssertCompatibleVersion("2.0.0"); !errors.Is(err, ErrIncompatibleVersion) {
		t.Fatalf("expected ErrIncompatibleVersion for 2.0.0, got %v", err)
	}
	if err := AssertCompatibleVersion("1.5.3"); err != nil {
		t.Fatalf("minor/patch bump should be compatible, got %v", err)
	}
}

func TestMissingSpineFieldRejected(t *testing.T) {
	m := sampleStageRequest()
	m.TenantID = ""
	if err := m.Validate(); !errors.Is(err, ErrMissingField) {
		t.Fatalf("expected ErrMissingField, got %v", err)
	}
}

func TestAllKnownStagesValid(t *testing.T) {
	if len(KnownStages) != 12 {
		t.Fatalf("expected 12 stages, got %d", len(KnownStages))
	}
	for _, s := range KnownStages {
		if !s.Valid() {
			t.Fatalf("stage %q should be valid", s)
		}
	}
}
