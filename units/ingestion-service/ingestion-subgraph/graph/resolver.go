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
	Store                app.Store
	Uploader             app.Uploader
	Dispatcher           app.Dispatcher
	Bus                  app.StatusBus
	Classifier           app.Classifier
	WorkspaceConfigStore app.WorkspaceConfigStore
	// BFF surface — the read/admin ports backing the document-uploader UI.
	RunStore        app.RunStore
	ObjectStore     app.ObjectStore
	EmailStore      app.EmailExtractionStore
	ConvertProgress app.ConvertProgressClient
	Health          app.HealthChecker
	Target          app.BackendTarget
	Log             *slog.Logger
	Tenant          string // default tenant for the POC (real flow resolves from the token)
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

func toWorkspaceConfigModel(c app.WorkspaceConfig) model.WorkspaceConfig {
	rules := make(map[string]any, len(c.SlipsheetRules))
	for k, v := range c.SlipsheetRules {
		rules[k] = v
	}
	return model.WorkspaceConfig{
		WorkspaceID:      c.WorkspaceID,
		PolicyVersion:    c.PolicyVersion,
		Threshold:        c.Threshold,
		MaxZipDepth:      c.MaxZipDepth,
		QuarantineMacros: c.QuarantineMacros,
		SlipsheetRules:   rules,
		HashTTLDays:      c.HashTTLDays,
	}
}

// workspaceConfigFromInput applies the same defaults the UI used (policyVersion
// v1, threshold 0.5, maxZipDepth 5) so a partial save produces a valid config.
func workspaceConfigFromInput(in model.WorkspaceConfigInput) app.WorkspaceConfig {
	cfg := app.WorkspaceConfig{
		WorkspaceID:      in.WorkspaceID,
		PolicyVersion:    "v1",
		Threshold:        0.5,
		MaxZipDepth:      5,
		QuarantineMacros: false,
		SlipsheetRules:   map[string]string{},
		HashTTLDays:      in.HashTTLDays,
	}
	if in.PolicyVersion != nil {
		cfg.PolicyVersion = *in.PolicyVersion
	}
	if in.Threshold != nil {
		cfg.Threshold = *in.Threshold
	}
	if in.MaxZipDepth != nil {
		cfg.MaxZipDepth = *in.MaxZipDepth
	}
	if in.QuarantineMacros != nil {
		cfg.QuarantineMacros = *in.QuarantineMacros
	}
	for k, v := range in.SlipsheetRules {
		if s, ok := v.(string); ok {
			cfg.SlipsheetRules[k] = s
		}
	}
	return cfg
}
