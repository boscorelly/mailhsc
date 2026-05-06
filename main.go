package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"mailhsc/internal/parser"
)

//go:embed static
var staticFiles embed.FS

func main() {
	// Self-healthcheck mode for Docker HEALTHCHECK instruction.
	// The binary is called with --health-check; it hits its own HTTP server
	// and exits 0 (healthy) or 1 (unhealthy). No shell needed in the image.
	if len(os.Args) == 2 && os.Args[1] == "--health-check" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get("http://localhost:" + port + "/api/health")
		if err != nil || resp.StatusCode != http.StatusOK {
			fmt.Fprintln(os.Stderr, "health check failed")
			os.Exit(1)
		}
		os.Exit(0)
	}

	mux := http.NewServeMux()

	// Static files served from embedded FS — no filesystem dependency at runtime.
	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatal("failed to create static sub-fs:", err)
	}
	mux.Handle("/", noListingFileServer(http.FS(sub)))

	// API endpoints
	mux.HandleFunc("/api/analyze", withSecurity(handleAnalyze))
	mux.HandleFunc("/api/health", handleHealth)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
		// ReadHeaderTimeout: short — protects against Slowloris on headers
		ReadHeaderTimeout: 5 * time.Second,
		// ReadTimeout: generous enough for a 5 MB upload on a slow link
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("mailhsc listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// withSecurity enforces method, CSRF header, Content-Type, and body size.
func withSecurity(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Only POST allowed
		if r.Method != http.MethodPost {
			jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// CSRF mitigation: require custom header that simple cross-origin forms
		// cannot set (browser CORS preflight would block them).
		if r.Header.Get("X-Requested-With") != "XMLHttpRequest" {
			jsonError(w, "forbidden", http.StatusForbidden)
			return
		}

		// Enforce acceptable Content-Type
		ct := r.Header.Get("Content-Type")
		if !strings.Contains(ct, "application/json") && !strings.Contains(ct, "multipart/form-data") {
			jsonError(w, "unsupported content-type", http.StatusUnsupportedMediaType)
			return
		}

		// Limit body size (defence-in-depth — Traefik also limits to 6 MB)
		r.Body = http.MaxBytesReader(w, r.Body, 5<<20)

		next(w, r)
	}
}

func handleAnalyze(w http.ResponseWriter, r *http.Request) {
	var raw string

	ct := r.Header.Get("Content-Type")
	if strings.Contains(ct, "multipart/form-data") {
		if err := r.ParseMultipartForm(5 << 20); err != nil {
			jsonError(w, "file too large (max 5 MB)", http.StatusBadRequest)
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			jsonError(w, "missing file field", http.StatusBadRequest)
			return
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, 5<<20))
		if err != nil {
			jsonError(w, "error reading file", http.StatusInternalServerError)
			return
		}
		raw = string(data)
	} else {
		// application/json
		var body struct {
			Headers string `json:"headers"`
		}
		dec := json.NewDecoder(io.LimitReader(r.Body, 5<<20))
		if err := dec.Decode(&body); err != nil {
			jsonError(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		raw = body.Headers
	}

	raw = strings.TrimSpace(raw)
	if raw == "" {
		jsonError(w, "empty input", http.StatusBadRequest)
		return
	}

	result, err := parser.Parse(raw)
	if err != nil {
		log.Printf("parse error: %v", err) // log internally, never expose to client
		jsonError(w, "could not parse headers", http.StatusUnprocessableEntity)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	json.NewEncoder(w).Encode(result)
	// result goes out of scope immediately — GC reclaims it, nothing persisted
}

// handleHealth is restricted to the internal network via docker-compose.
// It does NOT go through withSecurity so the Traefik health probe still works.
func handleHealth(w http.ResponseWriter, r *http.Request) {
	// Only allow GET from the reverse proxy (Traefik sends GET /api/health)
	if r.Method != http.MethodGet {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// noListingFileServer wraps http.FileServer and returns 403 for directory
// requests, preventing enumeration of /fonts/, /js/, /css/ etc.
func noListingFileServer(root http.FileSystem) http.Handler {
	fs := http.FileServer(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Block requests that end with / (directory) unless it is exactly "/"
		if r.URL.Path != "/" && strings.HasSuffix(r.URL.Path, "/") {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		// Block directory listing for all paths except root "/"
		if r.URL.Path != "/" {
			f, err := root.Open(r.URL.Path)
			if err == nil {
				defer f.Close()
				if stat, err := f.Stat(); err == nil && stat.IsDir() {
					http.Error(w, "forbidden", http.StatusForbidden)
					return
				}
			}
		}
		fs.ServeHTTP(w, r)
	})
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
