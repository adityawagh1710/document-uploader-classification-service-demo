# Performance Test Instructions

> Validates the Lambda Classification Service meets latency, throughput, and cold-start targets from the requirements + NFR docs. Two test phases: **local micro-benchmarks** (no AWS cost) and **deployed load tests** (against dev account).

---

## 1. Performance Requirements (from `requirements.md` + per-unit NFR docs)

| Metric | Target | Source |
|---|---|---|
| Latency p99 — small docs (≤ 1 MB) | ≤ 3 000 ms | NFR-1 |
| Latency p99 — large docs (1 MB – 50 MB) | ≤ 15 000 ms | NFR-1 |
| Cold-start latency (init duration) | ≤ 1 500 ms | NFR-2 |
| Throughput (sustained) | ≥ 100 invocations/s per workspace | NFR-3 |
| Error rate (under target load) | < 0.5 % | NFR-9 |
| DDB conditional-write contention recovery | < 100 ms median retry | U-2 IaD §4 |
| Lambda bundle size | ≤ 5 MB | U-3 NFR Req §2 |
| Lambda memory (RSS peak) | ≤ 384 MB / 512 MB configured | U-3 NFR Req §3 |

---

## 2. Local Micro-benchmarks

These run on a developer workstation. They cover the **pure-CPU detection path** and provide a fast-feedback signal on regressions.

### 2.1 Run the micro-bench suite

```bash
npm run bench
```

Vitest-bench runs `tests/bench/**/*.bench.ts`. Each benchmark fixes a representative input (a curated PDF, OLE2 file, ZIP-based docx, large text file) and measures:

| Bench | What is measured |
|---|---|
| `tier1-filetype.bench.ts` | File-type sniff over 1 MB binary |
| `tier2-ole2.bench.ts` | OLE2 CLSID resolution over 5 MB OLE2 |
| `tier2-zip.bench.ts` | ZIP marker scan over 10 MB docx |
| `tier3-text.bench.ts` | UTF-8 statistical heuristic over 1 MB text |
| `scoring.bench.ts` | Multi-tier evidence scoring (synthetic evidence set) |
| `hashing.bench.ts` | SHA-256 streaming over 50 MB stream |

Bench output is `tests/bench/__output__/bench-report.json`. Compare against the committed baseline at `tests/bench/baselines/baseline.json`:

```bash
node tests/bench/_helpers/compare-baseline.mjs
```

**Regression gate**: any bench more than **15 % slower** than the baseline (warm runs) fails this check. Update the baseline only with a written justification in the PR description.

### 2.2 Interpreting micro-bench results

- Each detector should complete in **< 50 ms** on 1 MB inputs.
- Hashing should sustain **≥ 200 MB/s** on modern x86 / ARM workstations.
- A 5–10 % run-to-run variance is normal; only **persistent regression beyond baseline + 15 %** is a fail.

---

## 3. Deployed Load Tests (dev account)

Validates the deployed Lambda + DDB + Step Functions surface under realistic concurrency.

### 3.1 Tooling

| Tool | Version | Purpose |
|---|---|---|
| Artillery | ≥ 2.0.x | HTTP-trigger load generator (driving SFN start-execution) |
| k6 | ≥ 0.51 | Optional alternative for higher concurrency |
| AWS CLI v2 | ≥ 2.15 | Pulls Lambda + DDB CloudWatch metrics post-run |

The load harness lives at `tests/perf/`:

```
tests/perf/
├── scenarios/
│   ├── small-doc-100rps.yaml       # 1 MB PDF; 100 rps for 5 min
│   ├── large-doc-10rps.yaml        # 30 MB OCR-direct case; 10 rps for 5 min
│   ├── mixed-workload.yaml         # 80 % small / 20 % large; 60 rps for 10 min
│   └── cold-start-burst.yaml       # forces 100 concurrent invocations from cold (provisioned=0)
├── fixtures/                       # canonical S3 objects (pre-loaded into a dev test bucket)
└── _helpers/
    ├── start-execution.mjs         # Calls SFN StartExecution per Artillery vu
    └── collect-metrics.mjs         # Aggregates Lambda + DDB metrics post-run
```

### 3.2 Pre-flight

1. Confirm `dev` is deployed and stable.
2. Pre-load the test S3 bucket with fixtures:
   ```bash
   bash tests/perf/_helpers/upload-fixtures.sh
   ```
3. Confirm DDB capacity mode (on-demand) is provisioned for the test tables; or pre-warm if provisioned-capacity is in use.
4. Notify on-call (Slack `#classification-service-alerts`) — load tests will trigger alarms.

### 3.3 Run a scenario

```bash
AWS_PROFILE=classification-dev \
  artillery run tests/perf/scenarios/small-doc-100rps.yaml \
  --output tests/perf/results/small-doc-100rps-$(date +%s).json
```

Or with k6 (higher concurrency):

```bash
AWS_PROFILE=classification-dev k6 run tests/perf/scenarios/small-doc-100rps.js
```

### 3.4 Post-run metrics collection

```bash
node tests/perf/_helpers/collect-metrics.mjs \
  --env=dev \
  --start="$(date -u -d '15 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --out=tests/perf/results/metrics-$(date +%s).json
```

Pulls:
- Lambda `Duration` p50/p95/p99
- Lambda `InitDuration` p99 (cold-start)
- Lambda `Errors` + `Throttles`
- Lambda `ConcurrentExecutions` max
- DDB `ConsumedReadCapacityUnits` / `ConsumedWriteCapacityUnits`
- DDB `ConditionalCheckFailedRequests`
- DDB `UserErrors`
- SFN `ExecutionsFailed` / `ExecutionsTimedOut`

---

## 4. Stress Tests

### 4.1 Burst test — cold-start cap

```bash
artillery run tests/perf/scenarios/cold-start-burst.yaml
```

100 invocations in < 1 s from cold (no provisioned concurrency). Expectation:
- All complete within 30 s
- `InitDuration p99` ≤ 1 500 ms
- Zero `Errors` (throttles may briefly appear and recover)

### 4.2 Sustained stress — 5× target load

```bash
artillery run tests/perf/scenarios/mixed-workload.yaml \
  -o tests/perf/results/sustained-stress.json \
  --overrides '{"config":{"phases":[{"duration":1800,"arrivalRate":500}]}}'
```

30 minutes at 500 rps. Expectation:
- Latencies degrade gracefully — no error rate > 1 %.
- DDB scales without `ThrottlingException`.
- Lambda concurrency stays under any reserved concurrency cap (prod: 200; dev: none).

---

## 5. Analyzing Results

For each run, the report includes:

| Metric | Acceptance Bar |
|---|---|
| `latency.p99` (small) | ≤ 3 000 ms |
| `latency.p99` (large) | ≤ 15 000 ms |
| `coldStart.p99` | ≤ 1 500 ms |
| `errorRate` | < 0.5 % |
| `throttleCount` | 0 |
| `ddb.conditionalFailures` | reflect dedup contention realistically; not unbounded |

A run **passes** when all bars are met. Otherwise:

1. Open the CloudWatch dashboard (`ClassificationService-{env}`) for the run window.
2. Identify the bottleneck (Lambda duration spike vs DDB throttle vs SFN backoff).
3. File the regression issue with the run output JSON attached.
4. Do **not** widen the acceptance bar without a written NFR change approved by SRE.

---

## 6. Local Cold-start Probe (SAM Local)

A lightweight local proxy for cold-start regressions. Not equivalent to AWS measurement, but catches obvious bundle-bloat causes:

```bash
time sam local invoke ClassificationFunction \
  --event tests/smoke/events/small-pdf.json \
  --container-host-interface 0.0.0.0
```

A bundle that takes > 3 s to first-invoke locally **will not** clear the deployed 1 500 ms `InitDuration` bar.

---

## 7. Performance Optimization Workflow

If a test fails:

1. **Profile** — enable Powertools tracer (`POWERTOOLS_TRACER_CAPTURE_RESPONSE=true`) for one run and inspect X-Ray.
2. **Identify** — is the hotspot in detection, hashing, DDB, or SFN ack?
3. **Fix** — narrowest possible change. Avoid speculative caching.
4. **Re-run** — same scenario, compare against baseline.
5. **Commit** — write the new baseline into `tests/bench/baselines/baseline.json` with a PR comment explaining the regression cause + fix.
