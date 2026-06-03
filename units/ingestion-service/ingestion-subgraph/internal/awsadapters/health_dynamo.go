package awsadapters

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

// DynamoHealthChecker implements app.HealthChecker by probing DynamoDB
// connectivity (ListTables) — the router's analogue of the UI's old /api/health
// readiness check.
type DynamoHealthChecker struct {
	client *dynamodb.Client
}

func NewDynamoHealthChecker(cfg aws.Config, opts Options) *DynamoHealthChecker {
	c := dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
		if opts.LocalStackMode() {
			o.BaseEndpoint = aws.String(opts.Endpoint)
		}
	})
	return &DynamoHealthChecker{client: c}
}

func (h *DynamoHealthChecker) ListTables(ctx context.Context) ([]string, error) {
	out, err := h.client.ListTables(ctx, &dynamodb.ListTablesInput{})
	if err != nil {
		return nil, err
	}
	return out.TableNames, nil
}
