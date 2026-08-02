package llm

import (
	"bufio"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"server-go/internal/commlog"
	"server-go/internal/db"
	"server-go/internal/modelmap"
	"server-go/internal/stats"
)

var activeRequests atomic.Int64

func GetActive() int64 { return activeRequests.Load() }
func NowStr() string   { return time.Now().Format("2006-01-02 15:04:05") }

func RandUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func getUserName(apiKeyID int64) string {
	if apiKeyID == 0 {
		return ""
	}
	rows, err := db.Get().Query("SELECT name FROM api_keys WHERE id=?", apiKeyID)
	if err != nil || len(rows) == 0 {
		return ""
	}
	return db.Str(rows[0]["name"])
}

func logEntry(entry map[string]interface{}) {
	entry["request_id"] = RandUUID()
	entry["time"] = NowStr()
	// ponytail: populate user_id/user_name from apiKeyId so every caller
	// gets them without adding 2 fields per call site.
	if _, ok := entry["user_id"]; !ok {
		if id, ok := entry["apiKeyId"].(int64); ok && id > 0 {
			entry["user_id"] = id
			entry["user_name"] = getUserName(id)
		}
	}
	// ponytail: extract provider_name from provider struct so commlog
	// doesn't need to type-assert a struct → map.
	if _, ok := entry["provider_name"]; !ok {
		if p, ok := entry["provider"].(modelmap.Provider); ok {
			entry["provider_name"] = p.Name
			entry["provider_id"] = p.ID
		}
	}
	commlog.Append(entry)
}

func copyMap(m map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{})
	for k, v := range m {
		out[k] = v
	}
	return out
}

func limitStr(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func getFloat64(v interface{}) float64 {
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

func ProxyRequest(body map[string]interface{}, inboundProtocol string, apiKeyID int64, w http.ResponseWriter) (interface{}, error) {
	overrideRows, _ := db.Get().Query("SELECT assigned_model_id FROM api_keys WHERE id=?", apiKeyID)
	var overrideEntry *modelmap.Entry
	if len(overrideRows) > 0 && db.Int64(overrideRows[0]["assigned_model_id"]) > 0 {
		overrideEntry = modelmap.ResolveEntryFor(db.Int64(overrideRows[0]["assigned_model_id"]), "")
	}
	var entry *modelmap.Entry
	var err error
	if overrideEntry != nil {
		entry = overrideEntry
	} else {
		entry, err = modelmap.ResolveModel(fmt.Sprint(body["model"]))
		if err != nil {
			return nil, err
		}
	}
	p := entry.Provider

	var upstreamBody map[string]interface{}
	if inboundProtocol == p.Protocol {
		upstreamBody = copyMap(body)
		upstreamBody["model"] = entry.ModelName
	} else if inboundProtocol == "openai" && p.Protocol == "anthropic" {
		upstreamBody = OpenaiReqToAnthropic(body)
		upstreamBody["model"] = entry.ModelName
	} else if inboundProtocol == "anthropic" && p.Protocol == "openai" {
		upstreamBody = AnthropicReqToOpenai(body)
		upstreamBody["model"] = entry.ModelName
	} else {
		return nil, fmt.Errorf("unsupported protocol pair: %s->%s", inboundProtocol, p.Protocol)
	}

	activeRequests.Add(1)
	t0 := time.Now()
	bodyBytes, _ := json.Marshal(upstreamBody)
	req, _ := http.NewRequest("POST", entry.Endpoint, strings.NewReader(string(bodyBytes)))
	if req == nil {
		activeRequests.Add(-1)
		return nil, fmt.Errorf("bad request")
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range entry.Headers {
		req.Header.Set(k, v)
	}
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	durationMs := time.Since(t0).Milliseconds()
	if err != nil {
		activeRequests.Add(-1)
		logEntry(map[string]interface{}{
			"apiKeyId": apiKeyID, "provider": p, "modelName": entry.ModelName, "modelId": entry.ModelID,
			"upstreamBody": upstreamBody, "responseBody": "", "inputTokens": 0, "outputTokens": 0, "cachedTokens": 0,
			"durationMs": durationMs, "error": map[string]interface{}{"code": 0, "message": err.Error()},
		})
		return nil, err
	}
	defer resp.Body.Close()

	isStream := false
	if s, ok := body["stream"].(bool); ok {
		isStream = s
	}
	if isStream && resp.StatusCode == 200 {
		return handleStreamResponse(resp, inboundProtocol, p.Protocol, entry, apiKeyID, upstreamBody, p, durationMs, w)
	}
	bodyText, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		activeRequests.Add(-1)
		logEntry(map[string]interface{}{
			"apiKeyId": apiKeyID, "provider": p, "modelName": entry.ModelName, "modelId": entry.ModelID,
			"upstreamBody": upstreamBody, "responseBody": string(bodyText), "inputTokens": 0, "outputTokens": 0, "cachedTokens": 0,
			"durationMs": durationMs, "error": map[string]interface{}{"code": resp.StatusCode, "message": string(bodyText)},
		})
		return nil, fmt.Errorf("upstream %d: %s", resp.StatusCode, string(bodyText))
	}
	var data map[string]interface{}
	json.Unmarshal(bodyText, &data)
	var captured TokenUsage
	if p.Protocol == "openai" {
		captured = ExtractTokensOpenAI(data["usage"])
	} else {
		captured = ExtractTokensAnthropic(data["usage"])
	}
	out := data
	if inboundProtocol == "openai" && p.Protocol == "anthropic" {
		out = AnthropicRespToOpenAI(data, p.Name)
	} else if inboundProtocol == "anthropic" && p.Protocol == "openai" {
		out = OpenaiRespToAnthropic(data)
	}
	outBytes, _ := json.Marshal(out)
	logEntry(map[string]interface{}{
		"apiKeyId": apiKeyID, "provider": p, "modelName": entry.ModelName, "modelId": entry.ModelID,
		"upstreamBody": upstreamBody, "responseBody": string(outBytes),
		"inputTokens": captured.InputTokens, "outputTokens": captured.OutputTokens, "cachedTokens": captured.CachedTokens,
		"durationMs": durationMs,
	})
	stats.Record(stats.RecordInput{
		APIKeyID: apiKeyID, ProviderID: p.ID, ModelID: entry.ModelID, ModelName: entry.ModelName,
		RequestCount: 1, InputTokens: captured.InputTokens, OutputTokens: captured.OutputTokens, CachedTokens: captured.CachedTokens,
	})
	activeRequests.Add(-1)
	return out, nil
}

func handleStreamResponse(resp *http.Response, inbound, providerProto string, entry *modelmap.Entry,
	apiKeyID int64, upstreamBody map[string]interface{}, p modelmap.Provider, durationMs int64, w http.ResponseWriter) (interface{}, error) {

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, _ := w.(http.Flusher)

	needConvert := inbound == "openai" && providerProto == "anthropic"
	var intok, outtok, cachedtok int
	var outputBuf, sseBuf string
	msgID := ""
	doneSent := false
	toolBlockByIndex := map[int]map[string]string{}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 1024*1024), 8*1024*1024) // 8MB, 解决 thinking 超 64KB 截断
	scanner.Split(scanSSEEvent)
	for scanner.Scan() {
		text := scanner.Text()
		if strings.TrimSpace(text) == "" {
			continue
		}
		outputBuf += text
		parseTokens(text, providerProto, &intok, &outtok, &cachedtok)
		if needConvert {
			converted, newDone := anthropicSSEToOpenAI(text, &sseBuf, &msgID, toolBlockByIndex, &doneSent)
			if converted != "" {
				// ponytail: scanner strips the trailing \n\n; restore it so
				// OpenAI clients can split events cleanly.
				w.Write([]byte(converted))
				if !strings.HasSuffix(converted, "\n\n") {
					w.Write([]byte("\n\n"))
				}
				if flusher != nil {
					flusher.Flush()
				}
			}
			doneSent = newDone
		} else {
			w.Write([]byte(text))
			if !strings.HasSuffix(text, "\n\n") {
				w.Write([]byte("\n\n"))
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
	// ponytail: many providers (incl. MiniMax-M3) close the stream after
	// the finish_reason chunk without emitting [DONE]. Inject one so OpenAI
	// clients don't see "empty stream with no finish_reason".
	if !doneSent {
		w.Write([]byte("data: [DONE]\n\n"))
	}
	if flusher != nil {
		flusher.Flush()
	}

	stats.Record(stats.RecordInput{
		APIKeyID: apiKeyID, ProviderID: p.ID, ModelID: entry.ModelID, ModelName: entry.ModelName,
		RequestCount: 1, InputTokens: intok, OutputTokens: outtok, CachedTokens: cachedtok,
	})
	activeRequests.Add(-1)
	logEntry(map[string]interface{}{
		"apiKeyId": apiKeyID, "provider": p, "modelName": entry.ModelName, "modelId": entry.ModelID,
		"upstreamBody": upstreamBody, "responseBody": outputBuf,
		"inputTokens": intok, "outputTokens": outtok, "cachedTokens": cachedtok, "durationMs": durationMs,
	})
	return nil, nil
}

func scanSSEEvent(data []byte, atEOF bool) (int, []byte, error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	if i := strings.Index(string(data), "\n\n"); i >= 0 {
		return i + 2, data[0:i], nil
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func parseTokens(text, proto string, input, output, cached *int) {
	if !strings.Contains(text, "\"usage\"") {
		return
	}
	start := strings.Index(text, "{\"")
	if start < 0 {
		start = strings.Index(text, "{")
	}
	if start < 0 {
		return
	}
	depth := 0
	end := start
	for ; end < len(text); end++ {
		if text[end] == '{' {
			depth++
		}
		if text[end] == '}' {
			depth--
			if depth == 0 {
				break
			}
		}
	}
	if depth != 0 || end >= len(text) {
		return // ponytail: streaming tool_call fix — unterminated JSON would panic on json.Unmarshal slice
	}
	var u map[string]interface{}
	if err := json.Unmarshal([]byte(text[start:end+1]), &u); err != nil {
		return
	}
	usageObj, _ := u["usage"].(map[string]interface{})
	if usageObj == nil {
		return
	}
	if proto == "openai" {
		if v := toInt(usageObj["prompt_tokens"]); v > 0 {
			*input = v
		}
		if v := toInt(usageObj["completion_tokens"]); v > 0 {
			*output = v
		}
		if d, ok := usageObj["prompt_tokens_details"].(map[string]interface{}); ok {
			if v := toInt(d["cached_tokens"]); v > 0 {
				*cached = v
			}
		}
	} else {
		if v := toInt(usageObj["input_tokens"]); v > 0 {
			*input = v
		}
		if v := toInt(usageObj["output_tokens"]); v > 0 {
			*output = v
		}
		*cached = toInt(usageObj["cache_read_input_tokens"]) + toInt(usageObj["cache_creation_input_tokens"])
	}
}

var embedWhitelist = map[string]bool{
	"model": true, "input": true, "encoding_format": true, "dimensions": true, "user": true,
}

func ProxyEmbeddingRequest(body map[string]interface{}, apiKeyID int64, w http.ResponseWriter) (interface{}, error) {
	model := fmt.Sprint(body["model"])
	if model == "" || model == "auto" || model == "Nantianmen-default" {
		return nil, fmt.Errorf("/v1/embeddings requires explicit model")
	}
	entry, err := modelmap.ResolveModel(model)
	if err != nil {
		return nil, err
	}
	if entry.Capability != "embedding" {
		return nil, fmt.Errorf("model '%s' is not an embedding model", model)
	}
	if entry.Provider.Protocol != "openai" {
		return nil, fmt.Errorf("embedding only supports openai protocol")
	}

	upstreamBody := map[string]interface{}{"model": entry.ModelName}
	for k := range embedWhitelist {
		if k == "model" {
			continue
		}
		if v, ok := body[k]; ok {
			upstreamBody[k] = v
		}
	}
	originalInput := body["input"]
	arrayLen := 1
	if arr, ok := originalInput.([]interface{}); ok {
		arrayLen = len(arr)
	} else if _, ok := originalInput.(string); ok {
		arrayLen = 1
	}

	activeRequests.Add(1)
	t0 := time.Now()
	bodyBytes, _ := json.Marshal(upstreamBody)
	req, _ := http.NewRequest("POST", entry.Endpoint, strings.NewReader(string(bodyBytes)))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range entry.Headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	durationMs := time.Since(t0).Milliseconds()
	if err != nil {
		activeRequests.Add(-1)
		stats.Record(stats.RecordInput{
			APIKeyID: apiKeyID, ProviderID: entry.Provider.ID, ModelID: entry.ModelID, ModelName: entry.ModelName, RequestCount: 1,
		})
		logEntry(map[string]interface{}{
			"apiKeyId": apiKeyID, "provider": entry.Provider, "modelName": entry.ModelName, "modelId": entry.ModelID,
			"upstreamBody": map[string]interface{}{"model": entry.ModelName, "input_count": arrayLen},
			"responseBody": "", "inputTokens": 0, "outputTokens": 0, "cachedTokens": 0, "durationMs": durationMs,
			"error": map[string]interface{}{"code": 0, "message": err.Error()},
		})
		return nil, err
	}
	defer resp.Body.Close()
	bodyText, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		activeRequests.Add(-1)
		stats.Record(stats.RecordInput{
			APIKeyID: apiKeyID, ProviderID: entry.Provider.ID, ModelID: entry.ModelID, ModelName: entry.ModelName, RequestCount: 1,
		})
		logEntry(map[string]interface{}{
			"apiKeyId": apiKeyID, "provider": entry.Provider, "modelName": entry.ModelName, "modelId": entry.ModelID,
			"upstreamBody": map[string]interface{}{"model": entry.ModelName, "input_count": arrayLen},
			"responseBody": "", "inputTokens": 0, "outputTokens": 0, "cachedTokens": 0, "durationMs": durationMs,
			"error": map[string]interface{}{"code": resp.StatusCode, "message": fmt.Sprintf("Upstream %d: %s", resp.StatusCode, limitStr(string(bodyText), 500))},
		})
		return nil, fmt.Errorf("upstream %d: %s", resp.StatusCode, string(bodyText))
	}

	var jsonData map[string]interface{}
	json.Unmarshal(bodyText, &jsonData)
	dim := 0
	if data, ok := jsonData["data"].([]interface{}); ok && len(data) > 0 {
		if e, ok := data[0].(map[string]interface{}); ok {
			if emb, ok := e["embedding"].([]interface{}); ok {
				dim = len(emb)
			}
		}
	}
	stats.Record(stats.RecordInput{
		APIKeyID: apiKeyID, ProviderID: entry.Provider.ID, ModelID: entry.ModelID, ModelName: entry.ModelName, RequestCount: 1,
	})
	activeRequests.Add(-1)
	var inputStr string
	if s, ok := originalInput.(string); ok {
		inputStr = s
	} else if b, err := json.Marshal(originalInput); err == nil {
		inputStr = string(b)
	}
	metaOut, _ := json.Marshal(map[string]interface{}{
		"embedding_dim": dim, "embedding_count": len(jsonData["data"].([]interface{})),
		"model": jsonData["model"], "usage": jsonData["usage"],
	})
	logEntry(map[string]interface{}{
		"apiKeyId": apiKeyID, "provider": entry.Provider, "modelName": entry.ModelName, "modelId": entry.ModelID,
		"upstreamBody": inputStr, "responseBody": string(metaOut),
		"inputTokens": 0, "outputTokens": 0, "cachedTokens": 0, "durationMs": durationMs,
	})
	return jsonData, nil
}

func anthropicSSEToOpenAI(rawText string, buf *string, msgID *string, toolBlocks map[int]map[string]string, doneSent *bool) (string, bool) {
	*buf += rawText
	var out []string
	ts := time.Now().Unix()
	for {
		idx := strings.Index(*buf, "\n\n")
		if idx < 0 {
			break
		}
		event := (*buf)[:idx]
		*buf = (*buf)[idx+2:]
		lines := strings.Split(event, "\n")
		evType, dataStr := "", ""
		for _, line := range lines {
			if strings.HasPrefix(line, "event: ") {
				evType = line[7:]
			}
			if strings.HasPrefix(line, "data: ") {
				dataStr = line[6:]
			}
		}
		if dataStr == "" {
			continue
		}
		var data map[string]interface{}
		if json.Unmarshal([]byte(dataStr), &data) != nil {
			continue
		}
		switch evType {
		case "message_start":
			if m, ok := data["message"].(map[string]interface{}); ok {
				if id, ok := m["id"].(string); ok {
					*msgID = id
				}
			}
			b, _ := json.Marshal(map[string]interface{}{
				"id": *msgID, "object": "chat.completion.chunk", "created": ts, "model": "",
				"choices": []map[string]interface{}{{"index": 0, "delta": map[string]string{"role": "assistant", "content": ""}, "finish_reason": nil}},
			})
			out = append(out, "data: "+string(b)+"\n\n")
		case "content_block_start":
			if block, ok := data["content_block"].(map[string]interface{}); ok {
				bt, _ := block["type"].(string)
				if bt == "tool_use" || bt == "server_tool_use" {
					ttype := "function"
					if bt == "server_tool_use" {
						ttype = "custom"
					}
					idx := int(getFloat64(data["index"]))
					n := fmt.Sprint(block["name"])
					id := fmt.Sprint(block["id"])
					toolBlocks[idx] = map[string]string{"id": id, "name": n, "type": ttype}
					b, _ := json.Marshal(map[string]interface{}{
						"id": *msgID, "object": "chat.completion.chunk", "created": ts, "model": "",
						"choices": []map[string]interface{}{{"index": 0, "delta": map[string]interface{}{
							"tool_calls": []map[string]interface{}{{"index": idx, "id": block["id"], "type": ttype, "function": map[string]string{"name": n, "arguments": ""}}},
						}, "finish_reason": nil}},
					})
					out = append(out, "data: "+string(b)+"\n\n")
				}
			}
		case "content_block_delta":
			if delta, ok := data["delta"].(map[string]interface{}); ok {
				dt, _ := delta["type"].(string)
				if dt == "input_json_delta" {
					idx := int(getFloat64(data["index"]))
					if _, ok := toolBlocks[idx]; ok {
						b, _ := json.Marshal(map[string]interface{}{
							"id": *msgID, "object": "chat.completion.chunk", "created": ts, "model": "",
							"choices": []map[string]interface{}{{"index": 0, "delta": map[string]interface{}{
								"tool_calls": []map[string]interface{}{{"index": idx, "function": map[string]string{"arguments": fmt.Sprint(delta["partial_json"])}}},
							}, "finish_reason": nil}},
						})
						out = append(out, "data: "+string(b)+"\n\n")
					}
				} else if dt == "text_delta" {
					b, _ := json.Marshal(map[string]interface{}{
						"id": *msgID, "object": "chat.completion.chunk", "created": ts, "model": "",
						"choices": []map[string]interface{}{{"index": 0, "delta": map[string]string{"content": fmt.Sprint(delta["text"])}, "finish_reason": nil}},
					})
					out = append(out, "data: "+string(b)+"\n\n")
				}
			}
		case "message_delta":
			reason := "stop"
			if d, ok := data["delta"].(map[string]interface{}); ok {
				if sr, ok := d["stop_reason"].(string); ok {
					reason = stopReasonMap[sr]
					if reason == "" {
						reason = "stop"
					}
				}
			}
			b, _ := json.Marshal(map[string]interface{}{
				"id": *msgID, "object": "chat.completion.chunk", "created": ts, "model": "",
				"choices": []map[string]interface{}{{"index": 0, "delta": map[string]interface{}{}, "finish_reason": reason}},
			})
			out = append(out, "data: "+string(b)+"\n\n")
		case "message_stop":
			out = append(out, "data: [DONE]\n\n")
			*doneSent = true
		}
	}
	return strings.Join(out, ""), *doneSent
}
