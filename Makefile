# Classification Service — Testing Makefile
#
# Orchestrates local build + test for U-1/U-2/U-3 (src/) and U-4 (infra/).
# Each target validates its prerequisites; if a required tool or input file
# is missing the target prompts the user interactively (Y/n) before
# attempting a remediation step.
#
# Default target: `make help`
#
# Usage examples:
#   make                # alias for `make help`
#   make check          # validate prerequisites only
#   make quick          # typecheck + lint + unit + pbt (fast feedback)
#   make ci             # everything CI does, in CI order
#   make integration    # LocalStack-backed integration tests
#   make smoke          # SAM Local smoke tests
#   make all            # full build + every test category

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SHELL          := /bin/bash
.SHELLFLAGS    := -eu -o pipefail -c
.ONESHELL:
.DEFAULT_GOAL  := help

# Required tool versions
REQ_NODE_MAJOR := 20
REQ_SAM_MIN    := 1.120
REQ_DOCKER_MIN := 24

# CDK environment context (override with: make synth ENV=staging)
ENV ?= dev

# ANSI colours (no-op when not a TTY)
ifneq (,$(findstring xterm,$(TERM)))
  COL_OFF  := \033[0m
  COL_BOLD := \033[1m
  COL_RED  := \033[31m
  COL_GRN  := \033[32m
  COL_YEL  := \033[33m
  COL_BLU  := \033[34m
  COL_CYN  := \033[36m
endif

# Small banner helpers (printed via printf to honour escape codes everywhere)
define banner
	@printf "\n$(COL_BOLD)$(COL_CYN)▶ %s$(COL_OFF)\n" "$(1)"
endef

define ok
	@printf "$(COL_GRN)✓ %s$(COL_OFF)\n" "$(1)"
endef

define warn
	@printf "$(COL_YEL)! %s$(COL_OFF)\n" "$(1)"
endef

define err
	@printf "$(COL_RED)✗ %s$(COL_OFF)\n" "$(1)" >&2
endef

# `ask` — interactive Y/n prompt. $(1) = question, $(2) = command to run on Y.
# Defaults to Y if user hits Enter. Aborts on n / N.
define ask
	@read -r -p "$$(printf '$(COL_YEL)? %s [Y/n] $(COL_OFF)' "$(1)")" reply; \
	reply="$${reply:-Y}"; \
	if [[ "$$reply" =~ ^[Yy]$$ ]]; then \
		printf "$(COL_BLU)→ %s$(COL_OFF)\n" "$(2)"; \
		$(2); \
	else \
		printf "$(COL_RED)✗ Aborted by user — $(1)$(COL_OFF)\n" >&2; \
		exit 1; \
	fi
endef

# ---------------------------------------------------------------------------
# Help / Discovery
# ---------------------------------------------------------------------------

.PHONY: help
help: ## Show this help (default)
	@printf "$(COL_BOLD)Classification Service — Make targets$(COL_OFF)\n\n"
	@printf "  $(COL_CYN)Setup$(COL_OFF)\n"
	@awk 'BEGIN{FS=":.*##"} /^[a-z-]+:.*## \[setup\]/ {printf "    $(COL_GRN)%-18s$(COL_OFF) %s\n", $$1, gensub(/^ ?\[setup\] ?/, "", "g", $$2)}' $(MAKEFILE_LIST)
	@printf "\n  $(COL_CYN)Build & static checks$(COL_OFF)\n"
	@awk 'BEGIN{FS=":.*##"} /^[a-z-]+:.*## \[build\]/ {printf "    $(COL_GRN)%-18s$(COL_OFF) %s\n", $$1, gensub(/^ ?\[build\] ?/, "", "g", $$2)}' $(MAKEFILE_LIST)
	@printf "\n  $(COL_CYN)Test$(COL_OFF)\n"
	@awk 'BEGIN{FS=":.*##"} /^[a-z-]+:.*## \[test\]/ {printf "    $(COL_GRN)%-18s$(COL_OFF) %s\n", $$1, gensub(/^ ?\[test\] ?/, "", "g", $$2)}' $(MAKEFILE_LIST)
	@printf "\n  $(COL_CYN)QA & security$(COL_OFF)\n"
	@awk 'BEGIN{FS=":.*##"} /^[a-z-]+:.*## \[qa\]/ {printf "    $(COL_GRN)%-18s$(COL_OFF) %s\n", $$1, gensub(/^ ?\[qa\] ?/, "", "g", $$2)}' $(MAKEFILE_LIST)
	@printf "\n  $(COL_CYN)Composite$(COL_OFF)\n"
	@awk 'BEGIN{FS=":.*##"} /^[a-z-]+:.*## \[combo\]/ {printf "    $(COL_GRN)%-18s$(COL_OFF) %s\n", $$1, gensub(/^ ?\[combo\] ?/, "", "g", $$2)}' $(MAKEFILE_LIST)
	@printf "\n  $(COL_CYN)Deploy (DEV05 EKS)$(COL_OFF)\n"
	@awk 'BEGIN{FS=":.*##"} /^[a-z-]+:.*## \[deploy\]/ {printf "    $(COL_GRN)%-18s$(COL_OFF) %s\n", $$1, gensub(/^ ?\[deploy\] ?/, "", "g", $$2)}' $(MAKEFILE_LIST)
	@printf "\n  $(COL_CYN)Housekeeping$(COL_OFF)\n"
	@awk 'BEGIN{FS=":.*##"} /^[a-z-]+:.*## \[misc\]/ {printf "    $(COL_GRN)%-18s$(COL_OFF) %s\n", $$1, gensub(/^ ?\[misc\] ?/, "", "g", $$2)}' $(MAKEFILE_LIST)
	@printf "\n  $(COL_CYN)Variables$(COL_OFF)\n"
	@printf "    $(COL_GRN)ENV$(COL_OFF)                       CDK env context (default: dev). Override: $(COL_BOLD)make synth ENV=staging$(COL_OFF)\n"
	@printf "    $(COL_GRN)DEPLOY_IMAGE_TAG$(COL_OFF)          Image tag pushed to ECR (default: short git SHA)\n"
	@printf "    $(COL_GRN)DEPLOY_NAMESPACE$(COL_OFF)          Target K8s namespace (default: classification-service-sandbox)\n"
	@printf "    $(COL_GRN)DEPLOY_INGRESS_HOST$(COL_OFF)       FQDN for the ALB Ingress. Unset = no Ingress + no Route 53 sync (use $(COL_BOLD)make pf-start$(COL_OFF))\n"
	@printf "    $(COL_GRN)DEPLOY_ROUTE53_ZONE_ID$(COL_OFF)    Hosted zone holding DEPLOY_INGRESS_HOST. Required when host is set\n"
	@printf "    $(COL_GRN)DEPLOY_AWS_PROFILE$(COL_OFF)        AWS profile for ECR + Route 53 (default: opus2-dev)\n"
	@printf "    $(COL_GRN)DEPLOY_BACKEND$(COL_OFF)            localstack (default) or aws (real DynamoDB+S3 via IRSA — see deploy/AWS_TOPOLOGY.md)\n"
	@printf "    $(COL_GRN)DEPLOY_IRSA_ROLE_ARN$(COL_OFF)      IRSA role ARN for the SA. Required when $(COL_BOLD)DEPLOY_BACKEND=aws$(COL_OFF)\n"
	@printf "    $(COL_GRN)DEPLOY_NUKE_DATA$(COL_OFF)          $(COL_RED)DANGER$(COL_OFF) =true lets $(COL_BOLD)undeploy-all$(COL_OFF) destroy DDB tables + S3 bucket + IRSA role\n"
	@printf "\n"

# ---------------------------------------------------------------------------
# Prerequisite checks (each prompts to remediate)
# ---------------------------------------------------------------------------

.PHONY: check
check: check-node check-npm check-deps ## [setup] Verify base prerequisites (Node, npm, deps)
	$(call ok,All base prerequisites satisfied)

.PHONY: check-node
check-node:
	$(call banner,Checking Node.js $(REQ_NODE_MAJOR)+)
	@if ! command -v node >/dev/null 2>&1; then \
		printf "$(COL_RED)✗ Node.js not found on PATH.$(COL_OFF)\n"; \
		printf "  Install Node.js $(REQ_NODE_MAJOR) LTS from https://nodejs.org/ or via your version manager (nvm/asdf/fnm).\n"; \
		exit 1; \
	fi; \
	major=$$(node -v | sed -E 's/^v([0-9]+).*/\1/'); \
	if [ "$$major" -lt "$(REQ_NODE_MAJOR)" ]; then \
		printf "$(COL_RED)✗ Node.js v%s detected; need v$(REQ_NODE_MAJOR)+.$(COL_OFF)\n" "$$major"; \
		exit 1; \
	fi; \
	printf "$(COL_GRN)✓ node $$(node -v)$(COL_OFF)\n"

.PHONY: check-npm
check-npm:
	@if ! command -v npm >/dev/null 2>&1; then \
		printf "$(COL_RED)✗ npm not found (should ship with Node).$(COL_OFF)\n"; \
		exit 1; \
	fi; \
	printf "$(COL_GRN)✓ npm $$(npm -v)$(COL_OFF)\n"

# Install deps if node_modules absent. Uses `npm ci` when a lockfile exists,
# falls back to `npm install` (which creates one) when it doesn't.
.PHONY: check-deps
check-deps:
	@if [ -d node_modules ]; then \
		printf "$(COL_GRN)✓ node_modules present$(COL_OFF)\n"; \
	else \
		printf "$(COL_YEL)! node_modules missing.$(COL_OFF)\n"; \
		if [ -f package-lock.json ]; then \
			cmd="npm ci"; \
		else \
			cmd="npm install"; \
		fi; \
		read -r -p "$$(printf '$(COL_YEL)? Run %s now? [Y/n] $(COL_OFF)' "$$cmd")" reply; \
		reply="$${reply:-Y}"; \
		if [[ "$$reply" =~ ^[Yy]$$ ]]; then \
			$$cmd; \
		else \
			printf "$(COL_RED)✗ Cannot proceed without dependencies.$(COL_OFF)\n" >&2; \
			exit 1; \
		fi; \
	fi

.PHONY: check-docker
check-docker: ## [setup] Verify Docker is installed and the daemon is running
	$(call banner,Checking Docker)
	@if ! command -v docker >/dev/null 2>&1; then \
		printf "$(COL_RED)✗ Docker not installed.$(COL_OFF)\n"; \
		printf "  Required for: integration tests (LocalStack via testcontainers) and smoke tests (SAM Local).\n"; \
		printf "  Install from: https://docs.docker.com/engine/install/\n"; \
		read -r -p "$$(printf '$(COL_YEL)? Skip this check and continue anyway? [y/N] $(COL_OFF)')" reply; \
		reply="$${reply:-N}"; \
		[[ "$$reply" =~ ^[Yy]$$ ]] || exit 1; \
	elif ! docker info >/dev/null 2>&1; then \
		printf "$(COL_RED)✗ Docker daemon not running.$(COL_OFF)\n"; \
		printf "  Start it with one of:\n"; \
		printf "    Linux:  sudo systemctl start docker\n"; \
		printf "    macOS:  open Docker Desktop\n"; \
		read -r -p "$$(printf '$(COL_YEL)? Have you started Docker? Retry check? [Y/n] $(COL_OFF)')" reply; \
		reply="$${reply:-Y}"; \
		if [[ "$$reply" =~ ^[Yy]$$ ]]; then \
			docker info >/dev/null 2>&1 || { printf "$(COL_RED)✗ Still not running.$(COL_OFF)\n" >&2; exit 1; }; \
		else \
			exit 1; \
		fi; \
	fi; \
	printf "$(COL_GRN)✓ docker $$(docker --version | sed 's/Docker version //; s/,.*//')$(COL_OFF)\n"

.PHONY: check-sam
check-sam: ## [setup] Verify SAM CLI installed (smoke tests)
	$(call banner,Checking AWS SAM CLI)
	@if ! command -v sam >/dev/null 2>&1; then \
		printf "$(COL_RED)✗ AWS SAM CLI not installed.$(COL_OFF)\n"; \
		printf "  Required for: smoke tests (sam local invoke).\n"; \
		printf "  Install from: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html\n"; \
		read -r -p "$$(printf '$(COL_YEL)? Skip smoke tests and continue? [y/N] $(COL_OFF)')" reply; \
		reply="$${reply:-N}"; \
		[[ "$$reply" =~ ^[Yy]$$ ]] || exit 1; \
		exit 0; \
	fi; \
	printf "$(COL_GRN)✓ sam $$(sam --version | sed 's/.*version //')$(COL_OFF)\n"

.PHONY: check-aws
check-aws: ## [setup] Verify AWS CLI installed (optional)
	@if ! command -v aws >/dev/null 2>&1; then \
		printf "$(COL_YEL)! AWS CLI not installed (optional — only needed for deploy + post-run metrics).$(COL_OFF)\n"; \
	else \
		printf "$(COL_GRN)✓ aws $$(aws --version 2>&1 | awk '{print $$1}')$(COL_OFF)\n"; \
	fi

# Verify a fixture / config file exists; offer to skip the target if not.
# $(1) = file path, $(2) = target name for the message.
define require_file
	@if [ ! -f "$(1)" ]; then \
		printf "$(COL_RED)✗ Required file missing: $(1)$(COL_OFF)\n"; \
		printf "  This is needed by: $(2)\n"; \
		read -r -p "$$(printf '$(COL_YEL)? Abort and create it manually? [Y/n] $(COL_OFF)')" reply; \
		reply="$${reply:-Y}"; \
		[[ "$$reply" =~ ^[Yy]$$ ]] && exit 1; \
		printf "$(COL_YEL)! Proceeding without it — expect failures.$(COL_OFF)\n"; \
	fi
endef

# ---------------------------------------------------------------------------
# Build / static checks
# ---------------------------------------------------------------------------

.PHONY: install
install: check-node check-npm ## [setup] Install dependencies (npm ci if lockfile, else npm install)
	$(call banner,Installing dependencies)
	@if [ -f package-lock.json ]; then npm ci; else npm install; fi
	$(call ok,Dependencies installed)

.PHONY: typecheck
typecheck: check-deps ## [build] Typecheck both src/ and infra/
	$(call banner,Typechecking src/)
	@npm run typecheck
	$(call banner,Typechecking infra/)
	$(call require_file,infra/tsconfig.json,typecheck)
	@npx tsc -p infra/tsconfig.json --noEmit
	$(call ok,Typecheck passed)

.PHONY: lint
lint: check-deps ## [build] Run ESLint (hexagonal boundary rules)
	$(call banner,Linting)
	@npm run lint
	$(call ok,Lint passed)

.PHONY: build
build: check-deps ## [build] Emit compiled JS to dist/
	$(call banner,Building (tsc emit))
	@npm run build
	$(call ok,Build emitted to dist/)

.PHONY: synth
synth: check-deps ## [build] cdk synth (runs cdk-nag aspect); override ENV=staging|prod
	$(call banner,CDK synth (env=$(ENV)))
	$(call require_file,cdk.json,cdk synth)
	$(call require_file,infra/bin/app.ts,cdk synth)
	@npx cdk synth -c env=$(ENV)
	$(call ok,Synth complete — templates in cdk.out/)

.PHONY: verify-bundle
verify-bundle: synth ## [build] Validate Lambda bundle size + handler export
	$(call banner,Verifying Lambda bundle)
	$(call require_file,scripts/verify-bundle.sh,verify-bundle)
	@bash scripts/verify-bundle.sh cdk.out
	$(call ok,Bundle verified)

# ---------------------------------------------------------------------------
# Test categories
# ---------------------------------------------------------------------------

.PHONY: test-unit
test-unit: check-deps ## [test] Unit tests (Vitest)
	$(call banner,Unit tests)
	@npm run test:unit
	$(call ok,Unit tests passed)

.PHONY: test-pbt
test-pbt: check-deps ## [test] Property-based tests (fast-check) + regression suite
	$(call banner,PBT + regression)
	@npm run test:pbt
	$(call ok,PBT passed)

.PHONY: test-infra
test-infra: check-deps ## [test] CDK stack tests (snapshots + assertions)
	$(call banner,Infrastructure tests)
	$(call require_file,infra/lib/_test-helpers.ts,test-infra)
	@npm run test:infra
	$(call ok,Infrastructure tests passed)

.PHONY: test-integration
test-integration: check-deps check-docker ## [test] Integration tests (LocalStack via testcontainers)
	$(call banner,Integration tests (LocalStack))
	@npm run test:integration
	$(call ok,Integration tests passed)

.PHONY: test-smoke
test-smoke: check-deps check-docker check-sam build ## [test] Smoke tests (SAM Local)
	$(call banner,Smoke tests (SAM Local))
	$(call require_file,template.yaml,test-smoke)
	@npm run test:smoke
	$(call ok,Smoke tests passed)

.PHONY: test-coverage
test-coverage: check-deps ## [test] Unit + PBT coverage report (coverage/lcov-report/index.html)
	$(call banner,Coverage)
	@npm run test:coverage
	$(call ok,Coverage report written to coverage/)

.PHONY: bench
bench: check-deps ## [test] Run vitest-bench micro-benchmarks
	$(call banner,Benchmarks)
	@npm run bench
	$(call ok,Benchmarks complete)

# ---------------------------------------------------------------------------
# QA & security
# ---------------------------------------------------------------------------
# `lint` and `typecheck` live in [build] above but compose into the QA combo
# below. This section adds the security / audit / supply-chain layer plus a
# UI-subtree QA target that covers the Next.js + Cypress test surface.

# npm-audit severity gate. Default lets moderate findings pass but fails on
# high/critical. Override: `make audit AUDIT_LEVEL=moderate` for stricter CI.
AUDIT_LEVEL ?= high

.PHONY: audit
audit: check-deps ## [qa] npm audit (fails on high/critical; override with AUDIT_LEVEL=moderate)
	$(call banner,Dependency audit ($(AUDIT_LEVEL)+))
	@npm audit --audit-level=$(AUDIT_LEVEL) || { \
		printf "$(COL_RED)✗ Vulnerabilities at or above $(AUDIT_LEVEL) severity.$(COL_OFF)\n" >&2; \
		printf "  Inspect: $(COL_BOLD)npm audit$(COL_OFF)\n"; \
		printf "  Attempt non-breaking fix: $(COL_BOLD)npm audit fix$(COL_OFF)\n"; \
		exit 1; \
	}
	$(call ok,Audit clean at $(AUDIT_LEVEL)+)

.PHONY: audit-strict
audit-strict: check-deps ## [qa] Strict audit gate (fails on any moderate+ finding)
	$(call banner,Dependency audit (moderate+))
	@$(MAKE) --no-print-directory audit AUDIT_LEVEL=moderate

.PHONY: audit-report
audit-report: check-deps ## [qa] Full audit report (does not fail; for inspection)
	$(call banner,Dependency audit (full report))
	@npm audit || true

.PHONY: outdated
outdated: check-deps ## [qa] Show outdated dependencies (npm outdated; non-failing)
	$(call banner,Outdated dependencies)
	@npm outdated || true

.PHONY: security
security: audit synth ## [qa] Security gate — npm audit + cdk-nag findings from synth
	$(call ok,Security gate green (npm audit + cdk-nag))

.PHONY: qa-ui
qa-ui: check-deps check-docker ## [qa] UI subtree QA — Next lint + tsc + Cypress E2E (needs Docker)
	$(call banner,UI typecheck)
	@cd ui && npx tsc --noEmit
	$(call banner,UI lint (Next.js eslint))
	@cd ui && npx next lint || { printf "$(COL_YEL)! ui lint had findings — review above$(COL_OFF)\n"; }
	$(call banner,UI Cypress E2E (live stack required on :3000))
	@if ! curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then \
		printf "$(COL_YEL)! UI not running on :3000 — bringing up docker compose...$(COL_OFF)\n"; \
		docker compose -f ui/docker-compose.yml up -d --build; \
		until curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; do sleep 1; done; \
	fi
	@cd ui && npx cypress run
	$(call ok,UI QA suite passed)

.PHONY: qa-quick
qa-quick: lint typecheck audit ## [qa] Fast QA loop — lint + typecheck + audit (no tests, no synth)
	$(call ok,QA-quick green)

.PHONY: qa
qa: lint typecheck audit test-unit test-pbt test-infra synth ## [qa] Full QA gate — lint + typecheck + audit + unit + pbt + infra + synth (cdk-nag)
	$(call ok,QA gate green)

# ---------------------------------------------------------------------------
# Composite targets
# ---------------------------------------------------------------------------

.PHONY: quick
quick: typecheck lint test-unit test-pbt ## [combo] Fast feedback loop (no Docker, no CDK synth)
	$(call ok,Quick loop green)

.PHONY: ci
ci: typecheck lint test-unit test-pbt synth test-infra verify-bundle ## [combo] What CI runs (no Docker-dependent suites)
	$(call ok,CI-equivalent suite green)

.PHONY: all
all: typecheck lint test-unit test-pbt synth test-infra verify-bundle test-integration test-smoke ## [combo] Everything including Docker-dependent suites
	$(call ok,Full suite green)

# ---------------------------------------------------------------------------
# Deploy — EKS (DEV05) shared dev cluster
# ---------------------------------------------------------------------------
#
# Everything routes through `make deploy-dev` (8-step pipeline) and
# `make undeploy-dev` (4-step pipeline). All steps are idempotent —
# `deploy-dev` runs an `undeploy-first` cleanup automatically per the
# operator convention. Override any variable on the command line, e.g.:
#
#   make deploy-dev DEPLOY_IMAGE_TAG=v1 DEPLOY_INGRESS_HOST=ui.dev.example.com
#
# Browser access without an ALB: see `make pf-start`.

DEPLOY_AWS_PROFILE     ?= opus2-dev
DEPLOY_AWS_REGION      ?= eu-west-1
DEPLOY_AWS_ACCOUNT_ID  ?= 537462380503
DEPLOY_ECR_REPO        ?= classification-service-sandbox/classification-service-ui
DEPLOY_IMAGE_TAG       ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
DEPLOY_NAMESPACE       ?= classification-service-sandbox
DEPLOY_HELM_RELEASE    ?= classification-ui
DEPLOY_CHART_DIR       ?= deploy/helm/classification-ui
DEPLOY_LOG_DIR         ?= deploy/logs
DEPLOY_INGRESS_HOST    ?=
DEPLOY_ROUTE53_ZONE_ID ?=
# Out-of-band resources (created outside CDK) — used by `tag-resources`.
DEPLOY_S3_BUCKET       ?= classification-ui-dev05
DEPLOY_IRSA_ROLE_NAME  ?= classification-ui-irsa
# Backend profile: localstack (default — in-cluster LocalStack sibling) or aws
# (real DynamoDB + S3 via IRSA, Option A). See deploy/AWS_TOPOLOGY.md.
DEPLOY_BACKEND         ?= localstack
# IRSA role ARN annotated onto the ServiceAccount — REQUIRED when BACKEND=aws.
DEPLOY_IRSA_ROLE_ARN   ?=
# DANGER: set =true to let `undeploy-all` DESTROY persistent data (DDB tables +
# S3 bucket + IRSA role). Empty/anything-else = refused. Never defaulted on.
DEPLOY_NUKE_DATA       ?=

# Derived — do not override these directly.
DEPLOY_ECR_REGISTRY := $(DEPLOY_AWS_ACCOUNT_ID).dkr.ecr.$(DEPLOY_AWS_REGION).amazonaws.com
DEPLOY_IMAGE_REPO   := $(DEPLOY_ECR_REGISTRY)/$(DEPLOY_ECR_REPO)
DEPLOY_IMAGE_FULL   := $(DEPLOY_IMAGE_REPO):$(DEPLOY_IMAGE_TAG)
DEPLOY_TS           := $(shell date +%Y%m%d-%H%M%S)
DEPLOY_LOG          := $(DEPLOY_LOG_DIR)/deploy-$(DEPLOY_TS).log
DEPLOY_MANIFEST     := $(DEPLOY_LOG_DIR)/manifest-$(DEPLOY_TS).yaml
DEPLOY_UNDEPLOY_LOG := $(DEPLOY_LOG_DIR)/undeploy-$(DEPLOY_TS).log

# Conditional `--set` flags for ingress, evaluated at parse time.
HELM_INGRESS_FLAGS := $(if $(DEPLOY_INGRESS_HOST),--set ingress.enabled=true --set ingress.host=$(DEPLOY_INGRESS_HOST),)

# Backend profile flags. BACKEND=aws layers the real-AWS overlay (which sets
# localstack.enabled=false + CLASSIFIER_AWS_MODE=true + serviceAccount.create)
# and, when supplied, the IRSA role-arn annotation. Single-quoted so the shell
# preserves the `\.`-escaped annotation key for helm. Default localstack = base.
HELM_BACKEND_FLAGS := $(if $(filter aws,$(DEPLOY_BACKEND)),--values $(DEPLOY_CHART_DIR)/values-aws.yaml,)
HELM_IRSA_FLAGS    := $(if $(DEPLOY_IRSA_ROLE_ARN),--set-string 'serviceAccount.annotations.eks\.amazonaws\.com/role-arn=$(DEPLOY_IRSA_ROLE_ARN)',)

.PHONY: check-helm
check-helm: ## [deploy] Verify Helm CLI installed
	@if ! command -v helm >/dev/null 2>&1; then \
		printf "$(COL_RED)✗ Helm not installed.$(COL_OFF)\n  Install: https://helm.sh/docs/intro/install/\n"; exit 1; \
	fi; \
	printf "$(COL_GRN)✓ helm $$(helm version --short)$(COL_OFF)\n"

.PHONY: check-kubectl
check-kubectl: ## [deploy] Verify kubectl installed + a current-context is set
	@if ! command -v kubectl >/dev/null 2>&1; then \
		printf "$(COL_RED)✗ kubectl not installed.$(COL_OFF)\n"; exit 1; \
	fi; \
	ctx=$$(kubectl config current-context 2>/dev/null || echo ""); \
	if [ -z "$$ctx" ]; then \
		printf "$(COL_RED)✗ kubectl has no current-context.$(COL_OFF)\n  Set one with: kubectl config use-context <ctx>\n"; exit 1; \
	fi; \
	printf "$(COL_GRN)✓ kubectl ctx=$$ctx$(COL_OFF)\n"

.PHONY: ecr-ensure
ecr-ensure: check-aws ## [deploy] Create the ECR repo if missing (idempotent)
	$(call banner,Ensuring ECR repo $(DEPLOY_ECR_REPO))
	@AWS_PROFILE=$(DEPLOY_AWS_PROFILE) aws ecr describe-repositories \
		--repository-names $(DEPLOY_ECR_REPO) --region $(DEPLOY_AWS_REGION) \
		>/dev/null 2>&1 \
	|| AWS_PROFILE=$(DEPLOY_AWS_PROFILE) aws ecr create-repository \
		--repository-name $(DEPLOY_ECR_REPO) --region $(DEPLOY_AWS_REGION) \
		--image-scanning-configuration scanOnPush=true \
		--tags Key=Owner,Value=platform-team Key=CostCenter,Value=tbd Key=Service,Value=classification-service Key=Environment,Value=dev Key=Component,Value=ui Key=ManagedBy,Value=manual-dev05 >/dev/null
	$(call ok,ECR repo present)

.PHONY: tag-resources
tag-resources: check-aws ## [deploy] Apply the standard tag set to the out-of-band S3 bucket + IRSA role + ECR repo (match CDK schema)
	$(call banner,Tagging out-of-band resources → bucket=$(DEPLOY_S3_BUCKET) role=$(DEPLOY_IRSA_ROLE_NAME) ecr=$(DEPLOY_ECR_REPO))
	@DEPLOY_AWS_PROFILE=$(DEPLOY_AWS_PROFILE) DEPLOY_AWS_REGION=$(DEPLOY_AWS_REGION) \
		DEPLOY_AWS_ACCOUNT_ID=$(DEPLOY_AWS_ACCOUNT_ID) DEPLOY_ECR_REPO=$(DEPLOY_ECR_REPO) \
		DEPLOY_S3_BUCKET=$(DEPLOY_S3_BUCKET) DEPLOY_IRSA_ROLE_NAME=$(DEPLOY_IRSA_ROLE_NAME) \
		bash deploy/scripts/tag-resources.sh
	$(call ok,Tagged S3 + IAM role + ECR repo)

.PHONY: ecr-login
ecr-login: check-aws ## [deploy] Docker login to ECR (60-min token)
	@AWS_PROFILE=$(DEPLOY_AWS_PROFILE) aws ecr get-login-password --region $(DEPLOY_AWS_REGION) \
		| docker login --username AWS --password-stdin $(DEPLOY_ECR_REGISTRY) >/dev/null
	$(call ok,Logged into $(DEPLOY_ECR_REGISTRY))

.PHONY: image-build
image-build: check-docker ## [deploy] Build the UI image for linux/amd64 (EKS node arch)
	$(call banner,Building UI image $(DEPLOY_IMAGE_FULL))
	@docker build --platform linux/amd64 -f ui/Dockerfile -t $(DEPLOY_IMAGE_FULL) .
	$(call ok,Built $(DEPLOY_IMAGE_FULL))

.PHONY: image-push
image-push: ecr-ensure ecr-login image-build ## [deploy] Push UI image to ECR
	$(call banner,Pushing $(DEPLOY_IMAGE_FULL))
	@docker push $(DEPLOY_IMAGE_FULL)
	$(call ok,Pushed)

.PHONY: check-deploy-backend
check-deploy-backend: ## [deploy] Validate DEPLOY_BACKEND (aws requires DEPLOY_IRSA_ROLE_ARN)
	@if [ "$(DEPLOY_BACKEND)" = "aws" ] && [ -z "$(DEPLOY_IRSA_ROLE_ARN)" ]; then \
		printf "$(COL_RED)✗ DEPLOY_BACKEND=aws requires DEPLOY_IRSA_ROLE_ARN=<role-arn>$(COL_OFF)\n"; \
		printf "  Create the IRSA role first — see deploy/AWS_TOPOLOGY.md (Step 3).\n"; \
		exit 1; \
	elif [ "$(DEPLOY_BACKEND)" != "localstack" ] && [ "$(DEPLOY_BACKEND)" != "aws" ]; then \
		printf "$(COL_RED)✗ DEPLOY_BACKEND must be 'localstack' or 'aws' (got '$(DEPLOY_BACKEND)')$(COL_OFF)\n"; \
		exit 1; \
	fi

.PHONY: irsa-smoketest
irsa-smoketest: check-kubectl ## [deploy] Pre-flight (no UI deploy): assume the IRSA role as the SA + list tables + node arch
	@if [ -z "$(DEPLOY_IRSA_ROLE_ARN)" ]; then \
		printf "$(COL_RED)✗ irsa-smoketest requires DEPLOY_IRSA_ROLE_ARN=<role-arn>$(COL_OFF)\n"; \
		printf "  Create the IRSA role first — see deploy/AWS_TOPOLOGY.md Step 3.\n"; \
		exit 1; \
	fi
	$(call banner,IRSA pre-flight → ns=$(DEPLOY_NAMESPACE) sa=$(DEPLOY_HELM_RELEASE) region=$(DEPLOY_AWS_REGION))
	@printf "  $(COL_BOLD)Node arch$(COL_OFF) (the UI image builds linux/amd64): "; \
		kubectl get nodes -o jsonpath='{range .items[*]}{.status.nodeInfo.architecture}{" "}{end}' 2>/dev/null || true; echo
	@kubectl get ns $(DEPLOY_NAMESPACE) >/dev/null 2>&1 || kubectl create ns $(DEPLOY_NAMESPACE) >/dev/null
	@# Temp SA named exactly like the deployment SA — the IRSA trust policy is
	@# scoped to system:serviceaccount:<ns>:$(DEPLOY_HELM_RELEASE). Removed after
	@# the test so `make deploy-dev` (Helm-managed SA) recreates it cleanly.
	@kubectl -n $(DEPLOY_NAMESPACE) create serviceaccount $(DEPLOY_HELM_RELEASE) --dry-run=client -o yaml | kubectl apply -f - >/dev/null
	@kubectl -n $(DEPLOY_NAMESPACE) annotate serviceaccount $(DEPLOY_HELM_RELEASE) \
		eks.amazonaws.com/role-arn=$(DEPLOY_IRSA_ROLE_ARN) --overwrite >/dev/null
	@printf "  $(COL_BOLD)Assuming role + listing tables as the SA…$(COL_OFF)\n"; \
	kubectl run irsa-smoketest -n $(DEPLOY_NAMESPACE) \
		--overrides='{"spec":{"serviceAccountName":"$(DEPLOY_HELM_RELEASE)"}}' \
		--image=amazon/aws-cli:2.17.0 --restart=Never --rm -i --command -- \
		sh -c 'aws sts get-caller-identity && aws dynamodb list-tables --region $(DEPLOY_AWS_REGION)'; \
	rc=$$?; \
	kubectl -n $(DEPLOY_NAMESPACE) delete serviceaccount $(DEPLOY_HELM_RELEASE) --ignore-not-found >/dev/null 2>&1; \
	if [ $$rc -eq 0 ]; then \
		printf "$(COL_GRN)✓ IRSA OK — role assumable + tables reachable from the cluster (temp SA removed)$(COL_OFF)\n"; \
	else \
		printf "$(COL_RED)✗ IRSA smoke test FAILED (rc=$$rc) — fix before deploy-dev (check OIDC trust, SA name/ns, role policy, pod egress)$(COL_OFF)\n"; \
	fi; \
	exit $$rc

.PHONY: helm-lint
helm-lint: check-helm ## [deploy] helm lint the chart
	@helm lint $(DEPLOY_CHART_DIR) --set image.repository=$(DEPLOY_IMAGE_REPO) --set image.tag=$(DEPLOY_IMAGE_TAG) \
		$(HELM_BACKEND_FLAGS) $(HELM_IRSA_FLAGS)

.PHONY: helm-template
helm-template: check-helm check-deploy-backend ## [deploy] helm template the chart (dry-run render — also written to deploy/logs)
	@mkdir -p $(DEPLOY_LOG_DIR)
	@helm template $(DEPLOY_HELM_RELEASE) $(DEPLOY_CHART_DIR) \
		--namespace $(DEPLOY_NAMESPACE) \
		--set image.repository=$(DEPLOY_IMAGE_REPO) \
		--set image.tag=$(DEPLOY_IMAGE_TAG) \
		$(HELM_INGRESS_FLAGS) $(HELM_BACKEND_FLAGS) $(HELM_IRSA_FLAGS) | tee $(DEPLOY_MANIFEST)
	$(call ok,Rendered manifest → $(DEPLOY_MANIFEST))

.PHONY: helm-deploy
helm-deploy: check-helm check-kubectl check-deploy-backend ## [deploy] helm upgrade --install
	$(call banner,Deploying $(DEPLOY_HELM_RELEASE) → ns=$(DEPLOY_NAMESPACE) backend=$(DEPLOY_BACKEND))
	@mkdir -p $(DEPLOY_LOG_DIR)
	@# Adopt a pre-existing namespace into the release so the chart's Namespace
	@# resource doesn't fail with "invalid ownership metadata". This happens when
	@# the ns was created out-of-band (e.g. by `make irsa-smoketest`) and there's
	@# no prior release for `__undeploy-soft` to clean. No-op when the ns is absent
	@# (helm --create-namespace creates it) or already owned by this release.
	@if kubectl get ns $(DEPLOY_NAMESPACE) >/dev/null 2>&1; then \
		kubectl label ns $(DEPLOY_NAMESPACE) app.kubernetes.io/managed-by=Helm --overwrite >/dev/null 2>&1 || true; \
		kubectl annotate ns $(DEPLOY_NAMESPACE) \
			meta.helm.sh/release-name=$(DEPLOY_HELM_RELEASE) \
			meta.helm.sh/release-namespace=$(DEPLOY_NAMESPACE) --overwrite >/dev/null 2>&1 || true; \
	fi
	@helm upgrade --install $(DEPLOY_HELM_RELEASE) $(DEPLOY_CHART_DIR) \
		--namespace $(DEPLOY_NAMESPACE) --create-namespace \
		--set image.repository=$(DEPLOY_IMAGE_REPO) \
		--set image.tag=$(DEPLOY_IMAGE_TAG) \
		$(HELM_INGRESS_FLAGS) $(HELM_BACKEND_FLAGS) $(HELM_IRSA_FLAGS) \
		--wait --timeout=5m 2>&1 | tee -a $(DEPLOY_LOG)
	$(call ok,Helm release upgraded)

.PHONY: manifest-snapshot
manifest-snapshot: check-helm ## [deploy] helm get manifest → deploy/logs/manifest-<ts>.yaml
	@mkdir -p $(DEPLOY_LOG_DIR)
	@helm get manifest $(DEPLOY_HELM_RELEASE) --namespace $(DEPLOY_NAMESPACE) > $(DEPLOY_MANIFEST)
	$(call ok,Snapshot → $(DEPLOY_MANIFEST))

.PHONY: route53-sync
route53-sync: ## [deploy] UPSERT A-alias DEPLOY_INGRESS_HOST → ALB (skipped if no host/zone set)
	@if [ -z "$(DEPLOY_INGRESS_HOST)" ] || [ -z "$(DEPLOY_ROUTE53_ZONE_ID)" ]; then \
		printf "$(COL_YEL)! Skipping Route 53 sync (DEPLOY_INGRESS_HOST or DEPLOY_ROUTE53_ZONE_ID not set)$(COL_OFF)\n"; \
	else \
		AWS_PROFILE=$(DEPLOY_AWS_PROFILE) AWS_REGION=$(DEPLOY_AWS_REGION) \
		ROUTE53_ZONE_ID=$(DEPLOY_ROUTE53_ZONE_ID) INGRESS_HOST=$(DEPLOY_INGRESS_HOST) \
		K8S_NAMESPACE=$(DEPLOY_NAMESPACE) INGRESS_NAME=$(DEPLOY_HELM_RELEASE) \
		bash deploy/scripts/route53-upsert.sh 2>&1 | tee -a $(DEPLOY_LOG); \
	fi

.PHONY: route53-cleanup
route53-cleanup: ## [deploy] DELETE the A-alias (must run BEFORE helm uninstall)
	@if [ -z "$(DEPLOY_INGRESS_HOST)" ] || [ -z "$(DEPLOY_ROUTE53_ZONE_ID)" ]; then \
		printf "$(COL_YEL)! Skipping Route 53 cleanup (DEPLOY_INGRESS_HOST or DEPLOY_ROUTE53_ZONE_ID not set)$(COL_OFF)\n"; \
	else \
		AWS_PROFILE=$(DEPLOY_AWS_PROFILE) AWS_REGION=$(DEPLOY_AWS_REGION) \
		ROUTE53_ZONE_ID=$(DEPLOY_ROUTE53_ZONE_ID) INGRESS_HOST=$(DEPLOY_INGRESS_HOST) \
		K8S_NAMESPACE=$(DEPLOY_NAMESPACE) INGRESS_NAME=$(DEPLOY_HELM_RELEASE) \
		bash deploy/scripts/route53-delete.sh 2>&1 | tee -a $(DEPLOY_UNDEPLOY_LOG); \
	fi

.PHONY: status
status: check-kubectl ## [deploy] kubectl get pods,svc,ingress in the namespace
	@kubectl -n $(DEPLOY_NAMESPACE) get pods,svc,ingress 2>&1 | tee -a $(DEPLOY_LOG) || true

.PHONY: deploy-summary
deploy-summary: check-kubectl ## [deploy] Print clean URL + resource block (also written to deploy log)
	@set +eu +o pipefail; { \
	  alb=$$(kubectl -n $(DEPLOY_NAMESPACE) get ingress $(DEPLOY_HELM_RELEASE) -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true); \
	  rev=$$(helm status $(DEPLOY_HELM_RELEASE) --namespace $(DEPLOY_NAMESPACE) --output json 2>/dev/null | sed -n 's/.*"revision":[[:space:]]*\([0-9]*\).*/\1/p' | head -1); \
	  printf "\n$(COL_BOLD)$(COL_CYN)▶ Deployed resources$(COL_OFF)\n"; \
	  if [ -n "$(DEPLOY_INGRESS_HOST)" ]; then \
	    printf "  $(COL_BOLD)%-15s$(COL_OFF) %s\n" "Public URL"   "https://$(DEPLOY_INGRESS_HOST)/"; \
	    printf "  $(COL_BOLD)%-15s$(COL_OFF) %s\n" "Health check" "https://$(DEPLOY_INGRESS_HOST)/api/health"; \
	    if [ -n "$(DEPLOY_ROUTE53_ZONE_ID)" ]; then \
	      printf "  $(COL_BOLD)%-15s$(COL_OFF) %s\n" "Route 53"   "$(DEPLOY_INGRESS_HOST) → ALB (zone $(DEPLOY_ROUTE53_ZONE_ID))"; \
	    fi; \
	  else \
	    printf "  $(COL_BOLD)%-15s$(COL_OFF) %s\n" "Access"      "no Ingress — use \`make pf-start\` for port-forward"; \
	  fi; \
	  if [ -n "$$alb" ]; then \
	    printf "  $(COL_BOLD)%-15s$(COL_OFF) %s\n" "ALB hostname" "$$alb"; \
	  fi; \
	  printf "  $(COL_BOLD)%-15s$(COL_OFF) %s\n" "Namespace"     "$(DEPLOY_NAMESPACE)"; \
	  printf "  $(COL_BOLD)%-15s$(COL_OFF) %s$${rev:+ (rev $$rev)}\n" "Helm release" "$(DEPLOY_HELM_RELEASE)"; \
	  printf "  $(COL_BOLD)%-15s$(COL_OFF) %s\n" "Image"         "$(DEPLOY_IMAGE_FULL)"; \
	  printf "  $(COL_BOLD)%-15s$(COL_OFF) %s\n" "Log"           "$(DEPLOY_LOG)"; \
	  printf "  $(COL_BOLD)%-15s$(COL_OFF) %s\n\n" "Manifest"    "$(DEPLOY_MANIFEST)"; \
	} | tee -a $(DEPLOY_LOG)

.PHONY: undeploy-summary
undeploy-summary: ## [deploy] Print summary of removed resources (also written to undeploy log)
	@{ \
	  printf "\n$(COL_BOLD)$(COL_CYN)▶ Undeployed resources$(COL_OFF)\n"; \
	  if [ -n "$(DEPLOY_INGRESS_HOST)" ] && [ -n "$(DEPLOY_ROUTE53_ZONE_ID)" ]; then \
	    printf "  $(COL_BOLD)%-17s$(COL_OFF) %s\n" "Route 53 record" "$(DEPLOY_INGRESS_HOST) (zone $(DEPLOY_ROUTE53_ZONE_ID))"; \
	  fi; \
	  printf "  $(COL_BOLD)%-17s$(COL_OFF) %s\n" "Helm release"     "$(DEPLOY_HELM_RELEASE)"; \
	  printf "  $(COL_BOLD)%-17s$(COL_OFF) %s\n" "Namespace"        "$(DEPLOY_NAMESPACE)"; \
	  printf "  $(COL_BOLD)%-17s$(COL_OFF) %s\n" "ALB / TG / LRs"   "torn down by AWS LBC reconcile"; \
	  printf "\n  $(COL_YEL)Kept by design (Makefile policy):$(COL_OFF)\n"; \
	  printf "    %-17s %s\n" "ECR image"       "$(DEPLOY_IMAGE_FULL)"; \
	  printf "    %-17s %s\n" "ECR repository"  "$(DEPLOY_ECR_REPO)"; \
	  printf "    %-17s %s\n" "Local logs"      "$(DEPLOY_LOG_DIR)/"; \
	  if [ "$(DEPLOY_BACKEND)" = "aws" ]; then \
	    printf "    %-17s %s\n" "IRSA IAM role"   "out-of-band — see deploy/AWS_TOPOLOGY.md teardown"; \
	    printf "    %-17s %s\n" "DDB tables/bkt"  "real AWS data kept — delete via cdk destroy / aws cli"; \
	    printf "    %-17s %s\n" "SQS queue"       "if archive fan-out enabled — delete via aws sqs delete-queue"; \
	  fi; \
	  printf "    %-17s AWS_PROFILE=$(DEPLOY_AWS_PROFILE) aws ecr delete-repository \\\\\n" "Nuke ECR via:"; \
	  printf "                      --repository-name $(DEPLOY_ECR_REPO) --region $(DEPLOY_AWS_REGION) --force\n"; \
	  printf "  $(COL_BOLD)%-17s$(COL_OFF) %s\n\n" "Log"            "$(DEPLOY_UNDEPLOY_LOG)"; \
	} | tee -a $(DEPLOY_UNDEPLOY_LOG)

.PHONY: __undeploy-soft
__undeploy-soft:
	$(call banner,Best-effort cleanup before re-deploy)
	@if helm status $(DEPLOY_HELM_RELEASE) --namespace $(DEPLOY_NAMESPACE) >/dev/null 2>&1; then \
		$(MAKE) --no-print-directory undeploy-dev DEPLOY_TS=$(DEPLOY_TS) || true; \
	else \
		printf "$(COL_YEL)! No existing release — skipping undeploy-first$(COL_OFF)\n"; \
	fi

.PHONY: deploy-dev
deploy-dev: check-deploy-backend __undeploy-soft image-push helm-deploy manifest-snapshot route53-sync status deploy-summary ## [deploy] Full pipeline: validate backend → undeploy-first → ECR → build → push → helm upgrade → manifest snapshot → route53 → status → summary
	$(call ok,deploy-dev complete  tag=$(DEPLOY_IMAGE_TAG)  log=$(DEPLOY_LOG))

.PHONY: helm-undeploy
helm-undeploy: check-helm check-kubectl ## [deploy] helm uninstall
	@if helm status $(DEPLOY_HELM_RELEASE) --namespace $(DEPLOY_NAMESPACE) >/dev/null 2>&1; then \
		helm uninstall $(DEPLOY_HELM_RELEASE) --namespace $(DEPLOY_NAMESPACE) 2>&1 | tee -a $(DEPLOY_UNDEPLOY_LOG); \
	else \
		printf "$(COL_YEL)! Release $(DEPLOY_HELM_RELEASE) not present in $(DEPLOY_NAMESPACE) — skipping$(COL_OFF)\n"; \
	fi

.PHONY: ns-delete
ns-delete: check-kubectl ## [deploy] Drop the namespace (waits for finalizers)
	@if kubectl get ns $(DEPLOY_NAMESPACE) >/dev/null 2>&1; then \
		kubectl delete ns $(DEPLOY_NAMESPACE) --wait=true 2>&1 | tee -a $(DEPLOY_UNDEPLOY_LOG); \
	else \
		printf "$(COL_YEL)! Namespace $(DEPLOY_NAMESPACE) not present — skipping$(COL_OFF)\n"; \
	fi

.PHONY: undeploy-dev
undeploy-dev: route53-cleanup helm-undeploy ns-delete undeploy-summary ## [deploy] Full teardown: route53 DELETE (first!) → helm uninstall → namespace drop → summary
	@mkdir -p $(DEPLOY_LOG_DIR)
	$(call ok,undeploy-dev complete  log=$(DEPLOY_UNDEPLOY_LOG))

.PHONY: check-nuke
check-nuke:
	@if [ "$(DEPLOY_NUKE_DATA)" != "true" ]; then \
		printf "$(COL_RED)✗ undeploy-all DESTROYS persistent data — refused without explicit confirmation.$(COL_OFF)\n"; \
		printf "  It would permanently delete (region=$(DEPLOY_AWS_REGION), profile=$(COL_BOLD)$(DEPLOY_AWS_PROFILE)$(COL_OFF)):\n"; \
		printf "    • DynamoDB stack $(COL_BOLD)ClassificationData-$(ENV)$(COL_OFF)  (content-hashes / workspace-config / classifications + ALL rows)\n"; \
		printf "    • S3 bucket      $(COL_BOLD)$(DEPLOY_S3_BUCKET)$(COL_OFF)  (+ every uploaded object)\n"; \
		printf "    • IAM role       $(COL_BOLD)$(DEPLOY_IRSA_ROLE_NAME)$(COL_OFF)\n"; \
		printf "  For app-only teardown (keeps data) use $(COL_BOLD)make undeploy-dev$(COL_OFF).\n"; \
		printf "  To really destroy data, re-run: $(COL_BOLD)make undeploy-all DEPLOY_NUKE_DATA=true$(COL_OFF)\n"; \
		exit 1; \
	fi

.PHONY: nuke-data
nuke-data: check-nuke check-aws ## [deploy] DANGER: destroy DDB tables + S3 bucket + IRSA role (needs DEPLOY_NUKE_DATA=true)
	$(call banner,NUKING persistent data — DDB stack + S3 bucket + IRSA role)
	@printf "$(COL_YEL)→ cdk destroy ClassificationData-$(ENV) (DynamoDB tables)$(COL_OFF)\n"
	-@npx cdk destroy ClassificationData-$(ENV) -c env=$(ENV) --profile $(DEPLOY_AWS_PROFILE) --force 2>&1 | tail -4
	@printf "$(COL_YEL)→ aws s3 rb s3://$(DEPLOY_S3_BUCKET) --force (bucket + objects)$(COL_OFF)\n"
	-@AWS_PROFILE=$(DEPLOY_AWS_PROFILE) aws s3 rb s3://$(DEPLOY_S3_BUCKET) --force 2>&1 | tail -3
	@printf "$(COL_YEL)→ delete IAM role $(DEPLOY_IRSA_ROLE_NAME)$(COL_OFF)\n"
	-@AWS_PROFILE=$(DEPLOY_AWS_PROFILE) aws iam delete-role-policy --role-name $(DEPLOY_IRSA_ROLE_NAME) --policy-name classification-ui-access 2>/dev/null || true
	-@AWS_PROFILE=$(DEPLOY_AWS_PROFILE) aws iam delete-role --role-name $(DEPLOY_IRSA_ROLE_NAME) 2>&1 | tail -2
	$(call ok,Data resources destroyed)

.PHONY: undeploy-all
undeploy-all: check-nuke undeploy-dev nuke-data ## [deploy] DANGER: full teardown INCL. DATA — undeploy-dev + destroy tables/bucket/role (needs DEPLOY_NUKE_DATA=true)
	$(call ok,undeploy-all complete — app removed AND persistent data destroyed)

.PHONY: pf-start
pf-start: check-kubectl ## [deploy] Start kubectl port-forward to classification-ui (localhost:3000)
	@K8S_NAMESPACE=$(DEPLOY_NAMESPACE) HELM_RELEASE=$(DEPLOY_HELM_RELEASE) \
		bash deploy/scripts/portforward.sh start

.PHONY: pf-status
pf-status: ## [deploy] Show port-forward PID + port + health
	@bash deploy/scripts/portforward.sh status

.PHONY: pf-stop
pf-stop: ## [deploy] Stop the running port-forward
	@bash deploy/scripts/portforward.sh stop

.PHONY: pf-restart
pf-restart: check-kubectl ## [deploy] Restart the port-forward
	@K8S_NAMESPACE=$(DEPLOY_NAMESPACE) HELM_RELEASE=$(DEPLOY_HELM_RELEASE) \
		bash deploy/scripts/portforward.sh restart

# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------

.PHONY: clean
clean: ## [misc] Remove build outputs (dist/, cdk.out/, coverage/, .tsbuildinfo)
	$(call banner,Cleaning build outputs)
	@rm -rf dist cdk.out coverage .tsbuildinfo tests/bench/__output__
	$(call ok,Clean)

.PHONY: clean-deps
clean-deps: ## [misc] Remove node_modules + package-lock (forces a fresh install next run)
	@read -r -p "$$(printf '$(COL_YEL)? Delete node_modules and package-lock.json? [y/N] $(COL_OFF)')" reply; \
	reply="$${reply:-N}"; \
	if [[ "$$reply" =~ ^[Yy]$$ ]]; then \
		rm -rf node_modules package-lock.json; \
		printf "$(COL_GRN)✓ Removed node_modules + lockfile$(COL_OFF)\n"; \
	else \
		printf "$(COL_YEL)! Skipped$(COL_OFF)\n"; \
	fi

.PHONY: doctor
doctor: check-node check-npm check-docker check-sam check-aws ## [misc] Run every prereq check and report
	$(call ok,Doctor checks finished — review any warnings above)
