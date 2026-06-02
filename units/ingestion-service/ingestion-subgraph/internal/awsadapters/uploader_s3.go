package awsadapters

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	contracts "github.com/opus2/docuploader/libs/pipeline-contracts/go"
)

// S3Uploader mints presigned PUT URLs (client uploads bytes straight to S3) and
// returns the claim-check pointer that crosses the wire. Implements app.Uploader.
type S3Uploader struct {
	presign *s3.PresignClient
	bucket  string
	expiry  time.Duration
}

func NewS3Uploader(cfg aws.Config, opts Options, bucket string) *S3Uploader {
	c := s3.NewFromConfig(cfg, func(o *s3.Options) {
		if opts.LocalStackMode() {
			o.BaseEndpoint = aws.String(opts.Endpoint)
			o.UsePathStyle = true // LocalStack S3 needs path-style addressing
		}
	})
	return &S3Uploader{presign: s3.NewPresignClient(c), bucket: bucket, expiry: 15 * time.Minute}
}

func (u *S3Uploader) Presign(ctx context.Context, tenantID, documentID, filename string) (string, contracts.ClaimCheck, error) {
	key := fmt.Sprintf("tenants/%s/%s/%s", tenantID, documentID, filename)
	req, err := u.presign.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(u.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(u.expiry))
	if err != nil {
		return "", contracts.ClaimCheck{}, fmt.Errorf("presign put: %w", err)
	}
	return req.URL, contracts.ClaimCheck{Bucket: u.bucket, Key: key}, nil
}
