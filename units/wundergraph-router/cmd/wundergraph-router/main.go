// Command wundergraph-router is the document-uploader ingestion front door (POC):
// a Go GraphQL gateway (gqlgen) over the wire contract.
//
// BACKEND selects the adapters behind the resolver ports:
//   - "memory" (default): in-memory store + stub presign + logging dispatcher.
//   - "aws": DynamoDB store + S3 presign + SQS dispatch. Endpoint-configurable
//     via AWS_ENDPOINT_URL, so the same binary runs on LocalStack (local) and
//     real AWS (dev05, via IRSA).
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/gorilla/websocket"

	contracts "github.com/opus2/docuploader/libs/pipeline-contracts/go"
	"github.com/opus2/docuploader/units/wundergraph-router/graph"
	"github.com/opus2/docuploader/units/wundergraph-router/internal/app"
	"github.com/opus2/docuploader/units/wundergraph-router/internal/awsadapters"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: levelFromEnv()}))

	port := getenv("PORT", "8080")
	bucket := getenv("DOCUPLOADER_STAGING_BUCKET", "classification-ui-bucket")
	tenant := getenv("DEFAULT_TENANT_ID", "tenant-ui")
	backend := strings.ToLower(getenv("BACKEND", "memory"))

	var (
		store      app.Store
		uploader   app.Uploader
		dispatcher app.Dispatcher
	)
	bus := app.NewMemBus()

	switch backend {
	case "aws":
		opts := awsadapters.Options{
			Region:   getenv("AWS_REGION", "eu-west-1"),
			Endpoint: os.Getenv("AWS_ENDPOINT_URL"), // empty on dev05; set on LocalStack
		}
		cfg, err := awsadapters.LoadConfig(context.Background(), opts)
		if err != nil {
			logger.Error("aws config", "err", err)
			os.Exit(1)
		}
		store = awsadapters.NewDynamoStore(cfg, opts,
			getenv("WORKSPACES_TABLE_NAME", "workspaces-ui"),
			getenv("DOCUMENTS_TABLE_NAME", "documents-ui"))
		uploader = awsadapters.NewS3Uploader(cfg, opts, bucket)
		dispatcher = awsadapters.NewSQSDispatcher(cfg, opts, stageQueues())
		logger.Info("backend=aws", "endpoint", opts.Endpoint, "region", opts.Region, "localstack", opts.LocalStackMode())
	default:
		store = app.NewMemStore()
		uploader = app.StubUploader{Bucket: bucket}
		dispatcher = app.LogDispatcher{Log: logger}
		logger.Info("backend=memory (stub presign + logging dispatcher)")
	}

	resolver := &graph.Resolver{
		Store: store, Uploader: uploader, Dispatcher: dispatcher,
		Bus: bus, Log: logger, Tenant: tenant,
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

	logger.Info("wundergraph-router starting", "port", port, "stagingBucket", bucket, "tenant", tenant, "backend", backend)
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

// stageQueues builds the stage→queueURL map from env (the demo's stages.yaml).
func stageQueues() map[contracts.StageName]string {
	m := map[contracts.StageName]string{}
	add := func(stage contracts.StageName, env string) {
		if v := os.Getenv(env); v != "" {
			m[stage] = v
		}
	}
	add(contracts.StageClassify, "QUEUE_CLASSIFY")
	add(contracts.StageZipExtraction, "QUEUE_ZIP_EXTRACTION")
	add(contracts.StageOfficeConvert, "QUEUE_OFFICE_CONVERT")
	add(contracts.StageEmailExtraction, "QUEUE_EMAIL_EXTRACTION")
	add(contracts.StageOCR, "QUEUE_OCR")
	add(contracts.StageOutputAssembly, "QUEUE_OUTPUT_ASSEMBLY")
	return m
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
