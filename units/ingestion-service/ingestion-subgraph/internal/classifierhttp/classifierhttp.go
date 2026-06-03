// Package classifierhttp is the app.Classifier adapter that calls the
// classification service's synchronous /classify HTTP endpoint. It keeps the
// router free of the TS classification engine — the engine stays in the
// classification service; the router just makes a request/response call.
package classifierhttp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	contracts "github.com/opus2/docuploader/libs/pipeline-contracts/go"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/app"
)

// Client posts to <baseURL>/classify and maps the ClassificationOutput response
// onto app.ClassificationResult.
type Client struct {
	baseURL string
	http    *http.Client
}

// New builds a Client for the classification service base URL (e.g.
// http://classification-http:8091). baseURL must not include the /classify path.
func New(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

type s3Ref struct {
	Bucket string `json:"bucket"`
	Key    string `json:"key"`
}

type classifyRequest struct {
	WorkspaceID string `json:"workspaceId"`
	DocumentID  string `json:"documentId"`
	S3          s3Ref  `json:"s3"`
	Hints       struct {
		Extension   *string `json:"extension"`
		ContentType *string `json:"contentType"`
	} `json:"hints"`
	Context *classifyContext `json:"context,omitempty"`
}

type classifyContext struct {
	ParentArchiveDepth     int  `json:"parentArchiveDepth"`
	OverrideDuplicateCheck bool `json:"overrideDuplicateCheck"`
}

type classifyResponse struct {
	DocumentID     string `json:"documentId"`
	WorkspaceID    string `json:"workspaceId"`
	Classification struct {
		Format            string  `json:"format"`
		Category          string  `json:"category"`
		SubCategory       *string `json:"subCategory"`
		ConfidenceScore   float64 `json:"confidenceScore"`
		DetectionTier     string  `json:"detectionTier"`
		IsForcedSlipsheet bool    `json:"isForcedSlipsheet"`
	} `json:"classification"`
	Dedup struct {
		ContentHash string `json:"contentHash"`
		IsDuplicate bool   `json:"isDuplicate"`
	} `json:"dedup"`
	PolicyVersion string `json:"policyVersion"`
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Classify POSTs to the classification endpoint and returns the flattened result.
func (c *Client) Classify(ctx context.Context, workspaceID, documentID string, source contracts.ClaimCheck, extension, contentType string) (app.ClassificationResult, error) {
	var reqBody classifyRequest
	reqBody.WorkspaceID = workspaceID
	reqBody.DocumentID = documentID
	reqBody.S3 = s3Ref{Bucket: source.Bucket, Key: source.Key}
	reqBody.Hints.Extension = optional(extension)
	reqBody.Hints.ContentType = optional(contentType)

	body, err := json.Marshal(reqBody)
	if err != nil {
		return app.ClassificationResult{}, fmt.Errorf("marshal classify request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/classify", bytes.NewReader(body))
	if err != nil {
		return app.ClassificationResult{}, fmt.Errorf("build classify request: %w", err)
	}
	req.Header.Set("content-type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return app.ClassificationResult{}, fmt.Errorf("call classify: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return app.ClassificationResult{}, fmt.Errorf("classify returned %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}

	var out classifyResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return app.ClassificationResult{}, fmt.Errorf("decode classify response: %w", err)
	}

	return app.ClassificationResult{
		DocumentID:        out.DocumentID,
		WorkspaceID:       out.WorkspaceID,
		Format:            out.Classification.Format,
		Category:          out.Classification.Category,
		SubCategory:       out.Classification.SubCategory,
		ConfidenceScore:   out.Classification.ConfidenceScore,
		DetectionTier:     out.Classification.DetectionTier,
		IsForcedSlipsheet: out.Classification.IsForcedSlipsheet,
		ContentHash:       out.Dedup.ContentHash,
		IsDuplicate:       out.Dedup.IsDuplicate,
		PolicyVersion:     out.PolicyVersion,
	}, nil
}

// ClassifyRaw POSTs to /classify and returns the FULL envelope as opaque maps:
// the nested ClassificationOutput on 200, or the ClassificationFailure on 422.
// Used by the classify write-path, which persists/returns the whole JSON.
func (c *Client) ClassifyRaw(ctx context.Context, in app.ClassifyRequest) (app.ClassifyAttempt, error) {
	var reqBody classifyRequest
	reqBody.WorkspaceID = in.WorkspaceID
	reqBody.DocumentID = in.DocumentID
	reqBody.S3 = s3Ref{Bucket: in.Source.Bucket, Key: in.Source.Key}
	reqBody.Hints.Extension = optional(in.Extension)
	reqBody.Hints.ContentType = optional(in.ContentType)
	reqBody.Context = &classifyContext{
		ParentArchiveDepth:     in.ParentArchiveDepth,
		OverrideDuplicateCheck: in.OverrideDuplicateCheck,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return app.ClassifyAttempt{}, fmt.Errorf("marshal classify request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/classify", bytes.NewReader(body))
	if err != nil {
		return app.ClassifyAttempt{}, fmt.Errorf("build classify request: %w", err)
	}
	req.Header.Set("content-type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return app.ClassifyAttempt{}, fmt.Errorf("call classify: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return app.ClassifyAttempt{}, fmt.Errorf("read classify response: %w", err)
	}

	if resp.StatusCode == http.StatusOK {
		var out map[string]any
		if err := json.Unmarshal(raw, &out); err != nil {
			return app.ClassifyAttempt{}, fmt.Errorf("decode classify result: %w", err)
		}
		return app.ClassifyAttempt{OK: true, Result: out}, nil
	}

	// Non-200 → { error: ClassificationFailure | string }. Normalize to a map.
	var envelope struct {
		Error json.RawMessage `json:"error"`
	}
	_ = json.Unmarshal(raw, &envelope)
	failure := map[string]any{"kind": "unknown", "reason": "classify-service-error"}
	if len(envelope.Error) > 0 {
		var asMap map[string]any
		if err := json.Unmarshal(envelope.Error, &asMap); err == nil {
			failure = asMap
		} else {
			var asStr string
			if err := json.Unmarshal(envelope.Error, &asStr); err == nil {
				failure = map[string]any{"kind": "unexpected", "message": asStr}
			}
		}
	}
	return app.ClassifyAttempt{OK: false, Failure: failure}, nil
}
