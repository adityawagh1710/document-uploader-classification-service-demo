package awsadapters

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"
	contracts "github.com/opus2/docuploader/libs/pipeline-contracts/go"
	"github.com/opus2/docuploader/units/wundergraph-router/internal/app"
)

// SQSDispatcher sends a StageRequest to the target stage's queue. Implements
// app.Dispatcher. The stage→queueURL map is the demo's stages.yaml.
type SQSDispatcher struct {
	client    *sqs.Client
	queueURLs map[contracts.StageName]string
}

func NewSQSDispatcher(cfg aws.Config, opts Options, queueURLs map[contracts.StageName]string) *SQSDispatcher {
	c := sqs.NewFromConfig(cfg, func(o *sqs.Options) {
		if opts.LocalStackMode() {
			o.BaseEndpoint = aws.String(opts.Endpoint)
		}
	})
	return &SQSDispatcher{client: c, queueURLs: queueURLs}
}

func (d *SQSDispatcher) Dispatch(ctx context.Context, stage contracts.StageName, tenantID string, doc app.Document, source contracts.ClaimCheck, traceparent string) error {
	url, ok := d.queueURLs[stage]
	if !ok || url == "" {
		return fmt.Errorf("no queue configured for stage %q", stage)
	}
	req := app.BuildStageRequest(stage, tenantID, doc, source, traceparent)
	if err := req.Validate(); err != nil {
		return fmt.Errorf("invalid StageRequest: %w", err)
	}
	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal StageRequest: %w", err)
	}
	_, err = d.client.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:    aws.String(url),
		MessageBody: aws.String(string(body)),
		MessageAttributes: map[string]sqstypes.MessageAttributeValue{
			"traceparent":   {DataType: aws.String("String"), StringValue: aws.String(traceparent)},
			"schemaVersion": {DataType: aws.String("String"), StringValue: aws.String(contracts.SchemaVersion)},
		},
	})
	if err != nil {
		return fmt.Errorf("sqs send to %q: %w", stage, err)
	}
	return nil
}
