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
