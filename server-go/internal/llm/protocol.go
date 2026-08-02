package llm

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type TokenUsage struct {
	InputTokens  int
	OutputTokens int
	CachedTokens int
}

func toInt(v interface{}) int {
	switch n := v.(type) {
	case float64: return int(n)
	case int: return n
	case int64: return int(n)
	}
	return 0
}

func ExtractTokensOpenAI(u interface{}) TokenUsage {
	usage, _ := u.(map[string]interface{})
	if usage == nil { return TokenUsage{} }
	get := func(k string) int { if v, ok := usage[k]; ok { return toInt(v) }; return 0 }
	cached := 0
	if d, ok := usage["prompt_tokens_details"].(map[string]interface{}); ok { cached = toInt(d["cached_tokens"]) }
	return TokenUsage{InputTokens: get("prompt_tokens"), OutputTokens: get("completion_tokens"), CachedTokens: cached}
}

func ExtractTokensAnthropic(u interface{}) TokenUsage {
	usage, _ := u.(map[string]interface{})
	if usage == nil { return TokenUsage{} }
	get := func(k string) int { if v, ok := usage[k]; ok { return toInt(v) }; return 0 }
	return TokenUsage{InputTokens: get("input_tokens"), OutputTokens: get("output_tokens"), CachedTokens: get("cache_read_input_tokens") + get("cache_creation_input_tokens")}
}

func OpenaiReqToAnthropic(body map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if m, ok := body["model"]; ok { out["model"] = m }
	if msgs, ok := body["messages"].([]interface{}); ok {
		var content []map[string]interface{}
		var sys string
		for _, item := range msgs { msg,_ := item.(map[string]interface{}); role,_ := msg["role"].(string)
			c := ""; if s,ok := msg["content"].(string); ok { c = s } else if b,err := json.Marshal(msg["content"]); err==nil { c = string(b) }
			if role == "system" { if sys != "" { sys += "\n" }; sys += c; continue }
			r := "user"; if role == "assistant" { r = "assistant" }
			content = append(content, map[string]interface{}{"role":r,"content":c}) }
		if sys != "" { out["system"] = sys }
		out["messages"] = content }
	for _, f := range []string{"max_tokens","temperature","stream"} { if v, ok := body[f]; ok { out[f] = v } }
	return out
}

func AnthropicReqToOpenai(body map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if m, ok := body["model"]; ok { out["model"] = m }
	msgs := []map[string]interface{}{}
	if s, ok := body["system"].(string); ok && s != "" { msgs = append(msgs, map[string]interface{}{"role":"system","content":s}) }
	if arr, ok := body["messages"].([]interface{}); ok {
		for _, item := range arr { msg,_ := item.(map[string]interface{}); role,_ := msg["role"].(string)
			r := "user"; if role == "assistant" { r = "assistant" }
			c := ""; if s,ok := msg["content"].(string); ok { c = s } else if b,err := json.Marshal(msg["content"]); err==nil { c = string(b) }
			msgs = append(msgs, map[string]interface{}{"role":r,"content":c}) } }
	out["messages"] = msgs
	for _, f := range []string{"max_tokens","temperature","stream"} { if v, ok := body[f]; ok { out[f] = v } }
	return out
}

var stopReasonMap = map[string]string{"end_turn":"stop","max_tokens":"length","tool_use":"tool_calls","refusal":"content_filter"}

func AnthropicRespToOpenAI(data map[string]interface{}, providerName string) map[string]interface{} {
	blocks,_ := data["content"].([]interface{})
	rawText := ""; for _, b := range blocks { block,_ := b.(map[string]interface{}); if t,ok := block["type"].(string); ok && t=="text" { if txt,ok := block["text"].(string); ok { rawText += txt } } }
	isMiniMax := strings.Contains(strings.ToLower(providerName), "minimax")
	cleanText := rawText; var toolCalls []map[string]interface{}
	if rawText != "" && isMiniMax { cleanText, toolCalls = parseMinimaxToolCalls(rawText) }
	for _, b := range blocks { block,_ := b.(map[string]interface{}); if tc := blockToToolCall(block); tc != nil { toolCalls = append(toolCalls, tc) } }
	stopReason := stopReasonMap[fmt.Sprint(data["stop_reason"])]; if stopReason == "" { stopReason = "stop" }
	finishReason := stopReason; if len(toolCalls) > 0 { finishReason = "tool_calls" }
	result := map[string]interface{}{"id":data["id"],"object":"chat.completion","created":time.Now().Unix(),"model":data["model"],"choices":[]map[string]interface{}{{"index":0,"message":map[string]interface{}{"role":"assistant","content":cleanText},"finish_reason":finishReason}}}
	if len(toolCalls)>0 { result["choices"].([]map[string]interface{})[0]["message"].(map[string]interface{})["tool_calls"] = toolCalls }
	if u,ok := data["usage"].(map[string]interface{}); ok { t := ExtractTokensAnthropic(u); result["usage"] = map[string]int{"prompt_tokens":t.InputTokens,"completion_tokens":t.OutputTokens,"total_tokens":t.InputTokens+t.OutputTokens} }
	return result
}

func OpenaiRespToAnthropic(data map[string]interface{}) map[string]interface{} {
	choices,_ := data["choices"].([]interface{}); msg := map[string]interface{}{}; if len(choices)>0 { if c,ok := choices[0].(map[string]interface{}); ok { if m,ok := c["message"].(map[string]interface{}); ok { msg = m } } }
	return map[string]interface{}{"id":data["id"],"type":"message","role":"assistant","model":data["model"],"content":[]map[string]interface{}{{"type":"text","text":msg["content"]}}}
}

func blockToToolCall(block map[string]interface{}) map[string]interface{} {
	t,_ := block["type"].(string); if t != "tool_use" && t != "server_tool_use" { return nil }
	name,_ := block["name"].(string); input,_ := json.Marshal(block["input"])
	if t == "server_tool_use" { return map[string]interface{}{"id":block["id"],"type":"custom","custom":map[string]string{"name":name,"input":string(input)}} }
	return map[string]interface{}{"id":block["id"],"type":"function","function":map[string]string{"name":name,"arguments":string(input)}}
}

var toolCallRe = regexp.MustCompile(`<tool_call>(.*?)</tool_call>`)
var invokeRe   = regexp.MustCompile(`<invoke\s+name="([^"]+)">(.*?)</invoke>`)
var paramRe    = regexp.MustCompile(`<(query|parameter)(?:\s+name="([^"]*)")?>(.*?)</(?:query|parameter)>`)

func parseMinimaxToolCalls(text string) (string, []map[string]interface{}) {
	cleaned := strings.ReplaceAll(text, "<]minimax[>[", "")
	if m := toolCallRe.FindStringSubmatch(cleaned); m != nil {
		var tcs []map[string]interface{}; callID := 0
		for _, inv := range invokeRe.FindAllStringSubmatch(m[1], -1) {
			name := inv[1]; body := inv[2]; args := map[string]string{}
			for _, pm := range paramRe.FindAllStringSubmatch(body, -1) {
				key := "query"; if pm[1] == "parameter" && pm[2] != "" { key = pm[2] }
				args[key] = strings.TrimSpace(pm[3]) }
			callID++; tcs = append(tcs, map[string]interface{}{"id":fmt.Sprintf("minimax_%d",callID),"type":"function","function":map[string]string{"name":name,"arguments":jsonStr(args)}}) }
		c := toolCallRe.ReplaceAllString(cleaned, ""); c = strings.TrimSpace(c); return c, tcs }
	return cleaned, nil
}

func jsonStr(v interface{}) string { b,_ := json.Marshal(v); return string(b) }
