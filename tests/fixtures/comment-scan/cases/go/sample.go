package sample

// Client wraps the upstream HTTP client.
type Client struct {
	baseURL string
}

/* DefaultTimeout is used when the caller does not override it. */
const defaultTimeout = 30

func (c *Client) URL() string {
	return c.baseURL // absolute, never empty
}
