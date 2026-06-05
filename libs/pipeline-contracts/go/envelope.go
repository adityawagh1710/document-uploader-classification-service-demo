// Package contracts is the Go flavor of the document-uploader wire contract:
// the SQS envelope every pipeline stage agrees on. It is intentionally
// dependency-free (stdlib only) so it can be vendored/baked into any Go unit
// (the wundergraph-router, resolvers, lambdas) without pulling transitive deps.
//
// Mirrors ../../../Contracts_Baked_POC_Design.md and the TS flavor in
// libs/pipeline-contracts/ts. Heavy bytes never cross the wire — only the small
// envelope, which carries an S3 claim-check pointer.
package contracts

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// SchemaVersion is the version this build speaks. Additive (minor/patch)
// evolution is the default; a major bump is breaking, and consumers must
// tolerate version N and N-1 across a rolling deploy (see AssertCompatibleVersion).
const SchemaVersion = "1.0.0"

// StageName is the closed taxonomy of stages a StageRequest may target.
type StageName string

const (
	StageClassify        StageName = "classify"
	StageZipExtraction   StageName = "zip-extraction"
	StageEmailExtraction StageName = "email-extraction"
	StageOfficeConvert   StageName = "office-convert"
	StageHTMLConvert     StageName = "html-convert"
	StageTIFFCOG         StageName = "tiff-cog"
	StageImageTIFF       StageName = "image-tiff"
	StageMediaConvert    StageName = "media-convert"
	StageSlipsheet       StageName = "slipsheet"
	StagePDFProcessing   StageName = "pdf-processing"
	StageOCR             StageName = "ocr"
	StageOutputAssembly  StageName = "output-assembly"
)

// KnownStages is the canonical ordered list (mirrors the TS KNOWN_STAGES).
var KnownStages = []StageName{
	StageClassify, StageZipExtraction, StageEmailExtraction, StageOfficeConvert,
	StageHTMLConvert, StageTIFFCOG, StageImageTIFF, StageMediaConvert,
	StageSlipsheet, StagePDFProcessing, StageOCR, StageOutputAssembly,
}

// Valid reports whether s is a member of the closed taxonomy.
func (s StageName) Valid() bool {
	for _, k := range KnownStages {
		if s == k {
			return true
		}
	}
	return false
}

// ClaimCheck is the S3 pointer that crosses the wire in place of heavy bytes.
type ClaimCheck struct {
	Bucket string `json:"bucket"`
	Key    string `json:"key"`
}

// Message kinds (discriminator on the wire).
const (
	KindDocumentPipelineEvent = "DocumentPipelineEvent"
	KindStageRequest          = "StageRequest"
	KindStageStatusUpdate     = "StageStatusUpdate"
)

// Envelope is the spine present on every message of every family.
type Envelope struct {
	SchemaVersion       string     `json:"schemaVersion"`
	Kind                string     `json:"kind"`
	MessageID           string     `json:"messageId"`
	CorrelationID       string     `json:"correlationId"`
	PipelineExecutionID string     `json:"pipelineExecutionId"`
	TenantID            string     `json:"tenantId"`
	DocumentID          string     `json:"documentId"`
	Source              ClaimCheck `json:"source"`
	TaskToken           *string    `json:"taskToken"`   // Step Functions callback, when applicable
	Traceparent         string     `json:"traceparent"` // W3C Trace Context
}

// ErrorEnvelope is the uniform error shape on non-GraphQL surfaces.
type ErrorEnvelope struct {
	Code       string         `json:"code"`
	Message    string         `json:"message"`
	Detail     any            `json:"detail,omitempty"`
	Retryable  bool           `json:"retryable"`
	Extensions map[string]any `json:"extensions,omitempty"`
}

// StatusValue is the outcome a stage reports.
type StatusValue string

const (
	StatusSuccess       StatusValue = "SUCCESS"
	StatusPartialFailed StatusValue = "PARTIAL_FAILED"
	StatusFailed        StatusValue = "FAILED"
)

// ---- the three message families --------------------------------------------

// DocumentPipelineEvent enters at ingestion and re-enters on zip/email fan-out.
type DocumentPipelineEvent struct {
	Envelope
	WorkspaceID      string  `json:"workspaceId"`
	Filename         string  `json:"filename"`
	ContentType      string  `json:"contentType"`
	ParentDocumentID *string `json:"parentDocumentId"`
	IdempotencyKey   string  `json:"idempotencyKey"`
}

// StageRequest is what orchestration sends to a stage's queue.
type StageRequest struct {
	Envelope
	Stage          StageName      `json:"stage"`
	Options        map[string]any `json:"options"`
	IdempotencyKey string         `json:"idempotencyKey"`
}

// StageStatusUpdate is what a stage emits to update-document-state.
type StageStatusUpdate struct {
	Envelope
	Stage   StageName      `json:"stage"`
	Status  StatusValue    `json:"status"`
	Outputs []ClaimCheck   `json:"outputs,omitempty"`
	Error   *ErrorEnvelope `json:"error,omitempty"`
}

// ---- validation + version compatibility ------------------------------------

var (
	// ErrIncompatibleVersion is returned when a message's major schemaVersion
	// differs from this build's (a message that outlived a breaking deploy).
	ErrIncompatibleVersion = errors.New("incompatible schemaVersion")
	// ErrUnknownStage is returned for a stage outside the closed taxonomy.
	ErrUnknownStage = errors.New("unknown stage")
	// ErrMissingField is returned when a required envelope field is empty.
	ErrMissingField = errors.New("missing required field")
)

// AssertCompatibleVersion fails when the major version differs from this build.
func AssertCompatibleVersion(v string) error {
	if majorOf(v) != majorOf(SchemaVersion) {
		return fmt.Errorf("%w: %s (this build speaks %s)", ErrIncompatibleVersion, v, SchemaVersion)
	}
	return nil
}

func majorOf(v string) string {
	if i := strings.IndexByte(v, '.'); i >= 0 {
		return v[:i]
	}
	return v
}

func (e Envelope) validateSpine() error {
	required := []struct {
		name, val string
	}{
		{"schemaVersion", e.SchemaVersion}, {"messageId", e.MessageID},
		{"correlationId", e.CorrelationID}, {"pipelineExecutionId", e.PipelineExecutionID},
		{"tenantId", e.TenantID}, {"documentId", e.DocumentID}, {"traceparent", e.Traceparent},
	}
	for _, f := range required {
		if strings.TrimSpace(f.val) == "" {
			return fmt.Errorf("%w: %s", ErrMissingField, f.name)
		}
	}
	if e.Source.Bucket == "" || e.Source.Key == "" {
		return fmt.Errorf("%w: source.{bucket,key}", ErrMissingField)
	}
	return AssertCompatibleVersion(e.SchemaVersion)
}

// Validate checks a StageRequest's spine, stage membership, and version.
func (m StageRequest) Validate() error {
	if err := m.validateSpine(); err != nil {
		return err
	}
	if !m.Stage.Valid() {
		return fmt.Errorf("%w: %q", ErrUnknownStage, m.Stage)
	}
	if strings.TrimSpace(m.IdempotencyKey) == "" {
		return fmt.Errorf("%w: idempotencyKey", ErrMissingField)
	}
	return nil
}

// Validate checks a StageStatusUpdate's spine, stage membership, and version.
func (m StageStatusUpdate) Validate() error {
	if err := m.validateSpine(); err != nil {
		return err
	}
	if !m.Stage.Valid() {
		return fmt.Errorf("%w: %q", ErrUnknownStage, m.Stage)
	}
	return nil
}

// ParseStageRequest unmarshals + validates an inbound StageRequest — the baked
// validator a stage runs on receive.
func ParseStageRequest(body []byte) (StageRequest, error) {
	var m StageRequest
	if err := json.Unmarshal(body, &m); err != nil {
		return m, fmt.Errorf("decode StageRequest: %w", err)
	}
	return m, m.Validate()
}

// ParseStageStatusUpdate unmarshals + validates an inbound StageStatusUpdate.
func ParseStageStatusUpdate(body []byte) (StageStatusUpdate, error) {
	var m StageStatusUpdate
	if err := json.Unmarshal(body, &m); err != nil {
		return m, fmt.Errorf("decode StageStatusUpdate: %w", err)
	}
	return m, m.Validate()
}
