package commlog

import (
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"nantianmen/internal/conf"
	"nantianmen/internal/db"
)

var (
	buf           []map[string]interface{}
	bufMu         sync.Mutex
	flushTimer    *time.Ticker
	rotationTimer *time.Ticker
)

const (
	flushInterval    = 10 * time.Second
	rotationInterval = 60 * time.Second
)

func InitBuffer() {
	if flushTimer != nil {
		return
	}
	flushTimer = time.NewTicker(flushInterval)
	go func() {
		for range flushTimer.C {
			FlushBuffer()
		}
	}()
	initRotation()
}

func Append(entry map[string]interface{}) {
	c := conf.GetConf()
	if !c.LogEnabled {
		return
	}
	bufMu.Lock()
	buf = append(buf, entry)
	bufMu.Unlock()
}

func getProvID(p interface{}) int64 {
	m, ok := p.(map[string]interface{})
	if !ok {
		return 0
	}
	switch v := m["id"].(type) {
	case int64:
		return v
	case float64:
		return int64(v)
	}
	return 0
}

// ponytail: TEXT columns can't accept map/slice; coerce to JSON string.
// modernc.org/sqlite binds map[string]interface{} as unsupported type.
func strCol(e map[string]interface{}, k string) string {
	v := e[k]
	if v == nil {
		return ""
	}
	switch s := v.(type) {
	case string:
		return s
	case []byte:
		return string(s)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(b)
	}
}

func getProvName(p interface{}) string {
	m, ok := p.(map[string]interface{})
	if !ok {
		return ""
	}
	s, _ := m["name"].(string)
	return s
}

func FlushBuffer() {
	bufMu.Lock()
	batch := buf
	buf = nil
	bufMu.Unlock()
	if len(batch) == 0 {
		return
	}

	// ponytail: schema DEFAULT '' isn't applied to prepared-stmt nil values,
	// which trips NOT NULL on user_id/time/etc. Substitute zero values per
	// column type at flush time so logEntry callers can pass sparse maps.
	strCols := []string{"request_id", "time", "user_id", "user_name", "model_name", "upstreamBody", "responseBody"}
	intCols := []string{"modelId", "inputTokens", "outputTokens", "cachedTokens", "durationMs"}
	costCols := []string{"cost"}

	d := db.Get()
	for _, e := range batch {
		for _, k := range strCols {
			if e[k] == nil {
				e[k] = ""
			}
		}
		for _, k := range intCols {
			if e[k] == nil {
				e[k] = 0
			}
		}
		for _, k := range costCols {
			if e[k] == nil {
				e[k] = float64(0)
			}
		}
		var code, msg interface{}
		if errMap, ok := e["error"].(map[string]interface{}); ok {
			code = errMap["code"]
			msg = errMap["message"]
		}
		if _, err := d.Run(
			"INSERT INTO communication_log (request_id, time, user_id, user_name, provider_id, provider_name, model_id, model_name, tokens_input, tokens_output, tokens_cached, cost, duration_ms, input, output, error_code, error_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
			e["request_id"], e["time"], e["user_id"], e["user_name"],
			e["provider_id"], e["provider_name"],
			e["modelId"], e["modelName"],
			e["inputTokens"], e["outputTokens"], e["cachedTokens"],
			e["cost"], e["durationMs"],
			strCol(e, "upstreamBody"), strCol(e, "responseBody"),
			code, msg,
		); err != nil {
			log.Printf("[commlog] flush insert error: %v", err)
		}
	}
	// ponytail: v0.4.24 bug fix — trim used to fire on every flush with max=0
	// defaulting to 500, wiping freshly-buffered rows. Rotation now runs in its
	// own ticker (initRotation) gated on LogRotationEnabled && LogRotationMax > 0.
}

// ponytail: v0.4.24 — rotation ticker is independent of the flush hot path so
// trim never races with in-flight inserts. Skipped when rotation is disabled.
func initRotation() {
	if c := conf.GetConf(); !c.LogRotationEnabled || c.LogRotationMax <= 0 {
		return
	}
	if rotationTimer != nil {
		return
	}
	rotationTimer = time.NewTicker(rotationInterval)
	go func() {
		for range rotationTimer.C {
			TrimToMax(conf.GetConf().LogRotationMax)
		}
	}()
}

func TrimToMax(max int) int {
	if max <= 0 {
		return 0
	}
	d := db.Get()
	rows, _ := d.Query("SELECT COUNT(*) as c FROM communication_log")
	var count int64
	if len(rows) > 0 {
		count = db.Int64(rows[0]["c"])
	}
	if count <= int64(max) {
		return 0
	}
	del := count - int64(max)
	d.Run("DELETE FROM communication_log WHERE id IN (SELECT id FROM communication_log ORDER BY id ASC LIMIT ?)", del)
	return int(del)
}

func mapRows(rows []db.Row) []map[string]interface{} {
	var out []map[string]interface{}
	for _, r := range rows {
		entry := map[string]interface{}{
			"id": r["id"], "request_id": r["request_id"], "time": r["time"],
			"user_id": r["user_id"], "user_name": r["user_name"],
			"provider_id": r["provider_id"], "provider_name": r["provider_name"],
			"model_id": r["model_id"], "model_name": db.Str(r["current_model_name"]),
			"capability":  db.Str(r["capability"]),
			"tokens_input": r["tokens_input"], "tokens_output": r["tokens_output"],
			"tokens_cached": r["tokens_cached"], "duration_ms": r["duration_ms"],
			"cost":  r["cost"],
			"input": r["input"], "output": r["output"],
		}
		if c := db.Int64(r["error_code"]); c != 0 {
			entry["error"] = map[string]interface{}{"code": c, "message": db.Str(r["error_message"])}
		}
		out = append(out, entry)
	}
	return out
}

func List(filters map[string]interface{}, page, perPage int) (interface{}, error) {
	d := db.Get()
	clauses := []string{}
	params := []interface{}{}
	if v, ok := filters["provider_id"]; ok {
		clauses = append(clauses, "c.provider_id=?")
		params = append(params, v)
	}
	if v, ok := filters["model_name"]; ok {
		clauses = append(clauses, "c.model_name=?")
		params = append(params, v)
	}
	if v, ok := filters["user_id"]; ok {
		clauses = append(clauses, "c.user_id=?")
		params = append(params, v)
	}
	// ponytail: capability is an orthogonal filter — applies to any provider/model/user combo
	if v, ok := filters["capability"].(string); ok && v != "" {
		clauses = append(clauses, "COALESCE(m.capability, m_legacy.capability, 'chat') = ?")
		params = append(params, v)
	}
	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}

	baseSelect := "c.id, c.request_id, c.time, c.user_id, c.user_name, c.provider_id, c.provider_name, c.model_id, c.model_name, COALESCE(m.model_name, m_legacy.model_name, c.model_name) AS current_model_name, COALESCE(m.capability, m_legacy.capability, 'chat') AS capability, c.tokens_input, c.tokens_output, c.tokens_cached, c.cost, c.duration_ms, c.input, c.output, c.error_code, c.error_message"
	baseFrom := "communication_log c LEFT JOIN models m ON c.model_id = m.id LEFT JOIN models m_legacy ON c.model_id IS NULL AND m_legacy.provider_id = c.provider_id AND m_legacy.model_name = c.model_name AND m_legacy.deleted_at IS NULL"

	if perPage > 0 {
		offset := (page - 1) * perPage
		// ponytail: count needs the same JOINs as baseFrom — where clauses reference m/m_legacy.
		countRows, _ := d.Query("SELECT COUNT(*) as c FROM "+baseFrom+" "+where, params...)
		total := int64(0)
		if len(countRows) > 0 {
			total = db.Int64(countRows[0]["c"])
		}
		rows, err := d.Query("SELECT "+baseSelect+" FROM "+baseFrom+" "+where+" ORDER BY c.id DESC LIMIT ? OFFSET ?", append(params, perPage, offset)...)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"total": total, "rows": mapRows(rows)}, nil
	}
	rows, err := d.Query("SELECT "+baseSelect+" FROM "+baseFrom+" "+where+" ORDER BY c.id DESC", params...)
	if err != nil {
		return nil, err
	}
	return mapRows(rows), nil
}

func Clear() {
	db.Get().Run("DELETE FROM communication_log")
}

func RenameUser(oldName, newName string) {
	if oldName == "" || oldName == newName {
		return
	}
	db.Get().Run("UPDATE communication_log SET user_name = ? WHERE user_name = ?", newName, oldName)
}