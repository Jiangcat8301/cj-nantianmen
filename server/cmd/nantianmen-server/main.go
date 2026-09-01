package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"nantianmen/internal/api"
	"nantianmen/internal/commlog"
	"nantianmen/internal/conf"
	"nantianmen/internal/db"
	"nantianmen/internal/modelmap"
	"nantianmen/internal/stats"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

func main() {
	versionFlag := flag.Bool("version", false, "print version and exit")
	confPath := flag.String("c", "", "config path")
	dbPath := flag.String("D", "", "database path")
	port := flag.Int("port", 0, "override port")
	host := flag.String("host", "", "override host")
	logLevel := flag.String("log-level", "info", "log level: debug | info | warn | error")
	flag.Parse()

	if *versionFlag {
		fmt.Printf("nantianmen-server %s\n", api.ServerVersion)
		os.Exit(0)
	}

	// ponytail: log level wired through stdlib log. Full slog migration belongs
	// in a future revision when request-level debug logs are actually needed.
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	if level := os.Getenv("NT_LOG_LEVEL"); level != "" {
		*logLevel = level
	}
	levelName := strings.ToUpper(*logLevel)
	log.Printf("starting nantianmen-server %s [log-level=%s]", api.ServerVersion, levelName)

	conf.SetPaths(*confPath, *dbPath)
	c := conf.LoadConf()

	// ponytail: -D flag must override conf.Database.Path; otherwise callers
	// that point at a non-default DB (tests, secondary instance) silently
	// fall back to the conf value. Bug filed 2026-08-02.
	if *dbPath != "" {
		c.Database.Path = *dbPath
	}

	// Override port/host from flags
	if *port > 0 { c.ServerPort = *port }
	if *host != "" { c.ServerHost = *host }

	listenHost := "127.0.0.1"
	listenPort := 38271
	if c.Initialized {
		listenHost = c.ServerHost
		listenPort = c.ServerPort
	}

	// Init DB if initialized
	if c.Initialized {
		dbP := c.Database.Path
		if !filepath.IsAbs(dbP) { dbP = filepath.Join(conf.GetConfDir(), dbP) }
		if err := db.Init(dbP); err != nil {
			log.Fatalf("db init: %v", err)
		}
		modelmap.RebuildModelMap()
		stats.StartFlushTask()
		commlog.InitBuffer()
	}

	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(api.AdminAuth)
	r.Group(func(r chi.Router) {
		api.RegisterAdminRoutes(r)
		api.RegisterProviderRoutes(r)
		api.RegisterApikeyRoutes(r)
		api.RegisterLLMRoutes(r)
	})

	// 404
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(404)
		w.Write([]byte(`{"error":"not found"}`))
	})

	addr := fmt.Sprintf("%s:%d", listenHost, listenPort)
	srv := &http.Server{Addr: addr, Handler: r}

	go func() {
		log.Printf("Nantianmen v%s on http://%s (init=%v)", api.ServerVersion, addr, c.Initialized)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed { log.Fatal(err) }
	}()

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	log.Println("shutting down...")
	stats.Flush()
	commlog.FlushBuffer()
	db.Close()
	os.Exit(0)
}
