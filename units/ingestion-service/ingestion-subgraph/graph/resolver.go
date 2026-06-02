package graph

// Dependency-injection root for the resolvers. Wired in cmd/wundergraph-router.

import (
	"log/slog"
	"path/filepath"
	"strings"

	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/graph/model"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/app"
)

type Resolver struct {
	Store      app.Store
	Uploader   app.Uploader
	Dispatcher app.Dispatcher
	Bus        app.StatusBus
	Classifier app.Classifier
	Log        *slog.Logger
	Tenant     string // default tenant for the POC (real flow resolves from the token)
}

// --- domain → GraphQL model mapping ---

func toWorkspace(w app.Workspace) model.Workspace {
	return model.Workspace{ID: w.ID, Status: w.Status, RetentionDays: w.RetentionDays}
}

func toDocument(d app.Document) model.Document {
	return model.Document{
		ID:            d.ID,
		WorkspaceID:   d.WorkspaceID,
		Filename:      d.Filename,
		ContentType:   d.ContentType,
		Status:        d.Status,
		PipelineStage: d.PipelineStage,
	}
}

func toClassificationResult(c app.ClassificationResult) model.ClassificationResult {
	return model.ClassificationResult{
		DocumentID:        c.DocumentID,
		WorkspaceID:       c.WorkspaceID,
		Format:            c.Format,
		Category:          c.Category,
		SubCategory:       c.SubCategory,
		ConfidenceScore:   c.ConfidenceScore,
		DetectionTier:     c.DetectionTier,
		IsForcedSlipsheet: c.IsForcedSlipsheet,
		ContentHash:       c.ContentHash,
		IsDuplicate:       c.IsDuplicate,
		PolicyVersion:     c.PolicyVersion,
	}
}

// extensionOf returns the filename extension without the leading dot ("" if none).
func extensionOf(filename string) string {
	return strings.TrimPrefix(filepath.Ext(filename), ".")
}
