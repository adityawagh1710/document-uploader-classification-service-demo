package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	contracts "github.com/opus2/docuploader/libs/pipeline-contracts/go"
)

// MemStore is an in-memory Store for local/POC use (P3 provides a DynamoDB-backed
// Store behind the same interface). Status pub/sub lives in MemBus, separate so
// both backends share one in-process subscription bus.
type MemStore struct {
	mu         sync.RWMutex
	workspaces map[string]Workspace
	documents  map[string]Document
}

func NewMemStore() *MemStore {
	return &MemStore{workspaces: map[string]Workspace{}, documents: map[string]Document{}}
}

func (s *MemStore) CreateWorkspace(_ context.Context, retentionDays *int) (Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w := Workspace{ID: "wks-" + uuid.NewString()[:8], Status: "ACTIVE", RetentionDays: retentionDays}
	s.workspaces[w.ID] = w
	return w, nil
}

func (s *MemStore) Workspaces(context.Context) ([]Workspace, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Workspace, 0, len(s.workspaces))
	for _, w := range s.workspaces {
		out = append(out, w)
	}
	return out, nil
}

func (s *MemStore) CreateDocument(_ context.Context, workspaceID, filename, contentType string) (Document, error) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d := Document{ID: uuid.NewString(), WorkspaceID: workspaceID, Filename: filename, ContentType: contentType, Status: "UPLOADED"}
	s.documents[d.ID] = d
	return d, nil
}

func (s *MemStore) Documents(_ context.Context, workspaceID string) ([]Document, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Document{}
	for _, d := range s.documents {
		if d.WorkspaceID == workspaceID {
			out = append(out, d)
		}
	}
	return out, nil
}

func (s *MemStore) Document(_ context.Context, id string) (*Document, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if d, ok := s.documents[id]; ok {
		return &d, nil
	}
	return nil, nil
}

func (s *MemStore) SetStatus(_ context.Context, id, status string, stage *string) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.documents[id]
	if !ok {
		return Document{}, fmt.Errorf("document %s not found", id)
	}
	d.Status = status
	d.PipelineStage = stage
	s.documents[id] = d
	return d, nil
}

func (s *MemStore) Stats(context.Context) (int, int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.workspaces), len(s.documents), nil
}

// MemBus is the in-process status pub/sub feeding the GraphQL subscription. The
// router publishes on its own status changes; cross-process status (from a stage
// via update-document-state) is a documented POC limitation.
type MemBus struct {
	mu   sync.RWMutex
	subs map[string][]chan Document
}

func NewMemBus() *MemBus { return &MemBus{subs: map[string][]chan Document{}} }

func (b *MemBus) Subscribe(ctx context.Context, documentID string) <-chan Document {
	ch := make(chan Document, 1)
	b.mu.Lock()
	b.subs[documentID] = append(b.subs[documentID], ch)
	b.mu.Unlock()
	go func() {
		<-ctx.Done()
		b.mu.Lock()
		defer b.mu.Unlock()
		cur := b.subs[documentID]
		for i, c := range cur {
			if c == ch {
				b.subs[documentID] = append(cur[:i], cur[i+1:]...)
				close(ch)
				break
			}
		}
	}()
	return ch
}

func (b *MemBus) Publish(doc Document) {
	b.mu.RLock()
	subs := append([]chan Document(nil), b.subs[doc.ID]...)
	b.mu.RUnlock()
	for _, ch := range subs {
		select {
		case ch <- doc:
		default: // non-blocking: drop if the subscriber is slow
		}
	}
}

// StubUploader returns a fake presigned URL + a real claim-check pointer for
// the in-memory/no-AWS path (P3 S3Uploader does the real presign).
type StubUploader struct{ Bucket string }

func (u StubUploader) Presign(_ context.Context, tenantID, documentID, filename string) (string, contracts.ClaimCheck, error) {
	key := fmt.Sprintf("tenants/%s/%s/%s", tenantID, documentID, filename)
	url := fmt.Sprintf("http://localstack:4566/%s/%s?stub-presigned=1", u.Bucket, key)
	return url, contracts.ClaimCheck{Bucket: u.Bucket, Key: key}, nil
}

func (u StubUploader) PresignUpload(_ context.Context, documentID, filename, _ string) (string, contracts.ClaimCheck, error) {
	key := fmt.Sprintf("ui/%s/%s", documentID, filename)
	url := fmt.Sprintf("http://localstack:4566/%s/%s?stub-presigned=1", u.Bucket, key)
	return url, contracts.ClaimCheck{Bucket: u.Bucket, Key: key}, nil
}

// StubClassifier returns a canned result for the no-classification-service path
// (BACKEND=memory without CLASSIFY_URL). The real classifierhttp.Client POSTs to
// the classification /classify endpoint.
type StubClassifier struct{}

func (StubClassifier) Classify(_ context.Context, workspaceID, documentID string, _ contracts.ClaimCheck, _ string, _ string) (ClassificationResult, error) {
	return ClassificationResult{
		DocumentID:      documentID,
		WorkspaceID:     workspaceID,
		Format:          "txt",
		Category:        "convert",
		ConfidenceScore: 0.75,
		DetectionTier:   "stub",
		ContentHash:     "stub-no-classification-service",
		PolicyVersion:   "v1",
	}, nil
}

func (StubClassifier) ClassifyRaw(_ context.Context, req ClassifyRequest) (ClassifyAttempt, error) {
	return ClassifyAttempt{
		OK: true,
		Result: map[string]any{
			"documentId":  req.DocumentID,
			"workspaceId": req.WorkspaceID,
			"classification": map[string]any{
				"format":            "txt",
				"category":          "convert",
				"subCategory":       nil,
				"confidenceScore":   0.75,
				"detectionTier":     "stub",
				"isForcedSlipsheet": false,
			},
			"dedup":         map[string]any{"contentHash": "stub-no-classification-service", "isDuplicate": false},
			"policyVersion": "v1",
		},
	}, nil
}

// MemConfigStore is an in-memory WorkspaceConfigStore for BACKEND=memory.
type MemConfigStore struct {
	mu      sync.RWMutex
	configs map[string]WorkspaceConfig
}

func NewMemConfigStore() *MemConfigStore {
	return &MemConfigStore{configs: map[string]WorkspaceConfig{}}
}

func (s *MemConfigStore) GetConfig(_ context.Context, workspaceID string) (*WorkspaceConfig, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if c, ok := s.configs[workspaceID]; ok {
		return &c, nil
	}
	return nil, nil
}

func (s *MemConfigStore) ListConfigs(context.Context) ([]WorkspaceConfig, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]WorkspaceConfig, 0, len(s.configs))
	for _, c := range s.configs {
		out = append(out, c)
	}
	return out, nil
}

func (s *MemConfigStore) SaveConfig(_ context.Context, cfg WorkspaceConfig) (WorkspaceConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cfg.SlipsheetRules == nil {
		cfg.SlipsheetRules = map[string]string{}
	}
	s.configs[cfg.WorkspaceID] = cfg
	return cfg, nil
}

// --- BFF-surface stubs (BACKEND=memory) -------------------------------------

// MemRunStore is an in-memory RunStore for the no-AWS path. It keeps a per-
// workspace slice of runs (newest first) so the dashboard renders locally.
type MemRunStore struct {
	mu   sync.RWMutex
	runs map[string][]RecentRun // workspaceID -> runs (newest first)
}

func NewMemRunStore() *MemRunStore { return &MemRunStore{runs: map[string][]RecentRun{}} }

func (s *MemRunStore) ContentHashRow(context.Context, string, string) (map[string]any, error) {
	return nil, nil
}

func (s *MemRunStore) ConvertRow(context.Context, string, string) (map[string]any, error) {
	return nil, nil
}

func (s *MemRunStore) RecentRuns(_ context.Context, workspaceID string, limit int) ([]RecentRun, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows := s.runs[workspaceID]
	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	out := make([]RecentRun, len(rows))
	copy(out, rows)
	return out, nil
}

func (s *MemRunStore) Stats(ctx context.Context, workspaceID string) (ClassificationStats, error) {
	rows, _ := s.RecentRuns(ctx, workspaceID, 1000)
	stats := ClassificationStats{ByTier: map[string]int{}, ByCategory: map[string]int{}, ByFormat: map[string]int{}}
	for _, r := range rows {
		if r.Status == "failed" {
			stats.Errors++
			continue
		}
		stats.Total++
		if cls, ok := r.Result["classification"].(map[string]any); ok {
			if v, ok := cls["detectionTier"].(string); ok && v != "" {
				stats.ByTier[v]++
			}
			if v, ok := cls["category"].(string); ok && v != "" {
				stats.ByCategory[v]++
			}
			if v, ok := cls["format"].(string); ok && v != "" {
				stats.ByFormat[v]++
			}
		}
	}
	if len(rows) > 100 {
		rows = rows[:100]
	}
	stats.Recent = rows
	return stats, nil
}

func (s *MemRunStore) ReapStuckConverts(_ context.Context, stuckAfter time.Duration, _ int) (ReapResult, error) {
	return ReapResult{
		CutoffISO:    time.Now().Add(-stuckAfter).UTC().Format(time.RFC3339),
		StuckAfterMs: stuckAfter.Milliseconds(),
		Reaped:       []ReapedRun{},
	}, nil
}

func (s *MemRunStore) RecordRun(_ context.Context, run RecentRun, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.runs[run.WorkspaceID] = append([]RecentRun{run}, s.runs[run.WorkspaceID]...)
	return nil
}

// StubObjectStore returns canned metadata + a fake presigned URL for the no-AWS
// path (the real S3Uploader does HeadObject + presign).
type StubObjectStore struct{ Bucket string }

func (StubObjectStore) Head(_ context.Context, _ string, key string) (*S3ObjectMeta, error) {
	return &S3ObjectMeta{Key: key}, nil
}

func (s StubObjectStore) PresignDownload(_ context.Context, bucket, key, _, _ string) (string, error) {
	return fmt.Sprintf("http://localstack:4566/%s/%s?stub-presigned=1", bucket, key), nil
}

func (StubObjectStore) GetObject(context.Context, string, string) ([]byte, error) {
	return []byte{}, nil
}

// MemEmailExtractionStore is an in-memory EmailExtractionStore for BACKEND=memory.
type MemEmailExtractionStore struct {
	mu   sync.RWMutex
	data map[string]map[string]any
}

func NewMemEmailExtractionStore() *MemEmailExtractionStore {
	return &MemEmailExtractionStore{data: map[string]map[string]any{}}
}

func (s *MemEmailExtractionStore) Get(_ context.Context, documentID string) (map[string]any, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if v, ok := s.data[documentID]; ok {
		return v, nil
	}
	return nil, nil
}

func (s *MemEmailExtractionStore) Save(_ context.Context, documentID string, payload map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[documentID] = payload
	return nil
}

// StubConvertProgressClient always reports no live progress (no office-convert
// in the no-AWS path).
type StubConvertProgressClient struct{}

func (StubConvertProgressClient) Progress(context.Context, string) (map[string]any, error) {
	return nil, fmt.Errorf("office-convert not configured")
}

// StubHealthChecker reports an empty table list (no DynamoDB in the no-AWS path).
type StubHealthChecker struct{}

func (StubHealthChecker) ListTables(context.Context) ([]string, error) { return []string{}, nil }

// LogDispatcher builds + validates a real StageRequest and logs it instead of
// sending to SQS (P3 SQSDispatcher does the real send).
type LogDispatcher struct{ Log *slog.Logger }

func (d LogDispatcher) Dispatch(_ context.Context, stage contracts.StageName, tenantID string, doc Document, source contracts.ClaimCheck, traceparent string) error {
	req := BuildStageRequest(stage, tenantID, doc, source, traceparent)
	if err := req.Validate(); err != nil {
		return fmt.Errorf("invalid StageRequest: %w", err)
	}
	d.Log.Info("dispatch StageRequest (stub; P3 sends to SQS)",
		"stage", stage, "documentId", doc.ID, "bucket", source.Bucket, "key", source.Key)
	return nil
}

// BuildStageRequest assembles a contract-valid StageRequest envelope. Shared by
// the stub and the real SQS dispatcher so the wire shape is identical.
func BuildStageRequest(stage contracts.StageName, tenantID string, doc Document, source contracts.ClaimCheck, traceparent string) contracts.StageRequest {
	execID := uuid.NewString()
	return contracts.StageRequest{
		Envelope: contracts.Envelope{
			SchemaVersion:       contracts.SchemaVersion,
			Kind:                contracts.KindStageRequest,
			MessageID:           uuid.NewString(),
			CorrelationID:       execID,
			PipelineExecutionID: execID,
			TenantID:            tenantID,
			DocumentID:          doc.ID,
			Source:              source,
			Traceparent:         traceparent,
		},
		Stage:          stage,
		Options:        map[string]any{},
		IdempotencyKey: fmt.Sprintf("%s:%s:%s", execID, stage, doc.ID),
	}
}

// NewTraceparent mints a W3C Trace Context header (POC; real flow propagates inbound).
func NewTraceparent() string {
	a := strings.ReplaceAll(uuid.NewString(), "-", "")
	b := strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	return "00-" + a + "-" + b + "-01"
}
