package awsadapters

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
	"github.com/opus2/docuploader/units/wundergraph-router/internal/app"
)

// GSI on the documents table for the Documents(workspaceId) access pattern.
const documentsByWorkspaceGSI = "workspaceId-index"

// DynamoStore implements app.Store over two DynamoDB tables (workspaces keyed by
// id; documents keyed by id, with a workspaceId-index GSI). The P4 bootstrap
// creates these on LocalStack; the dev05 CDK stack creates them on real AWS.
type DynamoStore struct {
	client          *dynamodb.Client
	workspacesTable string
	documentsTable  string
}

func NewDynamoStore(cfg aws.Config, opts Options, workspacesTable, documentsTable string) *DynamoStore {
	c := dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
		if opts.LocalStackMode() {
			o.BaseEndpoint = aws.String(opts.Endpoint)
		}
	})
	return &DynamoStore{client: c, workspacesTable: workspacesTable, documentsTable: documentsTable}
}

type wsItem struct {
	ID            string `dynamodbav:"id"`
	Status        string `dynamodbav:"status"`
	RetentionDays *int   `dynamodbav:"retentionDays,omitempty"`
}

type docItem struct {
	ID            string  `dynamodbav:"id"`
	WorkspaceID   string  `dynamodbav:"workspaceId"`
	Filename      string  `dynamodbav:"filename"`
	ContentType   string  `dynamodbav:"contentType"`
	Status        string  `dynamodbav:"status"`
	PipelineStage *string `dynamodbav:"pipelineStage,omitempty"`
}

func (s *DynamoStore) CreateWorkspace(ctx context.Context, retentionDays *int) (app.Workspace, error) {
	w := app.Workspace{ID: "wks-" + uuid.NewString()[:8], Status: "ACTIVE", RetentionDays: retentionDays}
	item, err := attributevalue.MarshalMap(wsItem(w))
	if err != nil {
		return app.Workspace{}, err
	}
	_, err = s.client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &s.workspacesTable, Item: item})
	return w, err
}

func (s *DynamoStore) Workspaces(ctx context.Context) ([]app.Workspace, error) {
	out, err := s.client.Scan(ctx, &dynamodb.ScanInput{TableName: &s.workspacesTable})
	if err != nil {
		return nil, err
	}
	var items []wsItem
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &items); err != nil {
		return nil, err
	}
	res := make([]app.Workspace, len(items))
	for i, it := range items {
		res[i] = app.Workspace(it)
	}
	return res, nil
}

func (s *DynamoStore) CreateDocument(ctx context.Context, workspaceID, filename, contentType string) (app.Document, error) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	d := app.Document{ID: uuid.NewString(), WorkspaceID: workspaceID, Filename: filename, ContentType: contentType, Status: "UPLOADED"}
	item, err := attributevalue.MarshalMap(docItem(d))
	if err != nil {
		return app.Document{}, err
	}
	_, err = s.client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &s.documentsTable, Item: item})
	return d, err
}

func (s *DynamoStore) Documents(ctx context.Context, workspaceID string) ([]app.Document, error) {
	wid, err := attributevalue.Marshal(workspaceID)
	if err != nil {
		return nil, err
	}
	out, err := s.client.Query(ctx, &dynamodb.QueryInput{
		TableName:                 &s.documentsTable,
		IndexName:                 aws.String(documentsByWorkspaceGSI),
		KeyConditionExpression:    aws.String("workspaceId = :w"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{":w": wid},
	})
	if err != nil {
		return nil, err
	}
	var items []docItem
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &items); err != nil {
		return nil, err
	}
	res := make([]app.Document, len(items))
	for i, it := range items {
		res[i] = app.Document(it)
	}
	return res, nil
}

func (s *DynamoStore) Document(ctx context.Context, id string) (*app.Document, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return nil, err
	}
	out, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{TableName: &s.documentsTable, Key: key})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var it docItem
	if err := attributevalue.UnmarshalMap(out.Item, &it); err != nil {
		return nil, err
	}
	d := app.Document(it)
	return &d, nil
}

func (s *DynamoStore) SetStatus(ctx context.Context, id, status string, stage *string) (app.Document, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return app.Document{}, err
	}
	vals := map[string]ddbtypes.AttributeValue{":s": &ddbtypes.AttributeValueMemberS{Value: status}}
	expr := "SET #st = :s"
	if stage != nil {
		vals[":ps"] = &ddbtypes.AttributeValueMemberS{Value: *stage}
		expr += ", pipelineStage = :ps"
	}
	out, err := s.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 &s.documentsTable,
		Key:                       key,
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  map[string]string{"#st": "status"}, // status is a reserved word
		ExpressionAttributeValues: vals,
		ReturnValues:              ddbtypes.ReturnValueAllNew,
	})
	if err != nil {
		return app.Document{}, fmt.Errorf("update status: %w", err)
	}
	var it docItem
	if err := attributevalue.UnmarshalMap(out.Attributes, &it); err != nil {
		return app.Document{}, err
	}
	return app.Document(it), nil
}

func (s *DynamoStore) Stats(ctx context.Context) (int, int, error) {
	wc, err := s.count(ctx, s.workspacesTable)
	if err != nil {
		return 0, 0, err
	}
	dc, err := s.count(ctx, s.documentsTable)
	if err != nil {
		return 0, 0, err
	}
	return wc, dc, nil
}

func (s *DynamoStore) count(ctx context.Context, table string) (int, error) {
	out, err := s.client.Scan(ctx, &dynamodb.ScanInput{TableName: &table, Select: ddbtypes.SelectCount})
	if err != nil {
		return 0, err
	}
	return int(out.Count), nil
}
