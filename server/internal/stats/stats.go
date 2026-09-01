package stats

import (
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"server-go/internal/db"
)

type RecordInput struct {
	APIKeyID     int64
	ProviderID   int64
	ModelID      int64
	ModelName    string
	RequestCount int
	InputTokens  int
	OutputTokens int
	CachedTokens int
	Cost         float64 // ponytail: v0.4.24 — USD at request time, written once, immune to later price edits
}

type bucketKey string

var (
	buffer    = sync.Map{}
	lastFlush = time.Now()
	mu        sync.Mutex
)

func Acquire() { /* not used in Go impl */ }
func Release() { /* not used in Go impl */ }

func key(r RecordInput) bucketKey {
	return bucketKey(fmt.Sprintf("%d|%d|%d|%s", r.APIKeyID, r.ModelID, r.ProviderID, r.ModelName))
}

func Record(r RecordInput) {
	k := key(r)
	mu.Lock()
	if v, ok := buffer.Load(k); ok {
		cur := v.(*RecordInput)
		cur.RequestCount += max(r.RequestCount, 1)
		cur.InputTokens += r.InputTokens
		cur.OutputTokens += r.OutputTokens
		cur.CachedTokens += r.CachedTokens
		cur.Cost += r.Cost
	} else {
		cp := r
		if cp.RequestCount == 0 {
			cp.RequestCount = 1
		}
		buffer.Store(k, &cp)
	}
	if time.Since(lastFlush) > 10*time.Second {
		go Flush()
	}
	mu.Unlock()
}

func Flush() {
	mu.Lock()
	var rows []*RecordInput
	buffer.Range(func(k, v interface{}) bool {
		rows = append(rows, v.(*RecordInput))
		buffer.Delete(k)
		return true
	})
	lastFlush = time.Now()
	mu.Unlock()
	if len(rows) == 0 {
		return
	}
	d := db.Get()
	for _, r := range rows {
		if _, err := d.Run("INSERT INTO usage_stats(api_key_id, provider_id, model_id, model_name, request_count, input_tokens, output_tokens, cached_tokens, cost) VALUES (?,?,?,?,?,?,?,?,?)",
			r.APIKeyID, r.ProviderID, r.ModelID, r.ModelName, r.RequestCount, r.InputTokens, r.OutputTokens, r.CachedTokens, r.Cost); err != nil {
			log.Printf("[stats] flush insert error: %v", err)
		}
	}
}

var flushTicker *time.Ticker

func StartFlushTask() {
	if flushTicker != nil {
		return
	}
	flushTicker = time.NewTicker(10 * time.Second)
	go func() {
		for range flushTicker.C {
			Flush()
		}
	}()
}

func StopFlushTask() {
	if flushTicker != nil {
		flushTicker.Stop()
	}
}

type StatsQuery struct {
	ProviderID int64
	ModelName  string
	APIKeyID   int64
	Range      string
	Capability string // ponytail: empty = all; "chat" or "embedding"
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

func Query(q StatsQuery) (map[string]interface{}, error) {
	d := db.Get()
	where := []string{}
	params := []interface{}{}
	if q.ProviderID > 0 {
		where = append(where, "u.provider_id=?")
		params = append(params, q.ProviderID)
	}
	if q.ModelName != "" {
		where = append(where, "u.model_name=?")
		params = append(params, q.ModelName)
	}
	if q.APIKeyID > 0 {
		where = append(where, "u.api_key_id=?")
		params = append(params, q.APIKeyID)
	}
	if q.Capability != "" {
		// ponytail: COALESCE(m.capability, m_legacy.capability, 'chat') AS capability
		where = append(where, "COALESCE(m.capability, m_legacy.capability, 'chat') = ?")
		params = append(params, q.Capability)
	}
	switch q.Range {
	case "today":
		where = append(where, "datetime(u.created_at,'localtime') >= date('now','localtime')")
	case "7d":
		where = append(where, "datetime(u.created_at,'localtime') >= date('now','-7 days','localtime')")
	case "30d":
		where = append(where, "datetime(u.created_at,'localtime') >= date('now','-30 days','localtime')")
	}
	w := ""
	if len(where) > 0 {
		w = "WHERE " + strings.Join(where, " AND ")
	}

	sql := "SELECT p.name AS provider, u.model_name, u.api_key_id, k.name AS key_name, " +
		"COALESCE(m.model_name, u.model_name) AS current_model_name, " +
		"COALESCE(m.input_price, m_legacy.input_price, 0) AS input_price, " +
		"COALESCE(m.output_price, m_legacy.output_price, 0) AS output_price, " +
		"COALESCE(m.cache_hit_price, m_legacy.cache_hit_price, 0) AS cache_hit_price, " +
		"COALESCE(m.capability, m_legacy.capability, 'chat') AS capability, " +
		"SUM(u.request_count) AS request_count, " +
		"SUM(u.input_tokens) AS input_tokens, " +
		"SUM(u.output_tokens) AS output_tokens, " +
		"SUM(u.cached_tokens) AS cached_tokens, " +
		"SUM(u.cost) AS cost " +
		"FROM usage_stats u " +
		"LEFT JOIN providers p ON u.provider_id = p.id " +
		"LEFT JOIN api_keys k ON u.api_key_id = k.id " +
		"LEFT JOIN models m ON u.model_id = m.id " +
		"LEFT JOIN models m_legacy ON u.model_id IS NULL AND u.provider_id = m_legacy.provider_id AND u.model_name = m_legacy.model_name " +
		w + " " +
		"GROUP BY u.provider_id, u.model_name, u.api_key_id " +
		"ORDER BY request_count DESC"

	rows, err := d.Query(sql, params...)
	if err != nil {
		return nil, err
	}

	// ponytail: v0.4.24 — cost is summed from stored usage_stats.cost (price at request time),
	// not recomputed from current model prices. Recomputing would silently rewrite history
	// every time a provider edits a price.

	type aggData struct {
		Req, In, Out, Cached                           int64
		Cost                                             float64
		InputPrice, OutputPrice, CachePrice              float64
	}
	byModel := map[string]*aggData{}
	byProvider := map[string]*aggData{}
	for _, r := range rows {
		mk := db.Str(r["provider"]) + "|" + db.Str(r["current_model_name"])
		m := byModel[mk]
		if m == nil {
			m = &aggData{InputPrice: toFloat(r["input_price"]), OutputPrice: toFloat(r["output_price"]), CachePrice: toFloat(r["cache_hit_price"])}
			byModel[mk] = m
		}
		m.Req += db.Int64(r["request_count"])
		m.In += db.Int64(r["input_tokens"])
		m.Out += db.Int64(r["output_tokens"])
		m.Cached += db.Int64(r["cached_tokens"])
		m.Cost += toFloat(r["cost"])

		pk := db.Str(r["provider"])
		if pk == "" {
			pk = "?"
		}
		pa := byProvider[pk]
		if pa == nil {
			pa = &aggData{}
			byProvider[pk] = pa
		}
		pa.Req += db.Int64(r["request_count"])
		pa.In += db.Int64(r["input_tokens"])
		pa.Out += db.Int64(r["output_tokens"])
		pa.Cached += db.Int64(r["cached_tokens"])
		pa.Cost += toFloat(r["cost"])
	}

	var totalReq, totalIn, totalOut, totalCached int64
	var totalCost float64
	for _, r := range rows {
		totalReq += db.Int64(r["request_count"])
		totalIn += db.Int64(r["input_tokens"])
		totalOut += db.Int64(r["output_tokens"])
		totalCached += db.Int64(r["cached_tokens"])
		totalCost += toFloat(r["cost"])
	}

	topModels := make([]map[string]interface{}, 0)
	for k, v := range byModel {
		parts := strings.SplitN(k, "|", 2)
		prov, model := parts[0], ""
		if len(parts) > 1 {
			model = parts[1]
		}
		topModels = append(topModels, map[string]interface{}{
			"provider": prov, "model": model,
			"request_count": v.Req, "input_tokens": v.In,
			"output_tokens": v.Out, "cached_tokens": v.Cached,
			"cost": v.Cost, "input_price": v.InputPrice,
			"output_price": v.OutputPrice, "cache_hit_price": v.CachePrice,
		})
	}
	sort.Slice(topModels, func(i, j int) bool {
		ri := db.Int64(topModels[i]["request_count"])
		rj := db.Int64(topModels[j]["request_count"])
		return ri > rj
	})
	if len(topModels) > 5 {
		topModels = topModels[:5]
	}

	topProviders := make([]map[string]interface{}, 0)
	for k, v := range byProvider {
		topProviders = append(topProviders, map[string]interface{}{
			"provider": k, "request_count": v.Req,
			"input_tokens": v.In, "output_tokens": v.Out,
			"cached_tokens": v.Cached, "cost": v.Cost,
		})
	}
	sort.Slice(topProviders, func(i, j int) bool {
		ri := db.Int64(topProviders[i]["request_count"])
		rj := db.Int64(topProviders[j]["request_count"])
		return ri > rj
	})
	if len(topProviders) > 5 {
		topProviders = topProviders[:5]
	}

	return map[string]interface{}{
		"total_requests":    totalReq,
		"total_input_tokens":  totalIn,
		"total_output_tokens": totalOut,
		"total_cached_tokens": totalCached,
		"total_cost":         totalCost,
		"breakdown":    rows,
		"topModels":    topModels,
		"topProviders": topProviders,
	}, nil
}
