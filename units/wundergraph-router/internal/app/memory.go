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

// MemStore is an in-memory Store + StatusBus for local/POC use. P3 replaces it
// with a DynamoDB-backed Store; the subscription bus stays in-process for the POC.
type MemStore struct {
	mu         sync.RWMutex
	workspaces map[string]Workspace
	documents  map[string]Document
	subs       map[string][]chan Document
}

func NewMemStore() *MemStore {
	return &MemStore{
		workspaces: map[string]Workspace{},
		documents:  map[string]Document{},
		subs:       map[string][]chan Document{},
	}
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
	d, ok := s.documents[id]
	if !ok {
		s.mu.Unlock()
		return Document{}, fmt.Errorf("document %s not found", id)
	}
	d.Status = status
	d.PipelineStage = stage
	s.documents[id] = d
	subs := append([]chan Document(nil), s.subs[id]...)
	s.mu.Unlock()
	for _, ch := range subs {
		select {
		case ch <- d:
		default: // non-blocking: drop if the subscriber is slow
		}
	}
	return d, nil
}

func (s *MemStore) Stats(context.Context) (int, int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.workspaces), len(s.documents), nil
}

// --- StatusBus ---

func (s *MemStore) Subscribe(ctx context.Context, documentID string) <-chan Document {
	ch := make(chan Document, 1)
	s.mu.Lock()
	s.subs[documentID] = append(s.subs[documentID], ch)
	s.mu.Unlock()
	go func() {
		<-ctx.Done()
		s.mu.Lock()
		defer s.mu.Unlock()
		cur := s.subs[documentID]
		for i, c := range cur {
			if c == ch {
				s.subs[documentID] = append(cur[:i], cur[i+1:]...)
				close(ch)
				break
			}
		}
	}()
	return ch
}

func (s *MemStore) Publish(doc Document) {
	_, _ = s.SetStatus(context.Background(), doc.ID, doc.Status, doc.PipelineStage)
}

// StubUploader returns a fake presigned URL + a real claim-check pointer for
// local/POC use (P3: real S3 presign).
type StubUploader struct{ Bucket string }

func (u StubUploader) Presign(_ context.Context, tenantID, documentID, filename string) (string, contracts.ClaimCheck, error) {
	key := fmt.Sprintf("tenants/%s/%s/%s", tenantID, documentID, filename)
	url := fmt.Sprintf("http://localstack:4566/%s/%s?stub-presigned=1", u.Bucket, key)
	return url, contracts.ClaimCheck{Bucket: u.Bucket, Key: key}, nil
}

// LogDispatcher builds a real StageRequest envelope and logs it instead of
// sending to SQS (P3: real SQS send). Validating here proves the contract holds.
type LogDispatcher struct{ Log *slog.Logger }

func (d LogDispatcher) Dispatch(_ context.Context, stage contracts.StageName, tenantID string, doc Document, source contracts.ClaimCheck, traceparent string) error {
	execID := uuid.NewString()
	req := contracts.StageRequest{
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
	if err := req.Validate(); err != nil {
		return fmt.Errorf("invalid StageRequest: %w", err)
	}
	d.Log.Info("dispatch StageRequest (stub; P3 sends to SQS)",
		"stage", stage, "documentId", doc.ID, "bucket", source.Bucket, "key", source.Key)
	return nil
}

// NewTraceparent mints a W3C Trace Context header (POC; real flow propagates inbound).
func NewTraceparent() string {
	a := strings.ReplaceAll(uuid.NewString(), "-", "")
	b := strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	return "00-" + a + "-" + b + "-01"
}
