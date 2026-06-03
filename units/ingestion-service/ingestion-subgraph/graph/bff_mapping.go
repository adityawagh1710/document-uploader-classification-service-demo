package graph

// Mapping + small helpers for the BFF read/admin resolvers (the operations that
// back the document-uploader UI's former direct-AWS routes).

import (
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/graph/model"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/app"
)

func toS3ObjectModel(m *app.S3ObjectMeta) *model.S3Object {
	if m == nil {
		return nil
	}
	out := &model.S3Object{
		Key:          m.Key,
		ContentType:  m.ContentType,
		Etag:         m.ETag,
		LastModified: m.LastModified,
	}
	if m.Size != nil {
		sz := int(*m.Size)
		out.Size = &sz
	}
	return out
}

func toRecentRunModel(r app.RecentRun) model.RecentRun {
	return model.RecentRun{
		ID:              r.ID,
		Ts:              r.Ts,
		InputName:       r.InputName,
		WorkspaceID:     r.WorkspaceID,
		ElapsedMs:       r.ElapsedMs,
		Status:          r.Status,
		Result:          r.Result,
		FailureReason:   r.FailureReason,
		FailureKind:     r.FailureKind,
		ObjectKey:       r.ObjectKey,
		ArchiveDispatch: r.ArchiveDispatch,
		ConvertStatus:   r.ConvertStatus,
		ConvertQueuedAt: r.ConvertQueuedAt,
		ConvertDispatch: r.ConvertDispatch,
	}
}

func toClassificationStatsModel(s app.ClassificationStats) *model.ClassificationStats {
	recent := make([]model.RecentRun, 0, len(s.Recent))
	for _, r := range s.Recent {
		recent = append(recent, toRecentRunModel(r))
	}
	return &model.ClassificationStats{
		Total:      s.Total,
		Errors:     s.Errors,
		ByTier:     intMapToAny(s.ByTier),
		ByCategory: intMapToAny(s.ByCategory),
		ByFormat:   intMapToAny(s.ByFormat),
		Recent:     recent,
	}
}

func intMapToAny(m map[string]int) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// lastSegment returns the final path segment of key, or def when empty.
func lastSegment(key, def string) string {
	parts := strings.Split(key, "/")
	if last := parts[len(parts)-1]; last != "" {
		return last
	}
	return def
}

// watchdogStuckAfter mirrors the UI route's STUCK_AFTER_MS (default 35 min).
func watchdogStuckAfter() time.Duration {
	if v := os.Getenv("STUCK_AFTER_MS"); v != "" {
		if ms, err := strconv.ParseInt(v, 10, 64); err == nil && ms > 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}
	return 35 * time.Minute
}

// watchdogMaxRows mirrors the UI route's WATCHDOG_MAX_ROWS (default 50).
func watchdogMaxRows() int {
	if v := os.Getenv("WATCHDOG_MAX_ROWS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 50
}
