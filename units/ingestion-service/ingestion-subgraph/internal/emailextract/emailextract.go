// Package emailextract is the app.EmailExtractor adapter that fans an uploaded
// email file out to the email-extraction service over HTTP. It mirrors the UI's
// old classify-route email fan-out: POST the raw bytes to
// {baseURL}/upload?tenant=&document=&message= and return the parsed JSON.
package emailextract

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Client posts to <baseURL>/upload.
type Client struct {
	baseURL string
	http    *http.Client
}

// New builds a Client for the email-extraction service base URL. An empty
// baseURL means the caller should treat the fan-out as disabled (the router
// leaves EmailExtractor nil in that case).
func New(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

// Extract POSTs the file bytes and returns the parsed extraction payload.
func (c *Client) Extract(ctx context.Context, workspaceID, documentID string, body []byte) (map[string]any, error) {
	messageID := uuid.NewString()
	u := fmt.Sprintf("%s/upload?tenant=%s&document=%s&message=%s",
		c.baseURL,
		url.QueryEscape(workspaceID),
		url.QueryEscape(documentID),
		url.QueryEscape(messageID),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build email request: %w", err)
	}
	req.Header.Set("content-type", "application/octet-stream")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call email-extraction: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("email-extraction %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}

	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		// Upload accepted but body wasn't JSON — dispatch still counts as ok,
		// just nothing to cache. Return an empty map (not an error).
		return map[string]any{}, nil
	}
	return out, nil
}
