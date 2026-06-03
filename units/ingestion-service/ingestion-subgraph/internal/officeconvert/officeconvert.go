// Package officeconvert is the app.ConvertProgressClient adapter that polls the
// office-convert service's per-job progress endpoint. It mirrors the UI's old
// runs/[documentId]/progress route: GET /v1/jobs/{requestId}/progress with a
// short timeout so a hung office-convert pod can't block the router.
package officeconvert

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client polls <baseURL>/v1/jobs/{requestId}/progress.
type Client struct {
	baseURL string
	http    *http.Client
}

// New builds a Client for the office-convert base URL (in-cluster Service DNS on
// dev05). baseURL must not include the /v1 path.
func New(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 3 * time.Second},
	}
}

// Progress returns the parsed progress JSON, or (nil, error) on non-2xx /
// transport failure — the resolver maps that onto progress: null + a reason.
func (c *Client) Progress(ctx context.Context, requestID string) (map[string]any, error) {
	u := fmt.Sprintf("%s/v1/jobs/%s/progress", c.baseURL, url.PathEscape(requestID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("build progress request: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call office-convert: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("office_convert_%d", resp.StatusCode)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode progress: %w", err)
	}
	return out, nil
}
