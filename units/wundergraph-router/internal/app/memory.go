package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"

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
