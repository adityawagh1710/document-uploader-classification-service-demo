// Command wundergraph-router is the document-uploader ingestion front door (POC):
// a Go GraphQL gateway (gqlgen) over the wire contract. P2 wires in-memory/stub
// adapters; P3 swaps in real AWS (DynamoDB / S3 / SQS) behind the same ports.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/gorilla/websocket"

	"github.com/opus2/docuploader/units/wundergraph-router/graph"
	"github.com/opus2/docuploader/units/wundergraph-router/internal/app"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: levelFromEnv()}))

	port := getenv("PORT", "8080")
	bucket := getenv("DOCUPLOADER_STAGING_BUCKET", "classification-ui-bucket")
	tenant := getenv("DEFAULT_TENANT_ID", "tenant-ui")

	store := app.NewMemStore()
	resolver := &graph.Resolver{
		Store:      store,
		Uploader:   app.StubUploader{Bucket: bucket},
		Dispatcher: app.LogDispatcher{Log: logger},
		Bus:        store,
		Log:        logger,
		Tenant:     tenant,
	}

	srv := handler.New(graph.NewExecutableSchema(graph.Config{Resolvers: resolver}))
	srv.AddTransport(transport.Options{})
	srv.AddTransport(transport.GET{})
	srv.AddTransport(transport.POST{})
	srv.AddTransport(transport.Websocket{ // graphql-transport-ws subscriptions
		KeepAlivePingInterval: 10 * time.Second,
		Upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true }, // POC; tighten for dev05
		},
	})

	mux := http.NewServeMux()
	mux.Handle("/graphql", srv)
	mux.Handle("/", playground.Handler("wundergraph-router", "/graphql"))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	logger.Info("wundergraph-router starting", "port", port, "stagingBucket", bucket, "tenant", tenant)
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           requestLog(logger, mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server failed", "err", err)
		os.Exit(1)
	}
}

func requestLog(l *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		l.Debug("http", "method", r.Method, "path", r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func levelFromEnv() slog.Level {
	switch strings.ToLower(os.Getenv("LOG_LEVEL")) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
