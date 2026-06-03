package awsadapters

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/app"
)

// runTTLDays mirrors lib/runs.ts — keeps the sandbox table self-pruning.
const runTTLDays = 30

// DynamoRunStore implements app.RunStore over the classifications activity-log
// table (PK workspaceId / SK runId) + reads of the content-hash table. It ports
// the UI's lib/runs.ts + the runs/stats/convert-watchdog route handlers so the
// UI never touches DynamoDB.
type DynamoRunStore struct {
	client              *dynamodb.Client
	classificationsTbl  string
	contentHashTbl      string
}

func NewDynamoRunStore(cfg aws.Config, opts Options, classificationsTable, contentHashTable string) *DynamoRunStore {
	c := dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
		if opts.LocalStackMode() {
			o.BaseEndpoint = aws.String(opts.Endpoint)
		}
	})
	return &DynamoRunStore{client: c, classificationsTbl: classificationsTable, contentHashTbl: contentHashTable}
}

// runItem is the persisted row shape — the RecentRun fields plus the DynamoDB
// keys, S3 reference, and TTL (mirrors lib/runs.ts RunItem). Worker-mutated
// convert* columns are read back opaquely via ConvertRow, not here.
type runItem struct {
	ID              string         `dynamodbav:"id"`
	Ts              string         `dynamodbav:"ts"`
	InputName       string         `dynamodbav:"inputName"`
	WorkspaceID     string         `dynamodbav:"workspaceId"`
	ElapsedMs       int            `dynamodbav:"elapsedMs"`
	Status          string         `dynamodbav:"status"`
	Result          map[string]any `dynamodbav:"result,omitempty"`
	FailureReason   *string        `dynamodbav:"failureReason,omitempty"`
	FailureKind     *string        `dynamodbav:"failureKind,omitempty"`
	ObjectKey       *string        `dynamodbav:"objectKey,omitempty"`
	ArchiveDispatch string         `dynamodbav:"archiveDispatch"`
	ConvertStatus   *string        `dynamodbav:"convertStatus,omitempty"`
	ConvertQueuedAt *string        `dynamodbav:"convertQueuedAt,omitempty"`
	ConvertDispatch string         `dynamodbav:"convertDispatch"`
	RunID           string         `dynamodbav:"runId"`
	S3Bucket        string         `dynamodbav:"s3Bucket"`
	S3Key           *string        `dynamodbav:"s3Key,omitempty"`
	ExpiresAt       int64          `dynamodbav:"expiresAt"`
}

func toRecentRun(it runItem) app.RecentRun {
	archive := it.ArchiveDispatch
	if archive == "" {
		archive = "skipped"
	}
	convert := it.ConvertDispatch
	if convert == "" {
		convert = "skipped"
	}
	return app.RecentRun{
		ID:              it.ID,
		Ts:              it.Ts,
		InputName:       it.InputName,
		WorkspaceID:     it.WorkspaceID,
		ElapsedMs:       it.ElapsedMs,
		Status:          it.Status,
		Result:          it.Result,
		FailureReason:   it.FailureReason,
		FailureKind:     it.FailureKind,
		ObjectKey:       it.ObjectKey,
		ArchiveDispatch: archive,
		ConvertStatus:   it.ConvertStatus,
		ConvertQueuedAt: it.ConvertQueuedAt,
		ConvertDispatch: convert,
	}
}

func (s *DynamoRunStore) ContentHashRow(ctx context.Context, workspaceID, contentHash string) (map[string]any, error) {
	out, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      &s.contentHashTbl,
		ConsistentRead: aws.Bool(true),
		Key: map[string]ddbtypes.AttributeValue{
			"workspaceId": &ddbtypes.AttributeValueMemberS{Value: workspaceID},
			"contentHash": &ddbtypes.AttributeValueMemberS{Value: contentHash},
		},
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var row map[string]any
	if err := attributevalue.UnmarshalMap(out.Item, &row); err != nil {
		return nil, err
	}
	return row, nil
}

// convertProjection lists the worker-mutated convert columns the UI's runs route
// reads off the classifications row.
const convertProjection = "convertStatus, convertStartedAt, convertCompletedAt, " +
	"convertS3Bucket, convertS3Key, convertRequestId, " +
	"convertError, convertAttempts, convertQueuedAt, convertDispatch"

func (s *DynamoRunStore) ConvertRow(ctx context.Context, workspaceID, runID string) (map[string]any, error) {
	out, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            &s.classificationsTbl,
		ConsistentRead:       aws.Bool(true),
		ProjectionExpression: aws.String(convertProjection),
		Key: map[string]ddbtypes.AttributeValue{
			"workspaceId": &ddbtypes.AttributeValueMemberS{Value: workspaceID},
			"runId":       &ddbtypes.AttributeValueMemberS{Value: runID},
		},
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var row map[string]any
	if err := attributevalue.UnmarshalMap(out.Item, &row); err != nil {
		return nil, err
	}
	return row, nil
}

func (s *DynamoRunStore) RecentRuns(ctx context.Context, workspaceID string, limit int) ([]app.RecentRun, error) {
	out, err := s.client.Query(ctx, &dynamodb.QueryInput{
		TableName:                 &s.classificationsTbl,
		KeyConditionExpression:    aws.String("workspaceId = :w"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{":w": &ddbtypes.AttributeValueMemberS{Value: workspaceID}},
		ScanIndexForward:          aws.Bool(false), // newest first
		Limit:                     aws.Int32(int32(limit)),
		ConsistentRead:            aws.Bool(true),
	})
	if err != nil {
		return nil, err
	}
	runs := make([]app.RecentRun, 0, len(out.Items))
	for _, item := range out.Items {
		var it runItem
		if err := attributevalue.UnmarshalMap(item, &it); err != nil {
			return nil, err
		}
		runs = append(runs, toRecentRun(it))
	}
	return runs, nil
}

// statsScanLimit bounds the rows aggregated for the KPI tiles. The UI's old
// in-process counters were unbounded across a session; at sandbox volume
// (TTL-bounded to 30 days) one consistent page is plenty.
const statsScanLimit = 1000

func (s *DynamoRunStore) Stats(ctx context.Context, workspaceID string) (app.ClassificationStats, error) {
	rows, err := s.RecentRuns(ctx, workspaceID, statsScanLimit)
	if err != nil {
		return app.ClassificationStats{}, err
	}
	stats := app.ClassificationStats{
		ByTier:     map[string]int{},
		ByCategory: map[string]int{},
		ByFormat:   map[string]int{},
	}
	for _, r := range rows {
		// Mirror lib/stats.ts: total + byX count successes; errors counts failures.
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
	// Recent feed caps at 100 (matches the UI's MAX_RECENT).
	if len(rows) > 100 {
		rows = rows[:100]
	}
	stats.Recent = rows
	return stats, nil
}

func (s *DynamoRunStore) ReapStuckConverts(ctx context.Context, stuckAfter time.Duration, maxRows int) (app.ReapResult, error) {
	start := time.Now()
	cutoffISO := start.Add(-stuckAfter).UTC().Format(time.RFC3339)

	out, err := s.client.Scan(ctx, &dynamodb.ScanInput{
		TableName:        &s.classificationsTbl,
		FilterExpression: aws.String("convertStatus = :s AND convertStartedAt < :c"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":s": &ddbtypes.AttributeValueMemberS{Value: "converting"},
			":c": &ddbtypes.AttributeValueMemberS{Value: cutoffISO},
		},
		Limit: aws.Int32(200), // cap the page; re-bounded by maxRows below
	})
	if err != nil {
		return app.ReapResult{}, fmt.Errorf("scan stuck converts: %w", err)
	}

	candidates := out.Items
	if len(candidates) > maxRows {
		candidates = candidates[:maxRows]
	}
	reaped := make([]app.ReapedRun, 0, len(candidates))
	nowISO := time.Now().UTC().Format(time.RFC3339)

	for _, row := range candidates {
		workspaceID := stringAttr(row["workspaceId"])
		runID := stringAttr(row["runId"])
		startedAt := stringAttr(row["convertStartedAt"])
		if workspaceID == "" || runID == "" {
			continue
		}
		_, uerr := s.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName: &s.classificationsTbl,
			Key: map[string]ddbtypes.AttributeValue{
				"workspaceId": &ddbtypes.AttributeValueMemberS{Value: workspaceID},
				"runId":       &ddbtypes.AttributeValueMemberS{Value: runID},
			},
			UpdateExpression:    aws.String("SET convertStatus = :failed, convertCompletedAt = :now, convertError = :err"),
			ConditionExpression: aws.String("convertStatus = :converting"),
			ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
				":failed":     &ddbtypes.AttributeValueMemberS{Value: "failed"},
				":converting": &ddbtypes.AttributeValueMemberS{Value: "converting"},
				":now":        &ddbtypes.AttributeValueMemberS{Value: nowISO},
				":err":        &ddbtypes.AttributeValueMemberS{Value: "timeout_watchdog"},
			},
		})
		if uerr != nil {
			// ConditionalCheckFailed = a racing worker won; skip silently.
			continue
		}
		reaped = append(reaped, app.ReapedRun{WorkspaceID: workspaceID, RunID: runID, ConvertStartedAt: startedAt})
	}

	scanned := 0
	if out.Count != 0 {
		scanned = int(out.Count)
	}
	return app.ReapResult{
		ScannedCount: scanned,
		ReapedCount:  len(reaped),
		CutoffISO:    cutoffISO,
		StuckAfterMs: stuckAfter.Milliseconds(),
		DurationMs:   time.Since(start).Milliseconds(),
		Reaped:       reaped,
	}, nil
}

func (s *DynamoRunStore) RecordRun(ctx context.Context, run app.RecentRun, bucket string) error {
	it := runItem{
		ID:              run.ID,
		Ts:              run.Ts,
		InputName:       run.InputName,
		WorkspaceID:     run.WorkspaceID,
		ElapsedMs:       run.ElapsedMs,
		Status:          run.Status,
		Result:          run.Result,
		FailureReason:   run.FailureReason,
		FailureKind:     run.FailureKind,
		ObjectKey:       run.ObjectKey,
		ArchiveDispatch: run.ArchiveDispatch,
		ConvertStatus:   run.ConvertStatus,
		ConvertQueuedAt: run.ConvertQueuedAt,
		ConvertDispatch: run.ConvertDispatch,
		RunID:           run.Ts + "#" + run.ID,
		S3Bucket:        bucket,
		S3Key:           run.ObjectKey,
		ExpiresAt:       computeExpiresAt(run.Ts),
	}
	item, err := attributevalue.MarshalMap(it)
	if err != nil {
		return fmt.Errorf("marshal run item: %w", err)
	}
	if _, err := s.client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &s.classificationsTbl, Item: item}); err != nil {
		return fmt.Errorf("put run item: %w", err)
	}
	return nil
}

func computeExpiresAt(ts string) int64 {
	base, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		base = time.Now()
	}
	return base.Unix() + int64(runTTLDays)*24*60*60
}

// stringAttr pulls a string out of a raw DDB attribute (S member) or "".
func stringAttr(v ddbtypes.AttributeValue) string {
	if s, ok := v.(*ddbtypes.AttributeValueMemberS); ok {
		return s.Value
	}
	if n, ok := v.(*ddbtypes.AttributeValueMemberN); ok {
		return n.Value
	}
	return ""
}
