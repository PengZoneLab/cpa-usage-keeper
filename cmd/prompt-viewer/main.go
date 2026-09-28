// prompt-viewer serves the forked UI and reuses the existing Keeper API.
// It optionally reads session metadata from SQLite in read-only mode; never consumes CPA queues.
package main

import (
	"bytes"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"cpa-usage-keeper/web"
)

func handler(target *url.URL, assets fs.FS) http.Handler {
	return handlerWithUsageDB(target, assets, nil)
}

func handlerWithUsageDB(target *url.URL, assets fs.FS, metadata *sessionMetadataStore) http.Handler {
	return handlerWithStores(target, assets, metadata, nil)
}

func handlerWithStores(target *url.URL, assets fs.FS, metadata *sessionMetadataStore, cache *conversationCache) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ModifyResponse = metadata.enrichResponse
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		if r.URL.Path == "/api/v1/usage/events" {
			r.Header.Set("Accept-Encoding", "identity")
		}
	}
	files := http.FileServer(http.FS(assets))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id, ok := conversationEventID(r.URL.Path); ok {
			serveConversationCached(w, r, target, id, cache)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/health" {
			w.Header().Set("Cache-Control", "no-store")
			proxy.ServeHTTP(w, r)
			return
		}
		_, assetErr := fs.Stat(assets, strings.TrimPrefix(r.URL.Path, "/"))
		if r.URL.Path == "/" || r.URL.Path == "/index.html" || (assetErr != nil && !strings.HasPrefix(r.URL.Path, "/assets/") && !strings.Contains(r.URL.Path, ".")) {
			data, err := fs.ReadFile(assets, "index.html")
			if err != nil {
				http.Error(w, "UI unavailable", 500)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Write(bytes.ReplaceAll(data, []byte(`"__APP_BASE_PATH__"`), []byte(`""`)))
			return
		}
		files.ServeHTTP(w, r)
	})
}

func main() {
	listen := flag.String("listen", "127.0.0.1:8319", "HTTP listen address")
	backend := flag.String("keeper", "http://127.0.0.1:8318", "Existing Keeper URL")
	usageDB := flag.String("usage-db", "", "Existing Keeper SQLite path (read-only session metadata)")
	home, _ := os.UserHomeDir()
	cachePath := flag.String("conversation-db", filepath.Join(home, ".local", "share", "keeper-prompt-viewer", "conversations.db"), "Independent parsed conversation cache SQLite path")
	flag.Parse()
	cache, err := openConversationCache(*cachePath)
	if err != nil {
		log.Fatalf("Conversation cache unavailable: %v", err)
	}
	defer cache.db.Close()
	metadata, err := openSessionMetadata(*usageDB)
	if err != nil {
		log.Printf("Session metadata unavailable: %v", err)
	}
	if metadata != nil {
		defer metadata.db.Close()
	}
	target, err := url.Parse(*backend)
	if err != nil || target.Host == "" || (target.Scheme != "http" && target.Scheme != "https") {
		log.Fatal("invalid keeper URL")
	}
	server := &http.Server{Addr: *listen, Handler: handlerWithStores(target, web.Static, metadata, cache), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("Prompt viewer listening on %s; Keeper API %s", *listen, target.Host)
	log.Fatal(server.ListenAndServe())
}
