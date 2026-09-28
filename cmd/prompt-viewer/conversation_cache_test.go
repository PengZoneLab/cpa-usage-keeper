package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestPersistentConversationCacheAuthorizationAndContext(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cache.db")
	cache, err := openConversationCache(path)
	if err != nil {
		t.Fatal(err)
	}
	reads, auths := 0, 0
	allow := true
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allow {
			w.WriteHeader(403)
			return
		}
		if strings.HasSuffix(r.URL.Path, "download-token") {
			auths++
			fmt.Fprint(w, `{"download_url":"/api/v1/usage/events/1/request-log/download-file?token=test"}`)
			return
		}
		reads++
		json.NewEncoder(w).Encode(map[string]any{"available": true, "sections": []logSection{{Title: "REQUEST BODY", Content: `{"messages":[{"role":"system","content":"` + strings.Repeat("x", 2<<20) + `"},{"role":"user","content":"hello"}]}`}, {Title: "RESPONSE", Content: `{"choices":[{"message":{"content":"world"}}]}`}}})
	}))
	defer backend.Close()
	target, _ := url.Parse(backend.URL)
	request := func(full bool) *httptest.ResponseRecorder {
		path := "/api/v1/usage/events/1/conversation"
		if full {
			path += "?context=1"
		}
		w := httptest.NewRecorder()
		handlerWithStores(target, fstest.MapFS{}, nil, cache).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}
	cache.put(context.Background(), target.String()+"/1", conversationPayload{Available: true, Input: "stale system fallback", Output: "old", OutputAvailable: true, CacheComplete: true})
	w := request(false)
	if w.Code != 200 || w.Body.Len() > 1000 || strings.Contains(w.Body.String(), "role_messages") {
		t.Fatalf("summary not lightweight: %d %d", w.Code, w.Body.Len())
	}
	cache.db.Close()
	cache, err = openConversationCache(path)
	if err != nil {
		t.Fatal(err)
	}
	defer cache.db.Close()
	w = request(false)
	if reads != 1 || auths != 1 || w.Code != 200 {
		t.Fatalf("persistent hit failed reads=%d auths=%d", reads, auths)
	}
	w = request(true)
	var p conversationPayload
	json.Unmarshal(w.Body.Bytes(), &p)
	if len(p.FullInput) < 2<<20 || p.Input != "hello" || p.Output != "world" || len(p.RoleMessages) != 2 || p.RoleMessages[0].Role != "system" || p.RoleMessages[1].Content != "hello" || p.TurnKey == "" || p.TurnConfidence != "user_history" {
		t.Fatal("context lost")
	}
	w = request(false)
	if strings.Contains(w.Body.String(), "role_messages") || w.Body.Len() > 1000 || !strings.Contains(w.Body.String(), `"turn_confidence":"user_history"`) {
		t.Fatal("context contaminated lightweight cache")
	}
	allow = false
	w = request(false)
	if w.Code != 403 || strings.Contains(w.Body.String(), "world") {
		t.Fatal("cached data leaked after permission revoked")
	}
}
func TestConversationCacheExpiry(t *testing.T) {
	c, e := openConversationCache(filepath.Join(t.TempDir(), "cache.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer c.db.Close()
	ctx := context.Background()
	c.put(ctx, "missing", conversationPayload{})
	if _, ok := c.get(ctx, "missing", false); ok {
		t.Fatal("missing cached")
	}
	c.put(ctx, "pending", conversationPayload{Available: true, Input: "hi"})
	var expiry int64
	c.db.QueryRow(`SELECT expires_at FROM parsed_conversations_v1 WHERE cache_key='pending'`).Scan(&expiry)
	if expiry > time.Now().Add(16*time.Second).Unix() {
		t.Fatal("incomplete TTL excessive")
	}
	c.db.Exec(`UPDATE parsed_conversations_v1 SET expires_at=0`)
	if _, ok := c.get(ctx, "pending", false); ok {
		t.Fatal("expired served")
	}
}
func TestPartialSSEIsNotStableCache(t *testing.T) {
	p := parseConversation([]logSection{{Title: "RESPONSE", Content: `data: {"type":"response.output_text.delta","delta":"partial"}`}})
	if !p.OutputAvailable || p.CacheComplete {
		t.Fatal("partial SSE treated as complete")
	}
	for _, body := range []string{`data: [DONE]`, `data: {"type":"response.completed"}`, `data: {"type":"message_stop"}`, "Status: 200\nContent-Type: application/json\n\n{}"} {
		if !responseComplete(body) {
			t.Fatalf("terminal marker not detected %q", body)
		}
	}
}
