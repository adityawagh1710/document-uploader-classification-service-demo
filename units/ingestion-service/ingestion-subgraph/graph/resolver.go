package graph

// Dependency-injection root for the resolvers. Wired in cmd/wundergraph-router.

import (
	"log/slog"

	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/graph/model"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/app"
)

type Resolver struct {
	Store      app.Store
	Uploader   app.Uploader
	Dispatcher app.Dispatcher
	Bus        app.StatusBus
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
