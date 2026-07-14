package cmd

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

// flagHelper wraps flag.FlagSet with convenience methods for string/int flags.
type flagHelper struct {
	fs *flag.FlagSet
}

func newFlagSet(name string) *flagHelper {
	return &flagHelper{fs: flag.NewFlagSet(name, flag.ExitOnError)}
}

func (f *flagHelper) string(name, def, usage string) *string {
	return f.fs.String(name, def, usage)
}

func (f *flagHelper) int(name string, def int, usage string) *int {
	return f.fs.Int(name, def, usage)
}

func (f *flagHelper) parse(args []string) {
	// Set Usage to print nothing; we handle help ourselves.
	f.fs.Usage = func() {}
	_ = f.fs.Parse(args)
}

// RunProvider dispatches provider subcommands.
func RunProvider(args []string) error {
	if len(args) == 0 || wantsHelp(args) {
		fmt.Print(helpProvider)
		return nil
	}

	serverURL, rest := extractServerFlag(args)
	sub := rest[0]
	subArgs := rest[1:]

	switch sub {
	case "list":
		return providerList(serverURL)
	case "add":
		return providerAdd(serverURL, subArgs)
	case "edit":
		return providerEdit(serverURL, subArgs)
	case "delete":
		return providerDelete(serverURL, subArgs)
	case "health":
		return providerHealth(serverURL, subArgs)
	case "models":
		return providerModels(serverURL, subArgs)
	case "set-default":
		return providerSetDefault(serverURL, subArgs)
	default:
		fmt.Fprintf(os.Stderr, "Unknown subcommand: provider %s\n\n", sub)
		fmt.Print(helpProvider)
		os.Exit(2)
	}
	return nil
}

func providerList(serverURL string) error {
	body, status, err := httpJSONRequest(serverURL, "GET", "/api/admin/providers", nil)
	if err != nil {
		return err
	}
	if err := errHTTP(status, body); err != nil {
		return err
	}

	var raw []map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		// Try wrapped form {"providers": [...]}
		var wrapped struct {
			Providers []map[string]interface{} `json:"providers"`
		}
		if err2 := json.Unmarshal(body, &wrapped); err2 == nil && wrapped.Providers != nil {
			raw = wrapped.Providers
		} else {
			return fmt.Errorf("parse response: %w", err)
		}
	}

	headers := []string{"ID", "NAME", "PROTOCOL", "BASE_URL", "DEFAULT_MODEL", "ENABLED"}
	var rows [][]string
	for _, p := range raw {
		rows = append(rows, []string{
			strOrEmpty(p["id"]),
			strOrEmpty(p["name"]),
			strOrEmpty(p["protocol"]),
			strOrEmpty(p["base_url"]),
			strOrEmpty(p["default_model"]),
			strOrEmpty(p["enabled"]),
		})
	}
	printTable(headers, rows)
	return nil
}

func providerAdd(serverURL string, args []string) error {
	fs := newFlagSet("provider add")
	name := fs.string("name", "", "Provider name (required)")
	protocol := fs.string("protocol", "", "Protocol: openai|anthropic (required)")
	baseURL := fs.string("base-url", "", "API base URL (required)")
	apiKey := fs.string("api-key", "", "API key (required)")
	fs.parse(args)

	if *name == "" || *protocol == "" || *baseURL == "" || *apiKey == "" {
		return fmt.Errorf("--name, --protocol, --base-url, --api-key are all required")
	}

	reqBody := map[string]string{
		"name":     *name,
		"protocol": *protocol,
		"base_url": *baseURL,
		"api_key":  *apiKey,
	}

	resp, status, err := httpJSONRequest(serverURL, "POST", "/api/admin/providers", reqBody)
	if err != nil {
		return err
	}
	if err := errHTTP(status, resp); err != nil {
		return err
	}
	fmt.Println("Provider created:")
	printJSON(resp)
	return nil
}

func providerEdit(serverURL string, args []string) error {
	fs := newFlagSet("provider edit")
	id := fs.int("id", 0, "Provider ID (required)")
	name := fs.string("name", "", "New name")
	protocol := fs.string("protocol", "", "New protocol")
	baseURL := fs.string("base-url", "", "New base URL")
	apiKey := fs.string("api-key", "", "New API key")
	fs.parse(args)

	if *id == 0 {
		return fmt.Errorf("--id is required")
	}

	body := map[string]interface{}{}
	if *name != "" {
		body["name"] = *name
	}
	if *protocol != "" {
		body["protocol"] = *protocol
	}
	if *baseURL != "" {
		body["base_url"] = *baseURL
	}
	if *apiKey != "" {
		body["api_key"] = *apiKey
	}
	if len(body) == 0 {
		return fmt.Errorf("at least one of --name, --protocol, --base-url, --api-key must be provided")
	}

	path := fmt.Sprintf("/api/admin/providers/%d", *id)
	resp, status, err := httpJSONRequest(serverURL, "PUT", path, body)
	if err != nil {
		return err
	}
	if err := errHTTP(status, resp); err != nil {
		return err
	}
	fmt.Printf("Provider %d updated:\n", *id)
	printJSON(resp)
	return nil
}

func providerDelete(serverURL string, args []string) error {
	fs := newFlagSet("provider delete")
	id := fs.int("id", 0, "Provider ID (required)")
	fs.parse(args)

	if *id == 0 {
		return fmt.Errorf("--id is required")
	}

	path := fmt.Sprintf("/api/admin/providers/%d", *id)
	resp, status, err := httpJSONRequest(serverURL, "DELETE", path, nil)
	if err != nil {
		return err
	}
	if err := errHTTP(status, resp); err != nil {
		return err
	}
	fmt.Printf("Provider %d deleted\n", *id)
	return nil
}

func providerHealth(serverURL string, args []string) error {
	fs := newFlagSet("provider health")
	id := fs.int("id", 0, "Provider ID (required)")
	fs.parse(args)

	if *id == 0 {
		return fmt.Errorf("--id is required")
	}

	path := fmt.Sprintf("/api/admin/providers/%d/health", *id)
	resp, status, err := httpJSONRequest(serverURL, "POST", path, nil)
	if err != nil {
		return err
	}
	if err := errHTTP(status, resp); err != nil {
		return err
	}
	fmt.Printf("Health check for provider %d:\n", *id)
	printJSON(resp)
	return nil
}

func providerModels(serverURL string, args []string) error {
	fs := newFlagSet("provider models")
	id := fs.int("id", 0, "Provider ID (required)")
	fs.parse(args)

	if *id == 0 {
		return fmt.Errorf("--id is required")
	}

	path := fmt.Sprintf("/api/admin/providers/%d/models", *id)
	body, status, err := httpJSONRequest(serverURL, "GET", path, nil)
	if err != nil {
		return err
	}
	if err := errHTTP(status, body); err != nil {
		return err
	}

	var raw []map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		var wrapped struct {
			Models []map[string]interface{} `json:"models"`
		}
		if err2 := json.Unmarshal(body, &wrapped); err2 == nil && wrapped.Models != nil {
			raw = wrapped.Models
		} else {
			return fmt.Errorf("parse response: %w", err)
		}
	}

	headers := []string{"MODEL_ID", "NAME", "IS_DEFAULT", "ENABLED"}
	var rows [][]string
	for _, m := range raw {
		rows = append(rows, []string{
			strOrEmpty(m["model_id"]),
			strOrEmpty(m["name"]),
			strOrEmpty(m["is_default"]),
			strOrEmpty(m["enabled"]),
		})
	}
	printTable(headers, rows)
	return nil
}

func providerSetDefault(serverURL string, args []string) error {
	fs := newFlagSet("provider set-default")
	id := fs.int("id", 0, "Provider ID (required)")
	modelID := fs.string("model-id", "", "Model ID to set as default (required)")
	fs.parse(args)

	if *id == 0 || *modelID == "" {
		return fmt.Errorf("--id and --model-id are both required")
	}

	path := fmt.Sprintf("/api/admin/providers/%d/models/%s/default", *id, *modelID)
	resp, status, err := httpJSONRequest(serverURL, "PUT", path, nil)
	if err != nil {
		return err
	}
	if err := errHTTP(status, resp); err != nil {
		return err
	}
	fmt.Printf("Default model set for provider %d: %s\n", *id, *modelID)
	return nil
}

func strOrEmpty(v interface{}) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%v", v)
}
