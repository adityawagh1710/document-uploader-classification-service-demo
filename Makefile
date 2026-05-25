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
	@printf "\n  $(COL_CYN)Housekeeping$(COL_OFF)\n"
	@awk 'BEGIN{FS=":.*##"} /^[a-z-]+:.*## \[misc\]/ {printf "    $(COL_GRN)%-18s$(COL_OFF) %s\n", $$1, gensub(/^ ?\[misc\] ?/, "", "g", $$2)}' $(MAKEFILE_LIST)
	@printf "\n  $(COL_CYN)Variables$(COL_OFF)\n"
	@printf "    $(COL_GRN)ENV$(COL_OFF)                CDK env context (default: dev). Override: $(COL_BOLD)make synth ENV=staging$(COL_OFF)\n"
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
