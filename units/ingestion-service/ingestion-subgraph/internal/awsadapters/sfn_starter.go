package awsadapters

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/app"
)

// SFNStarter implements app.PipelineStarter by starting an execution of the
// convert state machine. The execution input is the ConvertClaim JSON; the ASL
// dispatches it to the convert queue via sqs:sendMessage.waitForTaskToken and
// owns retries/timeout (replacing the convert-watchdog).
type SFNStarter struct {
	client     *sfn.Client
	convertARN string
	archiveARN string
}

func NewSFNStarter(cfg aws.Config, opts Options, convertARN, archiveARN string) *SFNStarter {
	c := sfn.NewFromConfig(cfg, func(o *sfn.Options) {
		if opts.LocalStackMode() {
			o.BaseEndpoint = aws.String(opts.Endpoint)
		}
	})
	return &SFNStarter{client: c, convertARN: convertARN, archiveARN: archiveARN}
}

// start is the shared StartExecution helper (execution name = documentId →
// idempotent; a duplicate name+input is a no-op on SFN).
func (s *SFNStarter) start(ctx context.Context, arn, documentID string, claim any) error {
	if arn == "" {
		return app.ErrPipelineNotConfigured
	}
	input, err := json.Marshal(claim)
	if err != nil {
		return fmt.Errorf("marshal claim: %w", err)
	}
	_, err = s.client.StartExecution(ctx, &sfn.StartExecutionInput{
		StateMachineArn: aws.String(arn),
		Name:            aws.String(documentID),
		Input:           aws.String(string(input)),
	})
	if err != nil {
		return fmt.Errorf("start execution: %w", err)
	}
	return nil
}

func (s *SFNStarter) StartConvert(ctx context.Context, claim app.ConvertClaim) error {
	return s.start(ctx, s.convertARN, claim.DocumentID, claim)
}

func (s *SFNStarter) StartArchive(ctx context.Context, claim app.ArchiveClaim) error {
	return s.start(ctx, s.archiveARN, claim.DocumentID, claim)
}
