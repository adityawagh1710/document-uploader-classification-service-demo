// Package awsadapters implements the app ports (Store/Uploader/Dispatcher)
// against real AWS — endpoint-configurable so the same code runs on LocalStack
// (local) and real AWS (dev05). On LocalStack we inject static dummy creds; on
// real AWS the default chain (IRSA) is used.
package awsadapters

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
)

// Options configures the AWS clients.
type Options struct {
	Region   string
	Endpoint string // LocalStack endpoint (e.g. http://localstack:4566); empty = real AWS
}

// LocalStackMode reports whether an endpoint override is set.
func (o Options) LocalStackMode() bool { return o.Endpoint != "" }

// LoadConfig builds an aws.Config. In LocalStack mode it injects static creds;
// otherwise it relies on the default credential chain (IRSA on dev05).
func LoadConfig(ctx context.Context, o Options) (aws.Config, error) {
	opts := []func(*config.LoadOptions) error{config.WithRegion(o.Region)}
	if o.LocalStackMode() {
		opts = append(opts, config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider("test", "test", ""),
		))
	}
	return config.LoadDefaultConfig(ctx, opts...)
}
