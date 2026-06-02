// Package app holds the router's domain types and the ports (interfaces) the
// GraphQL resolvers depend on. P2 ships in-memory/stub implementations; P3
// swaps in the real AWS adapters (DynamoDB / S3 presign / SQS) behind the same
// interfaces — no resolver change required.
package app

import (
	"context"

	contracts "github.com/opus2/docuploader/libs/pipeline-contracts/go"
)

// Workspace / Document are the router's domain shapes (mapped to GraphQL models
// in the resolver layer).
type Workspace struct {
	ID            string
	Status        string
	RetentionDays *int
}

type Document struct {
	ID            string
	WorkspaceID   string
	Filename      string
	ContentType   string
	Status        string
	PipelineStage *string
}

// Store is the workspaces/documents persistence port (P3: DynamoDB).
type Store interface {
	CreateWorkspace(ctx context.Context, retentionDays *int) (Workspace, error)
	Workspaces(ctx context.Context) ([]Workspace, error)
	CreateDocument(ctx context.Context, workspaceID, filename, contentType string) (Document, error)
	Documents(ctx context.Context, workspaceID string) ([]Document, error)
	Document(ctx context.Context, id string) (*Document, error)
	SetStatus(ctx context.Context, id, status string, stage *string) (Document, error)
	Stats(ctx context.Context) (workspaces, documents int, err error)
}

// Uploader mints a presigned PUT URL + the claim-check pointer (P3: real S3).
type Uploader interface {
	Presign(ctx context.Context, tenantID, documentID, filename string) (url string, source contracts.ClaimCheck, err error)
}

// Dispatcher sends a StageRequest into the pipeline (P3: real SQS).
type Dispatcher interface {
	Dispatch(ctx context.Context, stage contracts.StageName, tenantID string, doc Document, source contracts.ClaimCheck, traceparent string) error
}

// StatusBus is the per-document status pub/sub feeding the GraphQL subscription.
type StatusBus interface {
	Subscribe(ctx context.Context, documentID string) <-chan Document
	Publish(doc Document)
}

// ClassificationResult mirrors the classification service's ClassificationOutput
// (the response from its sync /classify endpoint), flattened for the GraphQL model.
type ClassificationResult struct {
	DocumentID        string
	WorkspaceID       string
	Format            string
	Category          string
	SubCategory       *string
	ConfidenceScore   float64
	DetectionTier     string
	IsForcedSlipsheet bool
	ContentHash       string
	IsDuplicate       bool
	PolicyVersion     string
}

// Classifier runs a synchronous classification for an already-uploaded document.
// The real implementation (internal/classifierhttp) POSTs to the classification
// service's /classify endpoint; the stub returns a canned result for BACKEND=memory.
type Classifier interface {
	Classify(ctx context.Context, workspaceID, documentID string, source contracts.ClaimCheck, extension, contentType string) (ClassificationResult, error)
}

// WorkspaceConfig is the per-workspace classification policy — the exact shape
// the classification service reads from the workspace-config DDB table. A config
// must exist for a workspace before classify can run against it.
type WorkspaceConfig struct {
	WorkspaceID      string
	PolicyVersion    string
	Threshold        float64
	MaxZipDepth      int
	QuarantineMacros bool
	SlipsheetRules   map[string]string
	HashTTLDays      *int
}

// WorkspaceConfigStore reads/writes the workspace-config table (P3: DynamoDB),
// shared with the classification service. The router fronts it so the UI manages
// configs over the wire instead of touching DynamoDB directly.
type WorkspaceConfigStore interface {
	GetConfig(ctx context.Context, workspaceID string) (*WorkspaceConfig, error)
	ListConfigs(ctx context.Context) ([]WorkspaceConfig, error)
	SaveConfig(ctx context.Context, cfg WorkspaceConfig) (WorkspaceConfig, error)
}
