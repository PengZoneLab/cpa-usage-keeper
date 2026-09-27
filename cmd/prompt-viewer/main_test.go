package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
)

func TestViewerRoutes(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "keeper=test" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Set-Cookie", "keeper=renewed; HttpOnly; SameSite=Lax")
		w.Header().Set("Content-Disposition", `attachment; filename="request.log"`)
		data, _ := io.ReadAll(r.Body)
		w.Write([]byte(r.Method + " " + r.URL.RequestURI() + " " + string(data)))
	}))
	defer backend.Close()
	target, _ := url.Parse(backend.URL)
	h := handler(target, fstest.MapFS{"index.html": {Data: []byte(`window.base="__APP_BASE_PATH__"; PROMPT UI`)}, "assets/app.js": {Data: []byte("asset")}})
	for _, path := range []string{"/", "/usage", "/analysis", "/index.html"} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest("GET", path, nil))
		if rr.Code != 200 || !strings.Contains(rr.Body.String(), "PROMPT UI") || strings.Contains(rr.Body.String(), "__APP_BASE_PATH__") {
			t.Fatalf("SPA %s: %d %s", path, rr.Code, rr.Body.String())
		}
	}
	for _, path := range []string{"/api/v1/status", "/api/v1/usage/events/1/request-log"} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest("GET", path, nil))
		if rr.Code != 401 {
			t.Fatalf("unauthenticated API: %d", rr.Code)
		}
	}
	req := httptest.NewRequest("POST", "/api/v1/usage/events/1/request-log/download-token?x=1", strings.NewReader(`{"test":true}`))
	req.Header.Set("Cookie", "keeper=test")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 || rr.Body.String() != `POST /api/v1/usage/events/1/request-log/download-token?x=1 {"test":true}` || rr.Header().Get("Set-Cookie") == "" || rr.Header().Get("Content-Disposition") == "" {
		t.Fatalf("proxy mismatch: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("GET", "/assets/missing.js", nil))
	if rr.Code != 404 {
		t.Fatal("missing asset must be 404")
	}
}
