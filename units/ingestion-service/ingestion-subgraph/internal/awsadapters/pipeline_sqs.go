package awsadapters

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/app"
)

// SQSPipelineDispatcher emits the UI-compatible archive/convert claim bodies to
// their respective queues. The message body is exactly json.Marshal(claim) —
// byte-compatible with the UI's createSqs{Archive,Convert}Dispatcher (which did
// JSON.stringify(claim)) so the existing workers consume it unchanged.
// Implements app.PipelineDispatcher.
type SQSPipelineDispatcher struct {
	client     *sqs.Client
	archiveURL string
	convertURL string
}

func NewSQSPipelineDispatcher(cfg aws.Config, opts Options, archiveQueueURL, convertQueueURL string) *SQSPipelineDispatcher {
	c := sqs.NewFromConfig(cfg, func(o *sqs.Options) {
		if opts.LocalStackMode() {
			o.BaseEndpoint = aws.String(opts.Endpoint)
		}
	})
	return &SQSPipelineDispatcher{client: c, archiveURL: archiveQueueURL, convertURL: convertQueueURL}
}

func (d *SQSPipelineDispatcher) DispatchArchive(ctx context.Context, claim app.ArchiveClaim) error {
	if d.archiveURL == "" {
		return app.ErrQueueNotConfigured
	}
	return d.send(ctx, d.archiveURL, claim)
}

func (d *SQSPipelineDispatcher) DispatchConvert(ctx context.Context, claim app.ConvertClaim) error {
	if d.convertURL == "" {
		return app.ErrQueueNotConfigured
	}
	return d.send(ctx, d.convertURL, claim)
}

func (d *SQSPipelineDispatcher) send(ctx context.Context, queueURL string, claim any) error {
	body, err := json.Marshal(claim)
	if err != nil {
		return fmt.Errorf("marshal claim: %w", err)
	}
	if _, err := d.client.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:    aws.String(queueURL),
		MessageBody: aws.String(string(body)),
	}); err != nil {
		return fmt.Errorf("sqs send: %w", err)
	}
	return nil
}
