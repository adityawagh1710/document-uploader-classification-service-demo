package awsadapters

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/app"
)

// DynamoConfigStore implements app.WorkspaceConfigStore over the workspace-config
// table the classification service consumes. The item shape mirrors that table
// exactly (workspaceId:S, policyVersion:S, threshold:N, maxZipDepth:N,
// quarantineMacros:BOOL, slipsheetRules:M, hashTtlDays:N|NULL) so a config saved
// here is directly readable by classification.
type DynamoConfigStore struct {
	client *dynamodb.Client
	table  string
}

func NewDynamoConfigStore(cfg aws.Config, opts Options, table string) *DynamoConfigStore {
	c := dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
		if opts.LocalStackMode() {
			o.BaseEndpoint = aws.String(opts.Endpoint)
		}
	})
	return &DynamoConfigStore{client: c, table: table}
}

type wcItem struct {
	WorkspaceID      string            `dynamodbav:"workspaceId"`
	PolicyVersion    string            `dynamodbav:"policyVersion"`
	Threshold        float64           `dynamodbav:"threshold"`
	MaxZipDepth      int               `dynamodbav:"maxZipDepth"`
	QuarantineMacros bool              `dynamodbav:"quarantineMacros"`
	SlipsheetRules   map[string]string `dynamodbav:"slipsheetRules"`
	HashTTLDays      *int              `dynamodbav:"hashTtlDays"`
}

func toWcItem(c app.WorkspaceConfig) wcItem {
	rules := c.SlipsheetRules
	if rules == nil {
		rules = map[string]string{} // non-nil so it marshals to M{}, not NULL (classification rejects null)
	}
	return wcItem{
		WorkspaceID:      c.WorkspaceID,
		PolicyVersion:    c.PolicyVersion,
		Threshold:        c.Threshold,
		MaxZipDepth:      c.MaxZipDepth,
		QuarantineMacros: c.QuarantineMacros,
		SlipsheetRules:   rules,
		HashTTLDays:      c.HashTTLDays,
	}
}

func fromWcItem(i wcItem) app.WorkspaceConfig {
	rules := i.SlipsheetRules
	if rules == nil {
		rules = map[string]string{}
	}
	return app.WorkspaceConfig{
		WorkspaceID:      i.WorkspaceID,
		PolicyVersion:    i.PolicyVersion,
		Threshold:        i.Threshold,
		MaxZipDepth:      i.MaxZipDepth,
		QuarantineMacros: i.QuarantineMacros,
		SlipsheetRules:   rules,
		HashTTLDays:      i.HashTTLDays,
	}
}

func (s *DynamoConfigStore) GetConfig(ctx context.Context, workspaceID string) (*app.WorkspaceConfig, error) {
	out, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &s.table,
		Key:       map[string]ddbtypes.AttributeValue{"workspaceId": &ddbtypes.AttributeValueMemberS{Value: workspaceID}},
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var it wcItem
	if err := attributevalue.UnmarshalMap(out.Item, &it); err != nil {
		return nil, err
	}
	c := fromWcItem(it)
	return &c, nil
}

func (s *DynamoConfigStore) ListConfigs(ctx context.Context) ([]app.WorkspaceConfig, error) {
	out, err := s.client.Scan(ctx, &dynamodb.ScanInput{TableName: &s.table})
	if err != nil {
		return nil, err
	}
	res := make([]app.WorkspaceConfig, 0, len(out.Items))
	for _, item := range out.Items {
		var it wcItem
		if err := attributevalue.UnmarshalMap(item, &it); err != nil {
			return nil, err
		}
		res = append(res, fromWcItem(it))
	}
	return res, nil
}

func (s *DynamoConfigStore) SaveConfig(ctx context.Context, cfg app.WorkspaceConfig) (app.WorkspaceConfig, error) {
	item, err := attributevalue.MarshalMap(toWcItem(cfg))
	if err != nil {
		return app.WorkspaceConfig{}, err
	}
	if _, err := s.client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &s.table, Item: item}); err != nil {
		return app.WorkspaceConfig{}, err
	}
	return fromWcItem(toWcItem(cfg)), nil
}
