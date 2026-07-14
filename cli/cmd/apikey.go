package cmd

import (
	"encoding/json"
	"fmt"
	"os"
)

// RunApiKey dispatches apikey subcommands.
func RunApiKey(args []string) error {
	if len(args) == 0 || wantsHelp(args) {
		fmt.Print(helpApiKey)
		return nil
	}

	serverURL, rest := extractServerFlag(args)
	sub := rest[0]
	subArgs := rest[1:]

	switch sub {
	case "list":
		return apiKeyList(serverURL)
	case "create":
		return apiKeyCreate(serverURL, subArgs)
	case "delete":
		return apiKeyDelete(serverURL, subArgs)
	default:
		fmt.Fprintf(os.Stderr, "Unknown subcommand: apikey %s\n\n", sub)
		fmt.Print(helpApiKey)
		os.Exit(2)
	}
	return nil
}

func apiKeyList(serverURL string) error {
	body, status, err := httpJSONRequest(serverURL, "GET", "/api/admin/api-keys", nil)
	if err != nil {
		return err
	}
	if err := errHTTP(status, body); err != nil {
		return err
	}

	var raw []map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		var wrapped struct {
			Keys []map[string]interface{} `json:"api_keys"`
		}
		if err2 := json.Unmarshal(body, &wrapped); err2 == nil && wrapped.Keys != nil {
			raw = wrapped.Keys
		} else {
			return fmt.Errorf("parse response: %w", err)
		}
	}

	headers := []string{"ID", "NAME", "KEY_PREFIX", "NOTE", "ENABLED", "CREATED_AT"}
	var rows [][]string
	for _, k := range raw {
		rows = append(rows, []string{
			strOrEmpty(k["id"]),
			strOrEmpty(k["name"]),
			strOrEmpty(k["key_prefix"]),
			strOrEmpty(k["note"]),
			strOrEmpty(k["enabled"]),
			strOrEmpty(k["created_at"]),
		})
	}
	printTable(headers, rows)
	return nil
}

func apiKeyCreate(serverURL string, args []string) error {
	fs := newFlagSet("apikey create")
	name := fs.string("name", "", "Key name (required)")
	note := fs.string("note", "", "Optional description")
	fs.parse(args)

	if *name == "" {
		return fmt.Errorf("--name is required")
	}

	reqBody := map[string]string{
		"name": *name,
		"note": *note,
	}

	resp, status, err := httpJSONRequest(serverURL, "POST", "/api/admin/api-keys", reqBody)
	if err != nil {
		return err
	}
	if err := errHTTP(status, resp); err != nil {
		return err
	}

	// Try to extract the generated key
	var result map[string]interface{}
	if err := json.Unmarshal(resp, &result); err == nil {
		if key, ok := result["key"]; ok {
			fmt.Printf("API key created:\n  Name: %s\n  Key:  %s\n", *name, key)
			if id, ok := result["id"]; ok {
				fmt.Printf("  ID:   %v\n", id)
			}
			return nil
		}
	}

	// Fallback: print full JSON
	fmt.Println("API key created:")
	printJSON(resp)
	return nil
}

func apiKeyDelete(serverURL string, args []string) error {
	fs := newFlagSet("apikey delete")
	id := fs.int("id", 0, "Key ID (required)")
	fs.parse(args)

	if *id == 0 {
		return fmt.Errorf("--id is required")
	}

	path := fmt.Sprintf("/api/admin/api-keys/%d", *id)
	resp, status, err := httpJSONRequest(serverURL, "DELETE", path, nil)
	if err != nil {
		return err
	}
	if err := errHTTP(status, resp); err != nil {
		return err
	}
	fmt.Printf("API key %d deleted\n", *id)
	return nil
}
