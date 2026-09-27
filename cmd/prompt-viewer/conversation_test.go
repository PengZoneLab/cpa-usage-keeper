package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
)

func TestConversationParsing(t *testing.T) {
	cases := []struct{ name, body, want string }{
		{"chat", `{"choices":[{"message":{"content":"hello"}}]}`, "hello"},
		{"responses", `data: {"type":"response.output_text.delta","delta":"duplicate"}` + "\n" + `data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"final"}]}]}}`, "final"},
		{"chat SSE", "data: {\"choices\":[{\"delta\":{\"content\":\"hi \"}}]}\ndata: {\"choices\":[{\"delta\":{\"content\":\"there\"}}]}\ndata: [DONE]", "hi there"},
		{"anthropic", "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"你好\"}}", "你好"},
		{"tool", `data: {"type":"response.completed","response":{"output":[{"type":"custom_tool_call","name":"exec","input":"echo hello"}]}}`, "echo hello"},
		{"item done", `data: {"type":"response.output_item.done","item":{"type":"function_call","name":"exec","arguments":"{}"}}`, "exec"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := parseConversation([]logSection{{Title: "REQUEST BODY", Content: `{"messages":[{"role":"user","content":"old"},{"role":"assistant","content":"answer"},{"role":"user","content":"latest"}]}`}, {Title: "API RESPONSE 1", Content: c.body}, {Title: "RESPONSE", Content: c.body}})
			if p.Input != "latest" || !strings.Contains(p.Output, c.want) || !p.OutputAvailable || !strings.Contains(p.FullInput, "old") {
				t.Fatalf("unexpected parsed data %+v", p)
			}
		})
	}
}
func TestConversationAuthorizationAndLargeLog(t *testing.T) {
	for _, mode := range []string{"unauthorized", "forbidden", "missing", "large", "external", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			downloads := 0
			backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Cookie") != "keeper=test" {
					t.Error("cookie not forwarded")
				}
				switch {
				case strings.HasSuffix(r.URL.Path, "request-log"):
					if mode == "unauthorized" {
						w.WriteHeader(401)
						return
					}
					if mode == "forbidden" {
						w.WriteHeader(403)
						return
					}
					if mode == "missing" {
						fmt.Fprint(w, `{"available":false}`)
						return
					}
					fmt.Fprint(w, `{"available":true,"too_large":true}`)
				case strings.HasSuffix(r.URL.Path, "download-token"):
					if r.Method != "POST" || r.Header.Get("X-CPA-Usage-Keeper-Request") != "fetch" {
						t.Error("missing intent")
					}
					if mode == "external" {
						fmt.Fprint(w, `{"download_url":"https://example.com/secrets"}`)
						return
					}
					fmt.Fprint(w, `{"download_url":"/api/v1/usage/events/1/request-log/download-file?token=safe"}`)
				default:
					downloads++
					if mode == "redirect" {
						w.Header().Set("Location", "https://example.com")
						w.WriteHeader(302)
						return
					}
					fmt.Fprint(w, "=== REQUEST BODY ===\n{\"messages\":[{\"role\":\"user\",\"content\":\""+strings.Repeat("x", 7<<20)+"\"}]}\n=== RESPONSE ===\n{\"choices\":[{\"message\":{\"content\":\"large works\"}}]}")
				}
			}))
			defer backend.Close()
			u, _ := url.Parse(backend.URL)
			h := handler(u, fstest.MapFS{})
			r := httptest.NewRequest("GET", "/api/v1/usage/events/1/conversation", nil)
			r.Header.Set("Cookie", "keeper=test")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			switch mode {
			case "unauthorized":
				if w.Code != 401 || downloads != 0 {
					t.Fatal(w.Code)
				}
			case "forbidden":
				if w.Code != 403 || downloads != 0 {
					t.Fatal(w.Code)
				}
			case "missing":
				var p conversationPayload
				json.Unmarshal(w.Body.Bytes(), &p)
				if p.Available || downloads != 0 {
					t.Fatal("missing log incorrect")
				}
			case "external":
				if w.Code != 502 || downloads != 0 {
					t.Fatal("unsafe URL followed")
				}
			case "redirect":
				if w.Code != 302 {
					t.Fatal("redirect followed")
				}
			case "large":
				var p conversationPayload
				if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
					t.Fatal(err)
				}
				if p.Output != "large works" || len(p.Input) != 7<<20 {
					t.Fatalf("large log not recovered: %d %d", w.Code, len(p.Input))
				}
			}
		})
	}
}

func TestConversationFinalResponseNeverFallsBackToInternalAttempt(t *testing.T) {
	p := parseConversation([]logSection{{Title: "API RESPONSE 1", Content: `{"choices":[{"message":{"content":"internal retry"}}]}`}, {Title: "RESPONSE", Content: "Status: 502\nBody:\nupstream unavailable"}})
	if p.OutputAvailable || p.Output != "" {
		t.Fatal("internal retry leaked into final response")
	}
}
func TestConversationMixedToolsAndExistingReasoningSummary(t *testing.T) {
	p := parseResponse(`data: {"type":"response.completed","response":{"output":[{"type":"reasoning","summary":[{"type":"summary_text","text":"existing summary"}],"encrypted_content":"SECRET_ENCRYPTED"},{"type":"message","content":[{"type":"output_text","text":"answer"}]},{"type":"custom_tool_call","name":"terminal","input":"ls"},{"type":"function_call","name":"search","arguments":"{\"q\":\"hello\"}"}]}}`)
	for _, want := range []string{"existing summary", "answer", "terminal", "ls", "search", "hello"} {
		if !strings.Contains(p, want) {
			t.Fatalf("missing %s", want)
		}
	}
	if strings.Contains(p, "SECRET_ENCRYPTED") {
		t.Fatal("opaque reasoning leaked")
	}
}
func TestLargeSSESectionSplitting(t *testing.T) {
	// Multiple megabytes of short SSE lines previously caused quadratic copying.
	raw := "=== REQUEST BODY ===\n{\"input\":\"question\"}\n=== API RESPONSE 1 ===\n" + strings.Repeat("data: {\"type\":\"ping\"}\n", 600000) + "=== RESPONSE ===\nStatus: 200\nHeaders:\nContent-Type: text/event-stream\nBody:\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"done\"}\n"
	p := parseConversation(splitLogSections(raw))
	if p.Input != "question" || p.Output != "done" {
		t.Fatal("large SSE sections incorrect")
	}
}

func TestFinalResponseHTTPHeadersWithoutBodyMarker(t *testing.T) {
	for _, newline := range []string{"\n", "\r\n"} {
		raw := strings.Join([]string{"Status: 200", "Content-Type: application/json", "Access-Control-Allow-Origin: *", "", `{"choices":[{"message":{"content":"20"}}]}`}, newline)
		if got := parseResponse(raw); got != "20" {
			t.Fatalf("expected final 20, got %q", got)
		}
	}
}
