// Package app holds the router's domain types and the ports (interfaces) the
// GraphQL resolvers depend on. P2 ships in-memory/stub implementations; P3
// swaps in the real AWS adapters (DynamoDB / S3 presign / SQS) behind the same
// interfaces — no resolver change required.
package app

import (
	"context"
	"time"

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

// --- BFF read/admin surface (the UI's former direct-AWS routes) -------------

// RecentRun is one row of the durable classification activity log (the
// classifications table) — mirrors the UI's lib/stats.ts RecentRecord. Result
// stays an opaque map (the full ClassificationOutput JSON) for Map passthrough.
type RecentRun struct {
	ID              string
	Ts              string
	InputName       string
	WorkspaceID     string
	ElapsedMs       int
	Status          string // "ok" | "failed"
	Result          map[string]any
	FailureReason   *string
	FailureKind     *string
	ObjectKey       *string
	ArchiveDispatch string
	ConvertStatus   *string
	ConvertQueuedAt *string
	ConvertDispatch string
}

// S3ObjectMeta is the HeadObject metadata for a stored upload.
type S3ObjectMeta struct {
	Key          string
	Size         *int64
	ContentType  *string
	ETag         *string
	LastModified *string
}

// ClassificationStats is the dashboard KPI snapshot, aggregated from the
// classifications table (durable) instead of the UI's old in-process counters.
type ClassificationStats struct {
	Total      int
	ByTier     map[string]int
	ByCategory map[string]int
	ByFormat   map[string]int
	Errors     int
	Recent     []RecentRun
}

// ReapedRun is one row force-failed by the stuck-convert watchdog.
type ReapedRun struct {
	WorkspaceID      string
	RunID            string
	ConvertStartedAt string
}

// ReapResult is the outcome of one watchdog sweep.
type ReapResult struct {
	ScannedCount int
	ReapedCount  int
	CutoffISO    string
	StuckAfterMs int64
	DurationMs   int64
	Reaped       []ReapedRun
}

// RunStore reads/writes the classifications activity-log table + reads the
// content-hash table. The UI used lib/runs.ts + the runs/stats/watchdog routes;
// the router fronts all of it so the UI holds no AWS SDK.
type RunStore interface {
	// ContentHashRow returns the raw content-hash DDB row (opaque) or nil.
	ContentHashRow(ctx context.Context, workspaceID, contentHash string) (map[string]any, error)
	// ConvertRow returns the worker-mutated convert columns on the classifications
	// row (opaque projection) or nil.
	ConvertRow(ctx context.Context, workspaceID, runID string) (map[string]any, error)
	// RecentRuns returns the workspace's runs newest-first (strongly consistent).
	RecentRuns(ctx context.Context, workspaceID string, limit int) ([]RecentRun, error)
	// Stats aggregates KPI counters + the recent feed from the table.
	Stats(ctx context.Context, workspaceID string) (ClassificationStats, error)
	// ReapStuckConverts force-fails rows stuck in converting past the cutoff.
	ReapStuckConverts(ctx context.Context, stuckAfter time.Duration, maxRows int) (ReapResult, error)
	// RecordRun persists one classification run (used by the classify write-path).
	RecordRun(ctx context.Context, run RecentRun, bucket string) error
}

// ObjectStore reads S3 object metadata + mints browser-reachable presigned GET
// URLs (the UI's old presignS3Client). Implemented alongside the S3 uploader.
type ObjectStore interface {
	Head(ctx context.Context, bucket, key string) (*S3ObjectMeta, error)
	PresignDownload(ctx context.Context, bucket, key, contentDisposition, contentType string) (string, error)
}

// EmailExtractionStore persists/reads parsed email-extraction payloads (P3:
// DynamoDB), replacing the UI's process-local in-memory cache.
type EmailExtractionStore interface {
	Get(ctx context.Context, documentID string) (map[string]any, error)
	Save(ctx context.Context, documentID string, payload map[string]any) error
}

// ConvertProgressClient queries the office-convert service for live progress.
type ConvertProgressClient interface {
	Progress(ctx context.Context, requestID string) (map[string]any, error)
}

// HealthChecker probes DynamoDB connectivity for the readiness endpoint.
type HealthChecker interface {
	ListTables(ctx context.Context) ([]string, error)
}

// BackendTarget is the operator-facing "what AWS surface is this pointed at?"
// view — pure config resolved at wiring time (no port needed).
type BackendTarget struct {
	Endpoint             string
	Region               string
	Bucket               string
	ContentHashTable     string
	WorkspaceConfigTable string
	Backend              string // "real-aws" | "localstack"
}
