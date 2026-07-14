package cmd

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
)

// RunStats dispatches stats subcommands.
func RunStats(args []string) error {
	if len(args) == 0 || wantsHelp(args) {
		fmt.Print(helpStats)
		return nil
	}

	serverURL, rest := extractServerFlag(args)
	sub := rest[0]
	subArgs := rest[1:]

	switch sub {
	case "query":
		return statsQuery(serverURL, subArgs)
	default:
		fmt.Fprintf(os.Stderr, "Unknown subcommand: stats %s\n\n", sub)
		fmt.Print(helpStats)
		os.Exit(2)
	}
	return nil
}

func statsQuery(serverURL string, args []string) error {
	fs := newFlagSet("stats query")
	provider := fs.int("provider", 0, "Filter by provider ID")
	model := fs.string("model", "", "Filter by model name")
	user := fs.int("user", 0, "Filter by user ID")
	from := fs.string("from", "", "Start date (YYYY-MM-DD)")
	to := fs.string("to", "", "End date (YYYY-MM-DD)")
	fs.parse(args)

	params := url.Values{}
	if *provider != 0 {
		params.Set("provider", fmt.Sprintf("%d", *provider))
	}
	if *model != "" {
		params.Set("model", *model)
	}
	if *user != 0 {
		params.Set("user", fmt.Sprintf("%d", *user))
	}
	if *from != "" {
		params.Set("from", *from)
	}
	if *to != "" {
		params.Set("to", *to)
	}

	path := "/api/admin/stats"
	if len(params) > 0 {
		path = path + "?" + params.Encode()
	}

	body, status, err := httpJSONRequest(serverURL, "GET", path, nil)
	if err != nil {
		return err
	}
	if err := errHTTP(status, body); err != nil {
		return err
	}

	// Response may be array or wrapped
	var raw []map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		var wrapped struct {
			Stats []map[string]interface{} `json:"stats"`
			Data   []map[string]interface{} `json:"data"`
		}
		if err2 := json.Unmarshal(body, &wrapped); err2 == nil {
			if wrapped.Stats != nil {
				raw = wrapped.Stats
			} else if wrapped.Data != nil {
				raw = wrapped.Data
			}
		}
		if raw == nil {
			return fmt.Errorf("parse response: %w", err)
		}
	}

	headers := []string{"PROVIDER", "MODEL", "USER", "REQ_COUNT", "INPUT_TOK", "OUTPUT_TOK", "CACHED_TOK"}
	var rows [][]string
	for _, s := range raw {
		rows = append(rows, []string{
			strOrEmpty(s["provider"]),
			strOrEmpty(s["model"]),
			strOrEmpty(s["user"]),
			strOrEmpty(s["request_count"]),
			strOrEmpty(s["input_tokens"]),
			strOrEmpty(s["output_tokens"]),
			strOrEmpty(s["cached_tokens"]),
		})
	}
	if len(rows) == 0 {
		fmt.Println("No statistics found for the given filters.")
		return nil
	}
	printTable(headers, rows)
	return nil
}
