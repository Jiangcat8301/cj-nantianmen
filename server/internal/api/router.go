package api

import (
	"crypto/md5"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"server-go/internal/commlog"
	"server-go/internal/conf"
	"server-go/internal/db"
	"server-go/internal/llm"
	"server-go/internal/modelmap"
	"server-go/internal/stats"

	"github.com/go-chi/chi/v5"
)

const ServerVersion = "0.4.23"

var localMode bool

func init() {
	// ponytail: matches server/auth.js behavior — Electron-launched server
	// skips admin auth so the parent renderer doesn't need to send Bearer tokens.
	localMode = os.Getenv("NANTIANMEN_LOCAL_MODE") == "1"
}

func sendJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	b, _ := json.Marshal(v)
	w.Write(b)
}

func sendError(w http.ResponseWriter, code int, msg string) {
	sendJSON(w, code, map[string]string{"error": msg})
}

func md5Hash(s string) string {
	return fmt.Sprintf("%x", md5.Sum([]byte(s)))
}

func genKey() string {
	b := make([]byte, 20)
	rand.Read(b)
	return "skm-" + fmt.Sprintf("%x", b)
}

func maskKey(k string) string {
	if len(k) > 8 {
		return k[:4] + "..." + k[len(k)-4:]
	}
	return "***"
}

var whitelist = map[string]bool{
	"/api/admin/status": true,
	"/api/admin/setup":  true,
	"/api/admin/login":  true,
}

func AdminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/admin/") {
			next.ServeHTTP(w, r)
			return
		}
		if localMode {
			next.ServeHTTP(w, r)
			return
		}
		path := r.URL.Path
		if i := strings.Index(path, "?"); i >= 0 {
			path = path[:i]
		}
		if whitelist[path] {
			next.ServeHTTP(w, r)
			return
		}
		c := conf.GetConf()
		if !c.Initialized {
			sendError(w, 503, "not initialized")
			return
		}
		auth := r.Header.Get("Authorization")
		m := strings.TrimPrefix(auth, "Bearer ")
		if m == "" {
			sendError(w, 401, "missing Authorization header")
			return
		}
		expected := md5Hash(m + c.Salt)
		if expected != c.Password {
			sendError(w, 401, "invalid password")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func authApiKey(w http.ResponseWriter, r *http.Request) (int64, bool) {
	auth := r.Header.Get("Authorization")
	token := strings.TrimPrefix(auth, "Bearer ")
	if token == "" || !strings.HasPrefix(token, "skm-") {
		sendError(w, 401, "invalid api key")
		return 0, false
	}
	rows, _ := db.Get().Query("SELECT id FROM api_keys WHERE key=?", token)
	if len(rows) == 0 {
		sendError(w, 401, "invalid api key")
		return 0, false
	}
	id := db.Int64(rows[0]["id"])
	db.Get().Run("UPDATE api_keys SET last_used_at=datetime('now') WHERE id=?", id)
	return id, true
}

func checkModelAuthorized(w http.ResponseWriter, r *http.Request, apiKeyID int64) (*modelmap.Entry, bool) {
	override, _ := db.Get().Query("SELECT assigned_model_id FROM api_keys WHERE id=?", apiKeyID)
	var assignedID int64
	if len(override) > 0 {
		assignedID = db.Int64(override[0]["assigned_model_id"])
	}
	bodyBytes, _ := io.ReadAll(r.Body)
	var body map[string]interface{}
	json.Unmarshal(bodyBytes, &body)
	r.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
	entry := modelmap.ResolveEntryFor(assignedID, fmt.Sprint(body["model"]))
	if entry == nil {
		sendError(w, 403, fmt.Sprintf("model not authorized: %s", body["model"]))
		return nil, false
	}
	explicit := assignedID > 0 || (body["model"] != nil && body["model"] != "auto" && body["model"] != "Nantianmen-default")
	if !explicit {
		return entry, true
	}
	rows, _ := db.Get().Query("SELECT model_id FROM api_key_models WHERE api_key_id=?", apiKeyID)
	allowed := map[int64]bool{}
	for _, row := range rows {
		allowed[db.Int64(row["model_id"])] = true
	}
	if !allowed[entry.ModelID] {
		sendError(w, 403, fmt.Sprintf("model not authorized: %s", entry.ModelName))
		return nil, false
	}
	return entry, true
}

func getFloat(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	}
	return 0
}

func stringOr(v interface{}, def string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return def
}

// ponytail: returns nil for empty/missing strings → COALESCE(NULL, col) preserves col
func stringOrNil(v interface{}) interface{} {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return nil
}

func coalesce(v, def interface{}) interface{} {
	if v == nil {
		return def
	}
	return v
}

func validateName(name string) error {
	if name == "" || strings.Contains(name, " ") || strings.Contains(name, "_") {
		return fmt.Errorf("provider name must not be empty, contain spaces, or underscores")
	}
	return nil
}

func listProviders() []map[string]interface{} {
	rows, _ := db.Get().Query("SELECT * FROM providers WHERE deleted_at IS NULL ORDER BY id")
	if len(rows) == 0 {
		return rows
	}
	var ids []interface{}
	for _, p := range rows {
		ids = append(ids, db.Int64(p["id"]))
	}
	if len(ids) == 0 {
		return rows
	}
	q := "SELECT id, provider_id, model_name, capability, is_default, is_disabled FROM models WHERE deleted_at IS NULL AND provider_id IN (?" + strings.Repeat(",?", len(ids)-1) + ") ORDER BY provider_id, id"
	modelRows, _ := db.Get().Query(q, ids...)
	byID := map[int64]int{}
	for i, p := range rows {
		byID[db.Int64(p["id"])] = i
	}
	for _, m := range modelRows {
		idx, ok := byID[db.Int64(m["provider_id"])]
		if !ok {
			continue
		}
		prev, _ := rows[idx]["models"].([]interface{})
		if prev == nil {
			prev = []interface{}{}
		}
		prev = append(prev, m)
		rows[idx]["models"] = prev
	}
	return rows
}

func getKeyModels(apiKeyID int64) []map[string]interface{} {
	rows, _ := db.Get().Query("SELECT akm.model_id, m.model_name, p.name AS provider_name FROM api_key_models akm JOIN models m ON m.id = akm.model_id JOIN providers p ON p.id = m.provider_id WHERE akm.api_key_id=?", apiKeyID)
	var out []map[string]interface{}
	for _, r := range rows {
		out = append(out, r)
	}
	return out
}

func setKeyModels(apiKeyID int64, modelIDs interface{}) {
	db.Get().Run("DELETE FROM api_key_models WHERE api_key_id=?", apiKeyID)
	arr, ok := modelIDs.([]interface{})
	if !ok {
		return
	}
	for _, mid := range arr {
		db.Get().Run("INSERT OR IGNORE INTO api_key_models(api_key_id, model_id) VALUES (?,?)", apiKeyID, int64(getFloat(mid)))
	}
}

func buildModelsResponse(apiKeyID int64) map[string]interface{} {
	m := modelmap.GetModelMap()
	out := []map[string]interface{}{{"id": "Nantianmen-default", "object": "model", "created": 0, "owned_by": "Nantianmen"}}
	for id, entry := range m {
		out = append(out, map[string]interface{}{"id": id, "object": "model", "created": 0, "owned_by": entry.Provider.Name})
	}
	if apiKeyID == 0 {
		return map[string]interface{}{"object": "list", "data": out}
	}
	rows, _ := db.Get().Query("SELECT model_id FROM api_key_models WHERE api_key_id=?", apiKeyID)
	allowed := map[int64]bool{}
	for _, r := range rows {
		allowed[db.Int64(r["model_id"])] = true
	}
	var filtered []map[string]interface{}
	for _, item := range out {
		if item["id"] == "Nantianmen-default" {
			filtered = append(filtered, item)
			continue
		}
		if e, ok := m[item["id"].(string)]; ok && allowed[e.ModelID] {
			filtered = append(filtered, item)
		}
	}
	return map[string]interface{}{"object": "list", "data": filtered}
}

func fetchAndRebuild(providerID int64) []map[string]interface{} {
	rows, _ := db.Get().Query("SELECT * FROM providers WHERE id=?", providerID)
	if len(rows) == 0 {
		return nil
	}
	p := rows[0]
	base := strings.TrimRight(db.Str(p["base_url"]), "/")
	url := base + "/models"
	if db.Str(p["protocol"]) == "anthropic" {
		url = base + "/v1/models"
	}
	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("GET", url, nil)
	if db.Str(p["protocol"]) == "openai" {
		req.Header.Set("Authorization", "Bearer "+db.Str(p["api_key"]))
	} else {
		req.Header.Set("x-api-key", db.Str(p["api_key"]))
		req.Header.Set("anthropic-version", "2023-06-01")
	}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode >= 400 {
		if resp != nil {
			resp.Body.Close()
		}
		return nil
	}
	defer resp.Body.Close()
	var data struct {
		Data []struct{ ID string } `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&data)
	if len(data.Data) > 0 {
		db.Get().Run("UPDATE models SET deleted_at=datetime('now') WHERE provider_id=? AND deleted_at IS NULL", providerID)
		for _, m := range data.Data {
			db.Get().Run("INSERT INTO models(provider_id, model_name, deleted_at) VALUES (?,?,NULL) ON CONFLICT(provider_id, model_name) DO UPDATE SET deleted_at=NULL", providerID, m.ID)
		}
	}
	modelmap.RebuildModelMap()
	result, _ := db.Get().Query("SELECT * FROM models WHERE provider_id=? AND deleted_at IS NULL ORDER BY id", providerID)
	return result
}

func handleProviderHealth(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	rows, _ := db.Get().Query("SELECT * FROM providers WHERE id=?", id)
	if len(rows) == 0 {
		sendError(w, 404, "not found")
		return
	}
	p := rows[0]
	base := strings.TrimRight(db.Str(p["base_url"]), "/")
	url := base + "/models"
	if db.Str(p["protocol"]) == "anthropic" {
		url = base + "/v1/models"
	}
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("GET", url, nil)
	if db.Str(p["protocol"]) == "openai" {
		req.Header.Set("Authorization", "Bearer "+db.Str(p["api_key"]))
	} else {
		req.Header.Set("x-api-key", db.Str(p["api_key"]))
		req.Header.Set("anthropic-version", "2023-06-01")
	}
	resp, err := client.Do(req)
	if err != nil {
		sendJSON(w, 200, map[string]interface{}{"healthy": false, "error": err.Error()})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 && db.Str(p["protocol"]) == "anthropic" {
		sendJSON(w, 200, map[string]interface{}{"healthy": true, "status_code": 200, "note": "models endpoint not available, provider assumed healthy"})
		return
	}
	sendJSON(w, 200, map[string]interface{}{"healthy": resp.StatusCode < 400, "status_code": resp.StatusCode})
}

// ── exported route registration ──

func RegisterAdminRoutes(r chi.Router) {
	r.Get("/api/admin/status", func(w http.ResponseWriter, r *http.Request) {
		c := conf.GetConf()
		resp := map[string]interface{}{"initialized": c.Initialized, "host": c.ServerHost, "port": c.ServerPort}
		if c.Initialized {
			resp["database"] = c.Database
		}
		sendJSON(w, 200, resp)
	})
	r.Post("/api/admin/setup", func(w http.ResponseWriter, r *http.Request) {
		c := conf.GetConf()
		if c.Initialized {
			sendError(w, 409, "already initialized")
			return
		}
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		host, _ := body["host"].(string)
		port := int(getFloat(body["port"]))
		pwd, _ := body["password_md5"].(string)
		if host == "" || port == 0 || len(pwd) < 32 {
			sendError(w, 400, "host/port/password_md5 required")
			return
		}
		dbCfg, _ := body["database"].(map[string]interface{})
		if dbCfg == nil {
			dbCfg = map[string]interface{}{"type": "sqlite3", "path": "./nantianmen.db"}
		}
		dbType, _ := dbCfg["type"].(string)
		if dbType != "sqlite3" && dbType != "mysql" {
			sendError(w, 400, "unknown db type")
			return
		}
		salt := conf.RandomSalt()
		hash := md5Hash(pwd + salt)
		conf.UpdateConf(map[string]interface{}{
			"initialized": true, "server_host": host, "server_port": port,
			"password": hash, "salt": salt, "database": dbCfg,
		})
		dbPath, _ := dbCfg["path"].(string)
		if !filepath.IsAbs(dbPath) {
			dbPath = filepath.Join(conf.GetConfDir(), dbPath)
		}
		db.Init(dbPath)
		modelmap.RebuildModelMap()
		stats.StartFlushTask()
		commlog.InitBuffer()
		sendJSON(w, 200, map[string]interface{}{"ok": true, "host": host, "port": port, "database": dbCfg})
	})
	r.Post("/api/admin/login", func(w http.ResponseWriter, r *http.Request) {
		c := conf.GetConf()
		if !c.Initialized {
			sendError(w, 503, "not initialized")
			return
		}
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		pwd, _ := body["password_md5"].(string)
		if md5Hash(pwd+c.Salt) != c.Password {
			sendError(w, 401, "invalid password")
			return
		}
		sendJSON(w, 200, map[string]string{"ok": "true"})
	})
	r.Post("/api/admin/password/change", func(w http.ResponseWriter, r *http.Request) {
		c := conf.GetConf()
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		old, _ := body["old_password_md5"].(string)
		newP, _ := body["new_password_md5"].(string)
		if old == "" || newP == "" {
			sendError(w, 400, "old/new required")
			return
		}
		if md5Hash(old+c.Salt) != c.Password {
			sendError(w, 401, "old password incorrect")
			return
		}
		if len(newP) != 32 {
			sendError(w, 400, "new_password_md5 must be md5 hex")
			return
		}
		salt := conf.RandomSalt()
		conf.UpdateConf(map[string]interface{}{"password": md5Hash(newP + salt), "salt": salt})
		sendJSON(w, 200, map[string]string{"ok": "true"})
	})
	r.Get("/api/admin/settings", func(w http.ResponseWriter, r *http.Request) {
		c := conf.GetConf()
		sendJSON(w, 200, map[string]interface{}{"host": c.ServerHost, "port": c.ServerPort, "database": c.Database, "proxy": c.Proxy, "proxy_url": c.ProxyURL})
	})
	r.Put("/api/admin/settings", func(w http.ResponseWriter, r *http.Request) {
		c := conf.GetConf()
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		host, _ := body["host"].(string)
		port := int(getFloat(body["port"]))
		if host == "" || port == 0 {
			sendError(w, 400, "host/port required")
			return
		}
		portChanged := port != c.ServerPort
		conf.UpdateConf(map[string]interface{}{"server_host": host, "server_port": port})
		sendJSON(w, 200, map[string]interface{}{"ok": true, "restart_required": portChanged})
	})
	r.Get("/api/admin/proxy", func(w http.ResponseWriter, r *http.Request) {
		c := conf.GetConf()
		sendJSON(w, 200, map[string]interface{}{"mode": c.Proxy, "url": c.ProxyURL})
	})
	r.Put("/api/admin/proxy", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		mode, _ := body["mode"].(string)
		url, _ := body["url"].(string)
		if mode != "system" && mode != "direct" && mode != "custom" {
			sendError(w, 400, "mode must be system|direct|custom")
			return
		}
		if mode == "custom" && (url == "" || !strings.HasPrefix(url, "http")) {
			sendError(w, 400, "custom mode requires a proxy URL")
			return
		}
		conf.UpdateConf(map[string]interface{}{"proxy": mode, "proxy_url": url})
		sendJSON(w, 200, map[string]interface{}{"ok": true, "mode": mode, "url": url})
	})
	r.Post("/api/admin/server/shutdown", func(w http.ResponseWriter, r *http.Request) {
		sendJSON(w, 200, map[string]string{"ok": "true"})
		stats.Flush()
		commlog.FlushBuffer()
		go func() { time.Sleep(100 * time.Millisecond); os.Exit(0) }()
	})
	r.Post("/api/admin/server/restart", func(w http.ResponseWriter, r *http.Request) {
		sendJSON(w, 200, map[string]string{"ok": "true"})
		stats.Flush()
		go func() { time.Sleep(100 * time.Millisecond); os.Exit(0) }()
	})
	r.Get("/api/admin/ui-filters", func(w http.ResponseWriter, r *http.Request) {
		c := conf.GetConf()
		sendJSON(w, 200, c.UIFilters)
	})
	r.Put("/api/admin/ui-filters", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		conf.UpdateConf(map[string]interface{}{"ui_filters": body})
		sendJSON(w, 200, body)
	})
	r.Get("/api/admin/database/info", func(w http.ResponseWriter, r *http.Request) {
		c := conf.GetConf()
		size := int64(0)
		if c.Database.Type == "sqlite3" {
			if fi, err := os.Stat(c.Database.Path); err == nil {
				size = fi.Size()
			}
		}
		rows, _ := db.Get().Query("SELECT COUNT(*) as c FROM communication_log")
		count := int64(0)
		if len(rows) > 0 {
			count = db.Int64(rows[0]["c"])
		}
		sendJSON(w, 200, map[string]interface{}{"type": c.Database.Type, "path": c.Database.Path, "size": size, "log_count": count})
	})
	r.Get("/api/admin/communication-log", handleCommLogList)
	r.Delete("/api/admin/communication-log", func(w http.ResponseWriter, r *http.Request) {
		commlog.Clear()
		sendJSON(w, 200, map[string]string{"ok": "true"})
	})
	r.Get("/api/admin/communication-log/config", func(w http.ResponseWriter, r *http.Request) {
		c := conf.GetConf()
		sendJSON(w, 200, map[string]interface{}{"log_enabled": c.LogEnabled, "log_rotation_enabled": c.LogRotationEnabled, "log_rotation_max": c.LogRotationMax})
	})
	r.Put("/api/admin/communication-log/config", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		patch := map[string]interface{}{}
		if v, ok := body["log_enabled"]; ok {
			patch["log_enabled"] = v
		}
		if v, ok := body["log_rotation_enabled"]; ok {
			patch["log_rotation_enabled"] = v
		}
		if v, ok := body["log_rotation_max"]; ok {
			patch["log_rotation_max"] = int(getFloat(v))
		}
		if len(patch) > 0 {
			conf.UpdateConf(patch)
		}
		c := conf.GetConf()
		if c.LogRotationEnabled && c.LogRotationMax > 0 {
			commlog.TrimToMax(c.LogRotationMax)
		}
		sendJSON(w, 200, map[string]interface{}{"log_enabled": c.LogEnabled, "log_rotation_enabled": c.LogRotationEnabled, "log_rotation_max": c.LogRotationMax})
	})
}

func handleCommLogList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := 1
	perPage := 0
	if p := q.Get("page"); p != "" {
		page, _ = strconv.Atoi(p)
	}
	if pp := q.Get("per_page"); pp != "" {
		perPage, _ = strconv.Atoi(pp)
	}
	filters := map[string]interface{}{}
	if v := q.Get("provider_id"); v != "" {
		filters["provider_id"], _ = strconv.Atoi(v)
	}
	if v := q.Get("model_name"); v != "" {
		filters["model_name"] = v
	}
	if v := q.Get("user_id"); v != "" {
		filters["user_id"], _ = strconv.Atoi(v)
	}
	if v := q.Get("capability"); v != "" {
		filters["capability"] = v
	}
	result, err := commlog.List(filters, page, perPage)
	if err != nil {
		sendError(w, 500, err.Error())
		return
	}
	sendJSON(w, 200, result)
}

func RegisterProviderRoutes(r chi.Router) {
	r.Get("/api/admin/providers", func(w http.ResponseWriter, r *http.Request) {
		providers := listProviders()
		var out []map[string]interface{}
		for _, p := range providers {
			p["api_key"] = maskKey(db.Str(p["api_key"]))
			out = append(out, p)
		}
		sendJSON(w, 200, out)
	})
	r.Post("/api/admin/providers", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		name, _ := body["name"].(string)
		protocol, _ := body["protocol"].(string)
		baseURL, _ := body["base_url"].(string)
		apiKey, _ := body["api_key"].(string)
		if err := validateName(name); err != nil {
			sendError(w, 400, err.Error())
			return
		}
		if protocol != "openai" && protocol != "anthropic" {
			sendError(w, 400, "protocol must be openai or anthropic")
			return
		}
		res, _ := db.Get().Run("INSERT INTO providers(name, protocol, base_url, api_key) VALUES (?,?,?,?)", name, protocol, baseURL, apiKey)
		rows, _ := db.Get().Query("SELECT * FROM providers WHERE id=?", res.LastInsertRowID)
		if len(rows) == 0 {
			sendError(w, 500, "create failed")
			return
		}
		created := rows[0]
		created["api_key"] = maskKey(db.Str(created["api_key"]))
		models := fetchAndRebuild(res.LastInsertRowID)
		created["models"] = models
		all := listProviders()
		if len(all) == 1 {
			modelRows, _ := db.Get().Query("SELECT * FROM models WHERE provider_id=? ORDER BY id LIMIT 1", res.LastInsertRowID)
			if len(modelRows) > 0 {
				db.Get().Run("UPDATE models SET is_default=1 WHERE id=?", db.Int64(modelRows[0]["id"]))
				modelmap.RebuildModelMap()
			}
		}
		sendJSON(w, 200, created)
	})
	r.Put("/api/admin/providers/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(chi.URLParam(r, "id"))
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		rows, _ := db.Get().Query("SELECT * FROM providers WHERE id=?", id)
		if len(rows) == 0 {
			sendError(w, 404, "not found")
			return
		}
		existing := rows[0]
		name := stringOr(body["name"], db.Str(existing["name"]))
		protocol := stringOr(body["protocol"], db.Str(existing["protocol"]))
		baseURL := stringOr(body["base_url"], db.Str(existing["base_url"]))
		apiKey := stringOr(body["api_key"], db.Str(existing["api_key"]))
		if err := validateName(name); err != nil {
			sendError(w, 400, err.Error())
			return
		}
		db.Get().Run("UPDATE providers SET name=?, protocol=?, base_url=?, api_key=?, updated_at=datetime('now') WHERE id=?", name, protocol, baseURL, apiKey, id)
		modelmap.RebuildModelMap()
		updated, _ := db.Get().Query("SELECT * FROM providers WHERE id=?", id)
		if len(updated) > 0 {
			updated[0]["api_key"] = maskKey(db.Str(updated[0]["api_key"]))
			sendJSON(w, 200, updated[0])
		} else {
			sendError(w, 404, "not found")
		}
	})
	r.Delete("/api/admin/providers/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(chi.URLParam(r, "id"))
		res, _ := db.Get().Run("DELETE FROM providers WHERE id=?", id)
		modelmap.RebuildModelMap()
		if res.Changes > 0 {
			sendJSON(w, 200, map[string]string{"ok": "true"})
			return
		}
		sendError(w, 404, "not found")
	})
	r.Post("/api/admin/providers/{id}/health", handleProviderHealth)
	r.Get("/api/admin/providers/{id}/models", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(chi.URLParam(r, "id"))
		rows, _ := db.Get().Query("SELECT * FROM models WHERE provider_id=? AND deleted_at IS NULL ORDER BY id", id)
		sendJSON(w, 200, rows)
	})
	r.Put("/api/admin/providers/{id}/models/{modelId}", func(w http.ResponseWriter, r *http.Request) {
		mid, _ := strconv.Atoi(chi.URLParam(r, "modelId"))
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		rows, _ := db.Get().Query("SELECT * FROM models WHERE id=?", mid)
		if len(rows) == 0 {
			sendError(w, 404, "not found")
			return
		}
		m := rows[0]
		db.Get().Run("UPDATE models SET input_price=?, output_price=?, cache_hit_price=? WHERE id=?",
			coalesce(body["input_price"], m["input_price"]),
			coalesce(body["output_price"], m["output_price"]),
			coalesce(body["cache_hit_price"], m["cache_hit_price"]),
			mid)
		updated, _ := db.Get().Query("SELECT * FROM models WHERE id=?", mid)
		sendJSON(w, 200, updated[0])
	})
	r.Post("/api/admin/providers/{id}/models", func(w http.ResponseWriter, r *http.Request) {
		pid, _ := strconv.Atoi(chi.URLParam(r, "id"))
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		modelName, _ := body["model_name"].(string)
		if strings.TrimSpace(modelName) == "" {
			sendError(w, 400, "model_name required")
			return
		}
		cap := "chat"
		if c, ok := body["capability"].(string); ok && (c == "chat" || c == "embedding") {
			cap = c
		}
		db.Get().Run("INSERT OR IGNORE INTO models(provider_id, model_name, capability, is_manual) VALUES (?,?,?,1)", pid, strings.TrimSpace(modelName), cap)
		modelmap.RebuildModelMap()
		rows, _ := db.Get().Query("SELECT * FROM models WHERE provider_id=? AND model_name=?", pid, strings.TrimSpace(modelName))
		if len(rows) > 0 {
			sendJSON(w, 200, rows[0])
		} else {
			sendError(w, 500, "insert failed")
		}
	})
	r.Post("/api/admin/providers/{id}/models/refresh", func(w http.ResponseWriter, r *http.Request) {
		pid, _ := strconv.Atoi(chi.URLParam(r, "id"))
		models := fetchAndRebuild(int64(pid))
		sendJSON(w, 200, map[string]interface{}{"ok": true, "models": models})
	})
	r.Get("/api/admin/default-model", func(w http.ResponseWriter, r *http.Request) {
		rows, _ := db.Get().Query("SELECT p.name AS provider_name, m.model_name, p.protocol FROM models m JOIN providers p ON m.provider_id = p.id WHERE m.is_default = 1 AND m.deleted_at IS NULL LIMIT 1")
		if len(rows) > 0 {
			sendJSON(w, 200, rows[0])
		} else {
			sendJSON(w, 200, nil)
		}
	})
	r.Put("/api/admin/providers/{id}/models/{modelId}/default", func(w http.ResponseWriter, r *http.Request) {
		pid, _ := strconv.Atoi(chi.URLParam(r, "id"))
		mid, _ := strconv.Atoi(chi.URLParam(r, "modelId"))
		rows, _ := db.Get().Query("SELECT * FROM models WHERE id=? AND provider_id=?", mid, pid)
		if len(rows) == 0 {
			sendError(w, 404, "not found")
			return
		}
		if db.Int64(rows[0]["is_disabled"]) == 1 {
			sendError(w, 400, "cannot set default: model is disabled")
			return
		}
		db.Get().Exec("UPDATE models SET is_default=0")
		db.Get().Run("UPDATE models SET is_default=1 WHERE id=?", mid)
		modelmap.RebuildModelMap()
		sendJSON(w, 200, rows[0])
	})
	r.Put("/api/admin/providers/{id}/models/{modelId}/toggle", func(w http.ResponseWriter, r *http.Request) {
		pid, _ := strconv.Atoi(chi.URLParam(r, "id"))
		mid, _ := strconv.Atoi(chi.URLParam(r, "modelId"))
		rows, _ := db.Get().Query("SELECT * FROM models WHERE id=? AND provider_id=?", mid, pid)
		if len(rows) == 0 {
			sendError(w, 404, "not found")
			return
		}
		next := 0
		if db.Int64(rows[0]["is_disabled"]) == 0 {
			next = 1
		}
		if next == 1 && db.Int64(rows[0]["is_default"]) == 1 {
			db.Get().Exec("UPDATE models SET is_default=0")
		}
		db.Get().Run("UPDATE models SET is_disabled=? WHERE id=?", next, mid)
		modelmap.RebuildModelMap()
		updated, _ := db.Get().Query("SELECT * FROM models WHERE id=?", mid)
		sendJSON(w, 200, updated[0])
	})
}

func RegisterApikeyRoutes(r chi.Router) {
	r.Get("/api/admin/api-keys", func(w http.ResponseWriter, r *http.Request) {
		rows, _ := db.Get().Query("SELECT a.id, a.key, a.name, a.note, a.assigned_model_id, am.model_name AS assigned_model, ap.name AS assigned_provider_name, datetime(a.created_at,'localtime') as created_at, datetime(a.last_used_at,'localtime') as last_used_at FROM api_keys a LEFT JOIN models am ON am.id = a.assigned_model_id LEFT JOIN providers ap ON ap.id = am.provider_id ORDER BY a.id")
		var out []map[string]interface{}
		for _, r := range rows {
			r["authorized_models"] = getKeyModels(db.Int64(r["id"]))
			out = append(out, r)
		}
		sendJSON(w, 200, out)
	})
	r.Post("/api/admin/api-keys", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		name, _ := body["name"].(string)
		note, _ := body["note"].(string)
		modelIDs := body["model_ids"]
		key := genKey()
		var assigned interface{} = nil
		if v, ok := body["assigned_model_id"]; ok && getFloat(v) > 0 {
			assigned = int64(getFloat(v))
		}
		res, _ := db.Get().Run("INSERT INTO api_keys(key, name, note, assigned_model_id) VALUES (?,?,?,?)", key, name, note, assigned)
		setKeyModels(res.LastInsertRowID, modelIDs)
		rows, _ := db.Get().Query("SELECT a.id, a.key, a.name, a.note, a.assigned_model_id, am.model_name AS assigned_model FROM api_keys a LEFT JOIN models am ON am.id = a.assigned_model_id WHERE a.id=?", res.LastInsertRowID)
		if len(rows) > 0 {
			rows[0]["authorized_models"] = getKeyModels(res.LastInsertRowID)
			sendJSON(w, 200, rows[0])
		} else {
			sendError(w, 500, "create failed")
		}
	})
	r.Put("/api/admin/api-keys/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(chi.URLParam(r, "id"))
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		name := stringOrNil(body["name"])
		note := stringOrNil(body["note"])
		oldName, _ := body["old_name"].(string)
		if name != "" && oldName != "" && name != oldName {
			commlog.RenameUser(oldName, name.(string))
		}
		if _, ok := body["assigned_model_id"]; ok {
			var v interface{} = nil
			if f := getFloat(body["assigned_model_id"]); f > 0 {
				v = int64(f)
			}
			db.Get().Run("UPDATE api_keys SET name=COALESCE(?, name), note=COALESCE(?, note), assigned_model_id=? WHERE id=?", name, note, v, id)
		} else {
			db.Get().Run("UPDATE api_keys SET name=COALESCE(?, name), note=COALESCE(?, note) WHERE id=?", name, note, id)
		}
		if modelIDs, ok := body["model_ids"]; ok {
			setKeyModels(int64(id), modelIDs)
		}
		rows, _ := db.Get().Query("SELECT a.id, a.key, a.name, a.note, a.assigned_model_id, am.model_name AS assigned_model FROM api_keys a LEFT JOIN models am ON am.id = a.assigned_model_id WHERE a.id=?", id)
		if len(rows) == 0 {
			sendError(w, 404, "not found")
			return
		}
		rows[0]["authorized_models"] = getKeyModels(int64(id))
		sendJSON(w, 200, rows[0])
	})
	r.Delete("/api/admin/api-keys/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(chi.URLParam(r, "id"))
		res, _ := db.Get().Run("DELETE FROM api_keys WHERE id=?", id)
		if res.Changes > 0 {
			sendJSON(w, 200, map[string]string{"ok": "true"})
		} else {
			sendError(w, 404, "not found")
		}
	})
	r.Get("/api/admin/api-keys/available-models", func(w http.ResponseWriter, r *http.Request) {
		rows, _ := db.Get().Query("SELECT m.id, m.model_name, m.capability, m.is_default, p.id AS provider_id, p.name AS provider_name, p.protocol FROM models m JOIN providers p ON p.id = m.provider_id WHERE m.deleted_at IS NULL AND (m.is_disabled IS NULL OR m.is_disabled = 0) ORDER BY p.name, m.model_name")
		sendJSON(w, 200, rows)
	})
}

func RegisterLLMRoutes(r chi.Router) {
	r.Get("/v1/health", func(w http.ResponseWriter, r *http.Request) {
		sendJSON(w, 200, map[string]interface{}{
			"status":          "ok",
			"service":         "nantianmen",
			"version":         ServerVersion,
			"active_requests": llm.GetActive(),
		})
	})
	r.Get("/v1/models", func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		token := strings.TrimPrefix(auth, "Bearer ")
		var apiKeyID int64
		rows, _ := db.Get().Query("SELECT id FROM api_keys WHERE key=?", token)
		if len(rows) > 0 {
			apiKeyID = db.Int64(rows[0]["id"])
		}
		sendJSON(w, 200, buildModelsResponse(apiKeyID))
	})
	r.Post("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		apiKeyID, ok := authApiKey(w, r)
		if !ok {
			return
		}
		bodyBytes, _ := io.ReadAll(r.Body)
		var body map[string]interface{}
		json.Unmarshal(bodyBytes, &body)
		r.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
		_, ok = checkModelAuthorized(w, r, apiKeyID)
		if !ok {
			return
		}
		result, err := llm.ProxyRequest(body, "openai", apiKeyID, w)
		if err != nil {
			sendError(w, 502, err.Error())
			return
		}
		if result != nil {
			sendJSON(w, 200, result)
		}
	})
	r.Post("/v1/messages", func(w http.ResponseWriter, r *http.Request) {
		apiKeyID, ok := authApiKey(w, r)
		if !ok {
			return
		}
		bodyBytes, _ := io.ReadAll(r.Body)
		var body map[string]interface{}
		json.Unmarshal(bodyBytes, &body)
		r.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
		_, ok = checkModelAuthorized(w, r, apiKeyID)
		if !ok {
			return
		}
		result, err := llm.ProxyRequest(body, "anthropic", apiKeyID, w)
		if err != nil {
			sendError(w, 502, err.Error())
			return
		}
		if result != nil {
			sendJSON(w, 200, result)
		}
	})
	r.Post("/v1/embeddings", func(w http.ResponseWriter, r *http.Request) {
		apiKeyID, ok := authApiKey(w, r)
		if !ok {
			return
		}
		bodyBytes, _ := io.ReadAll(r.Body)
		var body map[string]interface{}
		json.Unmarshal(bodyBytes, &body)
		r.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
		if body["model"] == nil || body["model"] == "auto" || body["model"] == "Nantianmen-default" {
			sendError(w, 400, "/v1/embeddings requires explicit model")
			return
		}
		result, err := llm.ProxyEmbeddingRequest(body, apiKeyID, w)
		if err != nil {
			sendError(w, 502, err.Error())
			return
		}
		if result != nil {
			sendJSON(w, 200, result)
		}
	})
	r.Get("/api/admin/stats", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		sq := stats.StatsQuery{Range: q.Get("range"), Capability: q.Get("capability")}
		if v := q.Get("provider_id"); v != "" {
			sq.ProviderID, _ = strconv.ParseInt(v, 10, 64)
		}
		sq.ModelName = q.Get("model_name")
		if v := q.Get("api_key_id"); v != "" {
			sq.APIKeyID, _ = strconv.ParseInt(v, 10, 64)
		}
		result, err := stats.Query(sq)
		if err != nil {
			sendError(w, 500, err.Error())
			return
		}
		sendJSON(w, 200, result)
	})
}
