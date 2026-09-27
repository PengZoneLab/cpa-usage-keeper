package main

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestSessionMetadataReadOnlyAndAuthorizedIDs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.db")
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec("CREATE TABLE usage_events(id INTEGER,session_id TEXT,parent_session_id TEXT); INSERT INTO usage_events VALUES(1,'visible','parent'),(2,'secret',NULL),(3,'',NULL)")
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	store, err := openSessionMetadata(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()
	if _, err = store.db.Exec("DELETE FROM usage_events"); err == nil {
		t.Fatal("database must reject writes")
	}
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") == "" {
			w.WriteHeader(401)
			w.Write([]byte(`{"error":"denied"}`))
			return
		}
		if r.Header.Get("Accept-Encoding") != "identity" {
			t.Error("must request uncompressed JSON")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", "old")
		w.Write([]byte(`{"events":[{"id":"1","extra":1234567890123456789},{"id":"3"}],"total_count":2}`))
	}))
	defer backend.Close()
	target, _ := url.Parse(backend.URL)
	h := handlerWithUsageDB(target, fstest.MapFS{}, store)
	denied := httptest.NewRecorder()
	h.ServeHTTP(denied, httptest.NewRequest("GET", "/api/v1/usage/events", nil))
	if denied.Code != 401 || strings.Contains(denied.Body.String(), "session") {
		t.Fatal("authorization bypass")
	}
	r := httptest.NewRequest("GET", "/api/v1/usage/events", nil)
	r.Header.Set("Cookie", "authorized")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || strings.Contains(w.Body.String(), "secret") || !strings.Contains(w.Body.String(), `"extra":1234567890123456789`) || w.Header().Get("ETag") != "" {
		t.Fatalf("unexpected enrichment %d %s", w.Code, w.Body.String())
	}
	var p struct {
		Available bool `json:"session_metadata_available"`
		Events    []struct {
			Session   string `json:"session_id"`
			Available bool   `json:"session_metadata_available"`
		}
	}
	json.Unmarshal(w.Body.Bytes(), &p)
	if !p.Available || len(p.Events) != 2 || p.Events[0].Session != "visible" || !p.Events[1].Available || p.Events[1].Session != "" {
		t.Fatalf("incorrect metadata: %+v", p)
	}
}
func TestSessionMetadataUnavailable(t *testing.T) {
	if _, err := openSessionMetadata(filepath.Join(t.TempDir(), "missing.db")); err == nil {
		t.Fatal("must not create missing DB")
	}
	var store *sessionMetadataStore
	req := httptest.NewRequest("GET", "/api/v1/usage/events", nil)
	resp := &http.Response{StatusCode: 200, Request: req, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"events":[{"id":"7"}],"total_count":1}`))}
	if err := store.enrichResponse(resp); err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	if strings.Count(string(b), `"session_metadata_available":false`) != 2 {
		t.Fatal(string(b))
	}
}

func TestSessionMetadataMissingRowAndSchemaFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.db")
	db, _ := sql.Open("sqlite3", path)
	db.Exec("CREATE TABLE usage_events(id INTEGER, session_id TEXT, parent_session_id TEXT)")
	defer db.Close()
	store, err := openSessionMetadata(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()
	for _, drop := range []bool{false, true} {
		if drop {
			if _, err := db.Exec("DROP TABLE usage_events"); err != nil {
				t.Fatal(err)
			}
		}
		resp := &http.Response{StatusCode: 200, Request: httptest.NewRequest("GET", "/api/v1/usage/events", nil), Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"events":[{"id":"7"}],"total_count":1}`))}
		if err := store.enrichResponse(resp); err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(resp.Body)
		if strings.Count(string(b), `"session_metadata_available":false`) != 2 {
			t.Fatalf("drop=%v %s", drop, b)
		}
	}
}
