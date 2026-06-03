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
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/graph"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/app"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/awsadapters"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/classifierhttp"
	"github.com/opus2/docuploader/units/ingestion-service/ingestion-subgraph/internal/officeconvert"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: levelFromEnv()}))

	port := getenv("PORT", "8080")
	bucket := getenv("DOCUPLOADER_STAGING_BUCKET", "classification-ui-bucket")
	tenant := getenv("DEFAULT_TENANT_ID", "tenant-ui")
	backend := strings.ToLower(getenv("BACKEND", "memory"))

	var (
		store           app.Store
		uploader        app.Uploader
		dispatcher      app.Dispatcher
		configStore     app.WorkspaceConfigStore
		runStore        app.RunStore
		objectStore     app.ObjectStore
		emailStore      app.EmailExtractionStore
		convertProgress app.ConvertProgressClient
		health          app.HealthChecker
		target          app.BackendTarget
	)
	bus := app.NewMemBus()

	contentHashTable := getenv("CONTENT_HASH_TABLE_NAME", "content-hashes-ui")
	classificationsTable := getenv("CLASSIFICATIONS_TABLE_NAME", "classifications-ui")
	emailExtractionsTable := getenv("EMAIL_EXTRACTIONS_TABLE_NAME", "email-extractions-ui")
	workspaceConfigTable := getenv("WORKSPACE_CONFIG_TABLE_NAME", "workspace-config-ui")

	switch backend {
	case "aws":
		opts := awsadapters.Options{
			Region:         getenv("AWS_REGION", "eu-west-1"),
			Endpoint:       os.Getenv("AWS_ENDPOINT_URL"), // empty on dev05; set on LocalStack
			PublicEndpoint: os.Getenv("S3_PUBLIC_ENDPOINT"),
		}
		cfg, err := awsadapters.LoadConfig(context.Background(), opts)
		if err != nil {
			logger.Error("aws config", "err", err)
			os.Exit(1)
		}
		store = awsadapters.NewDynamoStore(cfg, opts,
			getenv("WORKSPACES_TABLE_NAME", "workspaces-ui"),
			getenv("DOCUMENTS_TABLE_NAME", "documents-ui"))
		s3up := awsadapters.NewS3Uploader(cfg, opts, bucket)
		uploader = s3up
		objectStore = s3up
		dispatcher = awsadapters.NewSQSDispatcher(cfg, opts, stageQueues())
		configStore = awsadapters.NewDynamoConfigStore(cfg, opts, workspaceConfigTable)
		runStore = awsadapters.NewDynamoRunStore(cfg, opts, classificationsTable, contentHashTable)
		emailStore = awsadapters.NewDynamoEmailExtractionStore(cfg, opts, emailExtractionsTable)
		health = awsadapters.NewDynamoHealthChecker(cfg, opts)
		// Backend-target labels match the UI's old /api/target view.
		if opts.LocalStackMode() {
			target = app.BackendTarget{Endpoint: opts.Endpoint, Backend: "localstack"}
		} else {
			target = app.BackendTarget{Endpoint: "aws:" + opts.Region, Backend: "real-aws"}
		}
		target.Region = opts.Region
		target.Bucket = bucket
		target.ContentHashTable = contentHashTable
		target.WorkspaceConfigTable = workspaceConfigTable
		logger.Info("backend=aws", "endpoint", opts.Endpoint, "region", opts.Region, "localstack", opts.LocalStackMode())
	default:
		store = app.NewMemStore()
		uploader = app.StubUploader{Bucket: bucket}
		objectStore = app.StubObjectStore{Bucket: bucket}
		dispatcher = app.LogDispatcher{Log: logger}
		configStore = app.NewMemConfigStore()
		runStore = app.NewMemRunStore()
		emailStore = app.NewMemEmailExtractionStore()
		health = app.StubHealthChecker{}
		target = app.BackendTarget{
			Endpoint: "memory", Region: getenv("AWS_REGION", "eu-west-1"), Bucket: bucket,
			ContentHashTable: contentHashTable, WorkspaceConfigTable: workspaceConfigTable, Backend: "memory",
		}
		logger.Info("backend=memory (stub presign + logging dispatcher)")
	}

	// Office-convert progress client: real HTTP when OFFICE_CONVERT_API_URL is
	// set; otherwise a stub that reports no live progress (local/no-convert).
	if u := os.Getenv("OFFICE_CONVERT_API_URL"); u != "" {
		convertProgress = officeconvert.New(u)
		logger.Info("convertProgress=http", "url", u)
	} else {
		convertProgress = app.StubConvertProgressClient{}
		logger.Info("convertProgress=stub (set OFFICE_CONVERT_API_URL to poll office-convert)")
	}

	// Classifier: HTTP to the classification service's /classify when CLASSIFY_URL
	// is set; otherwise a canned stub (so the router runs without it locally).
	var classifier app.Classifier = app.StubClassifier{}
	if u := os.Getenv("CLASSIFY_URL"); u != "" {
		classifier = classifierhttp.New(u)
		logger.Info("classifier=http", "url", u)
	} else {
		logger.Info("classifier=stub (set CLASSIFY_URL to call the classification service)")
	}

	resolver := &graph.Resolver{
		Store: store, Uploader: uploader, Dispatcher: dispatcher,
		Bus: bus, Classifier: classifier, WorkspaceConfigStore: configStore,
		RunStore: runStore, ObjectStore: objectStore, EmailStore: emailStore,
		ConvertProgress: convertProgress, Health: health, Target: target,
		Log: logger, Tenant: tenant,
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
		Handler:           cors(getenv("CORS_ORIGIN", "*"), requestLog(logger, mux)),
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

// cors lets the browser-side UI call /graphql directly (Approach A). Origin is
// "*" for the POC; tighten to the UI origin on dev05 via CORS_ORIGIN.
func cors(origin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, traceparent")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
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
