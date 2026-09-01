package modelmap

import (
	"fmt"
	"strings"

	"server-go/internal/db"
)

type Provider struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Protocol  string `json:"protocol"`
	BaseURL   string `json:"base_url"`
	APIKey    string `json:"api_key"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	DeletedAt *string `json:"deleted_at"`
}

type Entry struct {
	ModelID             int64     `json:"__modelId"`
	IsDefault           bool      `json:"__isDefault"`
	IsDefaultEmbedding  bool      `json:"__isDefaultEmbedding"`
	Capability          string    `json:"capability"`
	Provider            Provider  `json:"provider"`
	ModelName           string    `json:"model_name"`
	Protocol            string    `json:"protocol"`
	Endpoint            string    `json:"endpoint"`
	Headers             map[string]string `json:"headers"`
	InputPrice          float64   `json:"input_price"`     // ponytail: USD per 1M tokens
	OutputPrice         float64   `json:"output_price"`
	CacheHitPrice       float64   `json:"cache_hit_price"`
}

var (
	_map                = map[string]*Entry{}
	_defaultEntry       *Entry
	_defaultEmbeddingEntry *Entry
)

func computeEndpoint(p Provider, capability string) string {
	base := strings.TrimRight(p.BaseURL, "/")
	if capability == "embedding" {
		return base + "/embeddings"
	}
	if p.Protocol == "openai" {
		return base + "/chat/completions"
	}
	return base + "/v1/messages"
}

func computeHeaders(p Provider) map[string]string {
	if p.Protocol == "openai" {
		return map[string]string{
			"Authorization": "Bearer " + p.APIKey,
			"Content-Type":  "application/json",
		}
	}
	return map[string]string{
		"x-api-key":         p.APIKey,
		"Content-Type":      "application/json",
		"anthropic-version": "2023-06-01",
	}
}

func toFloat(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int64:
		return float64(n)
	case int:
		return float64(n)
	}
	return 0
}

func RebuildModelMap() error {
	d := db.Get()
	provRows, err := d.Query("SELECT * FROM providers")
	if err != nil {
		return err
	}
	pMap := map[int64]Provider{}
	for _, r := range provRows {
		p := Provider{
			ID:       db.Int64(r["id"]),
			Name:     db.Str(r["name"]),
			Protocol: db.Str(r["protocol"]),
			BaseURL:  db.Str(r["base_url"]),
			APIKey:   db.Str(r["api_key"]),
		}
		pMap[p.ID] = p
	}
	modelRows, err := d.Query("SELECT * FROM models WHERE deleted_at IS NULL AND (is_disabled IS NULL OR is_disabled=0)")
	if err != nil {
		return err
	}
	next := map[string]*Entry{}
	var def *Entry
	var defEmb *Entry
	for _, m := range modelRows {
		pid := db.Int64(m["provider_id"])
		p, ok := pMap[pid]
		if !ok {
			continue
		}
		cap := db.Str(m["capability"])
		if cap == "" {
			cap = "chat"
		}
		entry := &Entry{
			ModelID:            db.Int64(m["id"]),
			IsDefault:          db.Int64(m["is_default"]) == 1,
			IsDefaultEmbedding: db.Int64(m["is_default_embedding"]) == 1,
			Capability:         cap,
			Provider:           p,
			ModelName:          db.Str(m["model_name"]),
			Protocol:           p.Protocol,
			Endpoint:           computeEndpoint(p, cap),
			Headers:            computeHeaders(p),
			InputPrice:         toFloat(m["input_price"]),
			OutputPrice:        toFloat(m["output_price"]),
			CacheHitPrice:      toFloat(m["cache_hit_price"]),
		}
		key := p.Name + "_" + entry.ModelName
		next[key] = entry
		if entry.IsDefault {
			def = entry
		}
		if entry.IsDefaultEmbedding {
			defEmb = entry
		}
	}
	_map = next
	_defaultEntry = def
	_defaultEmbeddingEntry = defEmb
	return nil
}

func GetModelMap() map[string]*Entry { return _map }
func GetDefaultEntry() *Entry {
	if _defaultEntry != nil {
		return _defaultEntry
	}
	for _, e := range _map {
		return e
	}
	return nil
}
func GetDefaultEmbeddingEntry() *Entry {
	return _defaultEmbeddingEntry
}
func GetEntry(modelField string) *Entry { return _map[modelField] }

func ResolveEntryFor(assignedModelID int64, bodyModel string) *Entry {
	if assignedModelID > 0 {
		for _, e := range _map {
			if e.ModelID == assignedModelID {
				return e
			}
		}
		return nil
	}
	field := bodyModel
	if field == "auto" || field == "Nantianmen-default" || field == "" {
		return GetDefaultEntry()
	}
	return GetEntry(field)
}

func ResolveModel(modelField string) (*Entry, error) {
	if modelField == "auto" || modelField == "Nantianmen-default" || modelField == "" {
		e := GetDefaultEntry()
		if e == nil {
			return nil, fmt.Errorf("no models configured")
		}
		return e, nil
	}
	e := GetEntry(modelField)
	if e == nil {
		return nil, fmt.Errorf("unknown model: %s", modelField)
	}
	return e, nil
}

// ponytail: resolve model for /v1/embeddings. "Nantianmen-default-embedding" / "auto" / "" → default embedding model.
func ResolveEmbeddingModel(modelField string) (*Entry, error) {
	if modelField == "auto" || modelField == "Nantianmen-default-embedding" || modelField == "" {
		e := GetDefaultEmbeddingEntry()
		if e == nil {
			return nil, fmt.Errorf("no default embedding model configured")
		}
		return e, nil
	}
	e := GetEntry(modelField)
	if e == nil {
		return nil, fmt.Errorf("unknown model: %s", modelField)
	}
	return e, nil
}
