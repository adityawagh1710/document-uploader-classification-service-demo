package awsadapters

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// emailExtractionTTLDays keeps the table self-pruning like the runs log.
const emailExtractionTTLDays = 30

// DynamoEmailExtractionStore implements app.EmailExtractionStore over a small
// table keyed by documentId. It replaces the UI's process-local in-memory cache
// (lib/email-extractions.ts) with durable, replica-shared storage.
type DynamoEmailExtractionStore struct {
	client *dynamodb.Client
	table  string
}

func NewDynamoEmailExtractionStore(cfg aws.Config, opts Options, table string) *DynamoEmailExtractionStore {
	c := dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
		if opts.LocalStackMode() {
			o.BaseEndpoint = aws.String(opts.Endpoint)
		}
	})
	return &DynamoEmailExtractionStore{client: c, table: table}
}

func (s *DynamoEmailExtractionStore) Get(ctx context.Context, documentID string) (map[string]any, error) {
	out, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      &s.table,
		ConsistentRead: aws.Bool(true),
		Key:            map[string]ddbtypes.AttributeValue{"documentId": &ddbtypes.AttributeValueMemberS{Value: documentID}},
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var row struct {
		Extraction map[string]any `dynamodbav:"extraction"`
	}
	if err := attributevalue.UnmarshalMap(out.Item, &row); err != nil {
		return nil, err
	}
	return row.Extraction, nil
}

func (s *DynamoEmailExtractionStore) Save(ctx context.Context, documentID string, payload map[string]any) error {
	item, err := attributevalue.MarshalMap(struct {
		DocumentID string         `dynamodbav:"documentId"`
		Extraction map[string]any `dynamodbav:"extraction"`
		ExpiresAt  int64          `dynamodbav:"expiresAt"`
	}{
		DocumentID: documentID,
		Extraction: payload,
		ExpiresAt:  time.Now().Unix() + int64(emailExtractionTTLDays)*24*60*60,
	})
	if err != nil {
		return fmt.Errorf("marshal email extraction: %w", err)
	}
	if _, err := s.client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &s.table, Item: item}); err != nil {
		return fmt.Errorf("put email extraction: %w", err)
	}
	return nil
}
