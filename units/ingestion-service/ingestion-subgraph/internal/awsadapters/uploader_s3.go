package awsadapters

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	smithy "github.com/aws/smithy-go"
	contracts "github.com/opus2/docuploader/libs/pipeline-contracts/go"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/app"
)

// S3Uploader mints presigned PUT URLs (client uploads bytes straight to S3) and
// returns the claim-check pointer that crosses the wire. It also implements
// app.ObjectStore (HeadObject + presigned GET downloads) so the UI never holds
// an S3 client. Implements app.Uploader + app.ObjectStore.
type S3Uploader struct {
	client *s3.Client
	// presign signs against the server-reachable endpoint (uploads land here).
	presign *s3.PresignClient
	// presignPublic signs GET URLs against a BROWSER-reachable host (LocalStack
	// uses S3_PUBLIC_ENDPOINT; real AWS reuses the regional public endpoint).
	presignPublic *s3.PresignClient
	bucket        string
	expiry        time.Duration
}

func NewS3Uploader(cfg aws.Config, opts Options, bucket string) *S3Uploader {
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		if opts.LocalStackMode() {
			o.BaseEndpoint = aws.String(opts.Endpoint)
			o.UsePathStyle = true // LocalStack S3 needs path-style addressing
		}
	})
	presign := s3.NewPresignClient(client)

	// Public presign client: in LocalStack mode the server talks to
	// localstack:4566 (which the host browser can't resolve), so sign download
	// URLs against a browser-reachable endpoint instead. In AWS mode the
	// regional endpoint is already public — reuse the same presigner.
	presignPublic := presign
	if opts.LocalStackMode() {
		publicEndpoint := opts.PublicEndpoint
		if publicEndpoint == "" {
			publicEndpoint = opts.Endpoint
		}
		publicClient := s3.NewFromConfig(cfg, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(publicEndpoint)
			o.UsePathStyle = true
		})
		presignPublic = s3.NewPresignClient(publicClient)
	}

	return &S3Uploader{
		client:        client,
		presign:       presign,
		presignPublic: presignPublic,
		bucket:        bucket,
		expiry:        15 * time.Minute,
	}
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

// PresignUpload mints a presigned PUT under the UI's own `ui/{documentId}/
// {filename}` prefix. Content-type is intentionally not signed so the client's
// streaming PUT can't be rejected for a header mismatch.
func (u *S3Uploader) PresignUpload(ctx context.Context, documentID, filename, _ string) (string, contracts.ClaimCheck, error) {
	key := fmt.Sprintf("ui/%s/%s", documentID, filename)
	req, err := u.presign.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(u.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(u.expiry))
	if err != nil {
		return "", contracts.ClaimCheck{}, fmt.Errorf("presign upload: %w", err)
	}
	return req.URL, contracts.ClaimCheck{Bucket: u.bucket, Key: key}, nil
}

// GetObject reads the full object body (used by the email fan-out).
func (u *S3Uploader) GetObject(ctx context.Context, bucket, key string) ([]byte, error) {
	out, err := u.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	return io.ReadAll(out.Body)
}

// Head returns S3 object metadata, or (nil, nil) when the object is absent —
// the UI's runs route renders s3Object: null in that case.
func (u *S3Uploader) Head(ctx context.Context, bucket, key string) (*app.S3ObjectMeta, error) {
	out, err := u.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if isNotFound(err) {
			return nil, nil
		}
		return nil, err
	}
	meta := &app.S3ObjectMeta{Key: key}
	if out.ContentLength != nil {
		meta.Size = out.ContentLength
	}
	if out.ContentType != nil {
		meta.ContentType = out.ContentType
	}
	if out.ETag != nil {
		meta.ETag = out.ETag
	}
	if out.LastModified != nil {
		iso := out.LastModified.UTC().Format(time.RFC3339)
		meta.LastModified = &iso
	}
	return meta, nil
}

// PresignDownload mints a short-lived (5 min) browser-reachable GET URL. An
// empty contentType omits the ResponseContentType override.
func (u *S3Uploader) PresignDownload(ctx context.Context, bucket, key, contentDisposition, contentType string) (string, error) {
	in := &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)}
	if contentDisposition != "" {
		in.ResponseContentDisposition = aws.String(contentDisposition)
	}
	if contentType != "" {
		in.ResponseContentType = aws.String(contentType)
	}
	req, err := u.presignPublic.PresignGetObject(ctx, in, s3.WithPresignExpires(5*time.Minute))
	if err != nil {
		return "", fmt.Errorf("presign get: %w", err)
	}
	return req.URL, nil
}

func isNotFound(err error) bool {
	var ae smithy.APIError
	if errors.As(err, &ae) {
		switch ae.ErrorCode() {
		case "NotFound", "NoSuchKey", "404":
			return true
		}
	}
	return false
}
