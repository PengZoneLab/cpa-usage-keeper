// prompt-viewer serves the forked UI and reuses the existing Keeper API.
// It never opens the usage database or consumes CPA queues.
package main

import (
	"bytes"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"cpa-usage-keeper/web"
)

func handler(target *url.URL, assets fs.FS) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(target)
	files := http.FileServer(http.FS(assets))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	flag.Parse()
	target, err := url.Parse(*backend)
	if err != nil || target.Host == "" || (target.Scheme != "http" && target.Scheme != "https") {
		log.Fatal("invalid keeper URL")
	}
	server := &http.Server{Addr: *listen, Handler: handler(target, web.Static), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("Prompt viewer listening on %s; Keeper API %s", *listen, target.Host)
	log.Fatal(server.ListenAndServe())
}
