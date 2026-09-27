package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const conversationMaxBytes = 128 << 20

var conversationSlots = make(chan struct{}, 3)

type conversationPayload struct {
	Available       bool   `json:"available"`
	Input           string `json:"input"`
	Output          string `json:"output"`
	FullInput       string `json:"full_input"`
	InputAvailable  bool   `json:"input_available"`
	OutputAvailable bool   `json:"output_available"`
	Error           string `json:"error,omitempty"`
}
type logSection struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

func conversationEventID(path string) (string, bool) {
	const prefix = "/api/v1/usage/events/"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, "/conversation") {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), "/conversation")
	n, err := strconv.ParseInt(id, 10, 64)
	return id, err == nil && n > 0 && strconv.FormatInt(n, 10) == id
}

// Every request is authorized by the existing Keeper request-log endpoint before
// obtaining its single-use download URL. No local logs or alternate collectors.
func serveConversation(w http.ResponseWriter, r *http.Request, target *url.URL, id string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	fail := func(status int, message string) {
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(conversationPayload{Error: message})
	}
	if r.Method != "GET" {
		w.Header().Set("Allow", "GET")
		fail(405, "method not allowed")
		return
	}
	select {
	case conversationSlots <- struct{}{}:
		defer func() { <-conversationSlots }()
	case <-r.Context().Done():
		return
	}
	client := &http.Client{Timeout: 90 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	fetch := func(method, path string) (*http.Response, error) {
		u := *target
		u.Path = ""
		u.RawPath = ""
		u.RawQuery = ""
		ref, err := url.Parse(path)
		if err != nil {
			return nil, err
		}
		u.Path = ref.Path
		u.RawQuery = ref.RawQuery
		req, err := http.NewRequestWithContext(r.Context(), method, u.String(), nil)
		if err != nil {
			return nil, err
		}
		for _, key := range []string{"Cookie", "Authorization", "X-CPA-Usage-Keeper-Embed", "X-CPA-Usage-Keeper-Embed-Session", "Origin", "Referer"} {
			if v := r.Header.Get(key); v != "" {
				req.Header.Set(key, v)
			}
		}
		req.Header.Set("X-CPA-Usage-Keeper-Request", "fetch")
		req.Header.Set("Accept-Encoding", "identity")
		return client.Do(req)
	}
	read := func(resp *http.Response, limit int64) ([]byte, error) {
		defer resp.Body.Close()
		for _, v := range resp.Header.Values("Set-Cookie") {
			w.Header().Add("Set-Cookie", v)
		}
		b, e := io.ReadAll(io.LimitReader(resp.Body, limit+1))
		if int64(len(b)) > limit {
			return nil, fmt.Errorf("size limit")
		}
		return b, e
	}
	base := "/api/v1/usage/events/" + id + "/request-log"
	resp, err := fetch("GET", base)
	if err != nil {
		fail(502, "Keeper request log unavailable")
		return
	}
	status := resp.StatusCode
	body, err := read(resp, 40<<20)
	if status != 200 {
		fail(status, "Keeper denied or could not retrieve this request log")
		return
	}
	if err != nil {
		fail(502, "Could not read request log")
		return
	}
	var preview struct {
		Available bool         `json:"available"`
		TooLarge  bool         `json:"too_large"`
		Sections  []logSection `json:"sections"`
	}
	if json.Unmarshal(body, &preview) != nil {
		fail(502, "Invalid Keeper log response")
		return
	}
	if !preview.Available && !preview.TooLarge {
		json.NewEncoder(w).Encode(conversationPayload{Error: "Request log is unavailable"})
		return
	}
	if !preview.TooLarge {
		json.NewEncoder(w).Encode(parseConversation(preview.Sections))
		return
	}
	resp, err = fetch("POST", base+"/download-token")
	if err != nil {
		fail(502, "Could not authorize log download")
		return
	}
	status = resp.StatusCode
	body, err = read(resp, 64<<10)
	if status != 200 {
		fail(status, "Keeper denied log download")
		return
	}
	if err != nil {
		fail(502, "Invalid download authorization")
		return
	}
	var token struct {
		URL string `json:"download_url"`
	}
	if json.Unmarshal(body, &token) != nil {
		fail(502, "Invalid download authorization")
		return
	}
	link, err := url.Parse(token.URL)
	if err != nil || link.IsAbs() || link.Host != "" || link.Fragment != "" || link.Path != base+"/download-file" || link.RawPath != "" || link.Query().Get("token") == "" {
		fail(502, "Invalid log download URL")
		return
	}
	resp, err = fetch("GET", link.String())
	if err != nil {
		fail(502, "Could not download request log")
		return
	}
	status = resp.StatusCode
	body, err = read(resp, conversationMaxBytes)
	if status != 200 {
		fail(status, "Keeper could not download this log")
		return
	}
	if err != nil {
		fail(413, "Request log exceeds the 128 MiB conversation limit; download the original log")
		return
	}
	json.NewEncoder(w).Encode(parseConversation(splitLogSections(string(body))))
}

func splitLogSections(raw string) []logSection {
	var result []logSection
	start, title := 0, ""
	offset := 0
	for _, line := range strings.SplitAfter(raw, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "===") && strings.HasSuffix(t, "===") {
			if title != "" {
				result = append(result, logSection{Title: title, Content: raw[start:offset]})
			}
			title = strings.TrimSpace(strings.Trim(t, "="))
			start = offset + len(line)
		}
		offset += len(line)
	}
	if title != "" {
		result = append(result, logSection{Title: title, Content: raw[start:]})
	}
	return result
}
func pretty(v any) string { b, _ := json.MarshalIndent(v, "", "  "); return string(b) }
func textContent(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case []any:
		var parts []string
		for _, a := range x {
			if s := textContent(a); s != "" {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		if x["type"] == "reasoning" {
			return textContent(x["summary"])
		}
		if s, ok := x["text"].(string); ok {
			return s
		}
		if s, ok := x["content"]; ok {
			return textContent(s)
		}
		if s, ok := x["parts"]; ok {
			return textContent(s)
		}
		if x["type"] == "tool_use" || x["type"] == "function_call" || x["type"] == "custom_tool_call" || x["function"] != nil {
			return pretty(x)
		}
	}
	return ""
}
func latestUser(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case []any:
		for i := len(x) - 1; i >= 0; i-- {
			m, ok := x[i].(map[string]any)
			if ok && m["role"] == "user" {
				return textContent(m)
			}
		}
	case map[string]any:
		for _, k := range []string{"messages", "input", "contents"} {
			if s := latestUser(x[k]); s != "" {
				return s
			}
		}
		for _, k := range []string{"prompt", "instructions", "system"} {
			if s := textContent(x[k]); s != "" {
				return s
			}
		}
	}
	return ""
}
func responseText(m map[string]any) string {
	if s := textContent(m["output_text"]); s != "" {
		return s
	}
	if s := textContent(m["output"]); s != "" {
		return s
	}
	if s := textContent(m["content"]); s != "" {
		return s
	}
	if arr, ok := m["choices"].([]any); ok {
		var parts []string
		for _, c := range arr {
			choice, _ := c.(map[string]any)
			if choice == nil {
				continue
			}
			if msg, ok := choice["message"].(map[string]any); ok {
				if s := textContent(msg); s != "" {
					parts = append(parts, s)
				}
				if calls := msg["tool_calls"]; calls != nil {
					parts = append(parts, pretty(calls))
				}
			} else if s := textContent(choice["text"]); s != "" {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, "\n")
	}
	if candidates, ok := m["candidates"].([]any); ok {
		return textContent(candidates)
	}
	if e := m["error"]; e != nil {
		return pretty(e)
	}
	return ""
}
func parseResponse(raw string) string {
	raw = strings.TrimSpace(raw)
	// CPA sections may prefix the payload with status, headers and a Body label.
	if i := strings.Index(raw, "\nBody:"); i >= 0 {
		raw = strings.TrimSpace(raw[i+len("\nBody:"):])
	}
	if strings.HasPrefix(raw, "Body:") {
		raw = strings.TrimSpace(strings.TrimPrefix(raw, "Body:"))
	}
	// CPA final RESPONSE uses HTTP-style headers followed by a blank line,
	// without the Body: marker used in API RESPONSE sections.
	if strings.HasPrefix(raw, "Status:") || strings.HasPrefix(raw, "HTTP/") {
		normalized := strings.ReplaceAll(raw, "\r\n", "\n")
		if i := strings.Index(normalized, "\n\n"); i >= 0 {
			raw = strings.TrimSpace(normalized[i+2:])
		}
	}
	var m map[string]any
	if json.Unmarshal([]byte(raw), &m) == nil {
		return responseText(m)
	}
	var delta strings.Builder
	var tools strings.Builder
	var completedItems []string
	final := ""
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "[DONE]" {
			continue
		}
		m = nil
		if json.Unmarshal([]byte(payload), &m) != nil {
			continue
		}
		typ, _ := m["type"].(string)
		switch typ {
		case "response.completed", "response.done":
			if res, ok := m["response"].(map[string]any); ok {
				final = responseText(res)
			}
		case "response.output_item.done":
			if item, ok := m["item"].(map[string]any); ok {
				if value := textContent(item); value != "" {
					completedItems = append(completedItems, value)
				}
			}
		case "response.output_text.delta":
			s, _ := m["delta"].(string)
			delta.WriteString(s)
		case "response.function_call_arguments.delta", "response.custom_tool_call_input.delta":
			s, _ := m["delta"].(string)
			tools.WriteString(s)
		case "content_block_delta":
			if d, ok := m["delta"].(map[string]any); ok {
				if s, ok := d["text"].(string); ok {
					delta.WriteString(s)
				}
				if s, ok := d["partial_json"].(string); ok {
					tools.WriteString(s)
				}
			}
		case "content_block_start":
			if b, ok := m["content_block"].(map[string]any); ok {
				if s, ok := b["text"].(string); ok {
					delta.WriteString(s)
				}
				if b["type"] == "tool_use" {
					if name, ok := b["name"].(string); ok {
						tools.WriteString(name + " ")
					}
				}
			}
		default:
			if choices, ok := m["choices"].([]any); ok {
				for _, c := range choices {
					ch, _ := c.(map[string]any)
					d, _ := ch["delta"].(map[string]any)
					if d != nil {
						if s, ok := d["content"].(string); ok {
							delta.WriteString(s)
						}
						if calls, ok := d["tool_calls"].([]any); ok {
							for _, call := range calls {
								cm, _ := call.(map[string]any)
								fn, _ := cm["function"].(map[string]any)
								if s, ok := fn["name"].(string); ok {
									tools.WriteString(s + " ")
								}
								if s, ok := fn["arguments"].(string); ok {
									tools.WriteString(s)
								}
							}
						}
					}
				}
			}
		}
	}
	if final != "" {
		return final
	}
	if len(completedItems) > 0 {
		return strings.Join(completedItems, "\n\n")
	}
	result := delta.String()
	if tools.Len() > 0 {
		if result != "" {
			result += "\n\n"
		}
		result += "[Tool call]\n" + tools.String()
	}
	return result
}
func parseConversation(sections []logSection) conversationPayload {
	result := conversationPayload{Available: true}
	for _, s := range sections {
		if strings.EqualFold(strings.TrimSpace(s.Title), "REQUEST BODY") {
			result.FullInput = strings.TrimSpace(s.Content)
			var v any
			if json.Unmarshal([]byte(s.Content), &v) == nil {
				result.Input = latestUser(v)
			}
			if result.Input == "" {
				result.Input = result.FullInput
			}
			break
		}
	}
	// Prefer the response returned to the client over internal retry responses.
	for _, title := range []string{"RESPONSE BODY", "RESPONSE", "API RESPONSE"} {
		for i := len(sections) - 1; i >= 0; i-- {
			s := sections[i]
			if strings.EqualFold(strings.TrimSpace(s.Title), title) || (title == "API RESPONSE" && strings.HasPrefix(strings.ToUpper(strings.TrimSpace(s.Title)), "API RESPONSE ")) {
				result.Output = parseResponse(s.Content)
				result.InputAvailable = result.Input != ""
				result.OutputAvailable = result.Output != ""
				return result
			}
		}
		if result.Output != "" {
			break
		}
	}
	result.InputAvailable = result.Input != ""
	result.OutputAvailable = result.Output != ""
	return result
}
