package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"text/tabwriter"
)

// getServerURL resolves the server base URL.
// Priority: --server flag > NANTIANMEN_SERVER env > default.
func getServerURL(flagOverride string) string {
	if flagOverride != "" {
		return normalizeURL(flagOverride)
	}
	if env := os.Getenv("NANTIANMEN_SERVER"); env != "" {
		return normalizeURL(env)
	}
	return "http://127.0.0.1:7300"
}

func normalizeURL(u string) string {
	u = strings.TrimRight(u, "/")
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		u = "http://" + u
	}
	return u
}

// extractServerFlag scans args for --server and returns its value + remaining args.
func extractServerFlag(args []string) (string, []string) {
	var serverURL string
	var rest []string
	for i := 0; i < len(args); i++ {
		if args[i] == "--server" && i+1 < len(args) {
			serverURL = args[i+1]
			i++
		} else if strings.HasPrefix(args[i], "--server=") {
			serverURL = strings.TrimPrefix(args[i], "--server=")
		} else {
			rest = append(rest, args[i])
		}
	}
	return serverURL, rest
}

// httpJSONRequest sends a request and returns the raw response body.
// If body is non-nil it's JSON-encoded. Returns response body bytes.
func httpJSONRequest(serverURL, method, path string, body interface{}) ([]byte, int, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	reqURL := serverURL + path
	req, err := http.NewRequest(method, reqURL, bodyReader)
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("request %s %s: %w", method, reqURL, err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}
	return data, resp.StatusCode, nil
}

// httpJSONRequestWithQuery same as httpJSONRequest but appends query params.
func httpJSONRequestWithQuery(serverURL, method, path string, body interface{}, params string) ([]byte, int, error) {
	if params != "" {
		path = path + "?" + params
	}
	return httpJSONRequest(serverURL, method, path, body)
}

// printTable prints headers + rows as a formatted table using tabwriter.
func printTable(headers []string, rows [][]string) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	for _, h := range headers {
		fmt.Fprintf(w, "%s\t", h)
	}
	fmt.Fprintln(w)
	for _, row := range rows {
		for _, cell := range row {
			fmt.Fprintf(w, "%s\t", cell)
		}
		fmt.Fprintln(w)
	}
	w.Flush()
}

// printJSON pretty-prints a JSON byte slice.
func printJSON(data []byte) {
	var buf bytes.Buffer
	if json.Indent(&buf, data, "", "  ") == nil {
		fmt.Println(buf.String())
		return
	}
	// Not valid JSON, print raw
	fmt.Println(string(data))
}

// errHTTP checks status code and returns error with body if not 2xx.
func errHTTP(status int, body []byte) error {
	if status >= 200 && status < 300 {
		return nil
	}
	// Try to extract error message from JSON
	var m map[string]interface{}
	if json.Unmarshal(body, &m) == nil {
		if detail, ok := m["detail"]; ok {
			return fmt.Errorf("HTTP %d: %v", status, detail)
		}
		if msg, ok := m["message"]; ok {
			return fmt.Errorf("HTTP %d: %v", status, msg)
		}
	}
	return fmt.Errorf("HTTP %d: %s", status, string(body))
}

// findServerURL is a convenience for commands that need both the URL and
// to parse remaining flags. Returns serverURL and non-server args.
func findServerURL(args []string) (string, []string) {
	return extractServerFlag(args)
}
