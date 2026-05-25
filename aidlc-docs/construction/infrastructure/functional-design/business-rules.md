# Business Rules — U-4 `infrastructure`

> Universal CDK rules + per-resource rules (inherited from U-2 + U-3 IaD docs) + cdk-nag suppression registry + final SECURITY compliance map.

---

## 1. Universal Rules

| Rule ID | Rule | Source |
|---|---|---|
| BR-4-1 | All CDK code is declarative — no business logic in `infra/` | Hexagonal layout |
| BR-4-2 | Per-environment differences live exclusively in `infra/config/*.ts` files (one per env) — never inline in stack code | Q4=A |
| BR-4-3 | L2 constructs preferred everywhere; L1 only when no L2 exists (e.g., X-Ray sampling) | Q2=A |
| BR-4-4 | Stacks declare typed `Props` interfaces; cross-stack references use direct construct refs within the same app | Q1=A |
| BR-4-5 | Resources are named with the environment suffix (except prod which uses the canonical name) for clarity in the AWS console | Convention |
| BR-4-6 | Every CDK stack has an associated test file with both snapshot test and at least one fine-grained assertion | Q3=A |
| BR-4-7 | `cdk-nag` aspect applied at app level; every `Aws*` rule must pass or have a documented suppression | Q5=A |

---

## 2. Data Stack Rules (inherited from U-2 IaD)

| Rule | Source |
|---|---|
| `content-hashes` table: PK `workspaceId` (S), SK `contentHash` (S), PAY_PER_REQUEST, AWS_MANAGED SSE, TTL on `expiresAt` | U-2 IaD §2.1 |
| `content-hashes` table: PITR enabled in staging/prod, disabled in dev | U-2 IaD §2.2 + U-2 DA §1 |
| `content-hashes` table: deletion protection enabled in staging/prod | U-2 IaD §2.2 + Q5=A of U-2 IaD |
| `content-hashes` table: contributor insights enabled in all envs | U-2 IaD §2.2 |
| `workspace-config` table: PK `workspaceId` (S), PAY_PER_REQUEST, AWS_MANAGED SSE | U-2 IaD §3.1 |
| `workspace-config` table: PITR disabled (per Q2=A) — `cdk-nag` suppression `AwsSolutions-DDB3` with documented reason | U-2 IaD §3.2 + §8 |
| Neither table has Streams enabled (per Q3=C of U-2 IaD) | U-2 IaD §2.2 / §3.2 |
| Both tables: RemovalPolicy.RETAIN in prod, RemovalPolicy.DESTROY in dev | U-2 DA §1 |

---

## 3. Lambda Stack Rules (inherited from U-3 IaD)

| Rule | Source |
|---|---|
| Runtime: `nodejs20.x` | U-3 IaD §2.1 |
| Architecture: `arm64` | U-3 IaD §2.1 |
| Memory: 512 MB; Timeout: 30 seconds | U-3 IaD §2.1 |
| Reserved concurrency: 100 in prod; unset (unlimited) in dev/staging | U-3 IaD §2.1 |
| Tracing: ACTIVE (X-Ray) | U-3 IaD §2.1 |
| Bundling: esbuild ESM target node20, minify, sourceMap, externalModules `@aws-sdk/*` | U-3 IaD §2.2 |
| Environment variables: 9 vars per U-3 IaD §2.3 (LOG_LEVEL, POWERTOOLS_*, table names from cross-stack refs, STATE_MACHINE_ARN from cross-stack import) | U-3 IaD §2.3 |
| IAM: 4 inline statements (DDB GetItem/PutItem/UpdateItem on content-hashes; DDB GetItem on workspace-config; S3 GetObject on bucket; SFN SendTaskSuccess/Failure on State Machine) + 2 AWS-managed policies with documented suppressions | U-3 IaD §2.4 |
| X-Ray sampling rule: `reservoirSize: 1, fixedRate: 0.05` in prod (configurable per env) | U-3 IaD §2.6 |
| Alias: `live` pointing to `currentVersion` (atomic deploys) | U-3 IaD §2.5 |
| Log retention: 90 days in prod, 30 in staging, 7 in dev | U-3 DA §1 |
| Lambda Insights: enabled in staging/prod, disabled in dev | U-3 DA §1 |

---

## 4. Observability Stack Rules

| Rule | Source |
|---|---|
| 4 DDB alarms (3 on content-hashes + 1 workspace-config-not-found custom metric) | U-2 IaD §6 |
| 6 Lambda alarms (Duration p99 small + Duration p99 large + Errors + Throttles + ConcurrentExecutions + ColdStart p99) | U-3 IaD §3 |
| All alarms publish to a per-environment SNS topic via SSM-resolved ARN | U-3 IaD Q3=A |
| ConcurrentExecutions alarm omitted in dev/staging (no reserved concurrency cap to compare against) | logical inference |
| CloudWatch Dashboard with widgets per US-SRE-003 (per-category breakdown, per-detection-tier, latency p50/p99, error rate) | US-SRE-003 |

---

## 5. cdk-nag Suppression Registry

Two documented suppressions across all stacks:

| Stack | Resource | Rule | Reason |
|---|---|---|---|
| `ClassificationDataStack` | `workspace-config` table | `AwsSolutions-DDB3` | Workspace config is small + source-of-truth managed externally; PITR overhead not justified (per U-2 IaD Q2=A). |
| `ClassificationLambdaStack` | Lambda execution role | `AwsSolutions-IAM4` | AWSLambdaBasicExecutionRole and AWSXRayDaemonWriteAccess are AWS-recommended managed policies for Lambda logging + X-Ray; using them is more reliable than re-deriving every action (per U-3 IaD §6). |
| `ClassificationLambdaStack` | Lambda function | `AwsSolutions-L2` | Lambda DLQ not configured because the Step Function task-retry policy serves as the dead-letter mechanism (per U-3 IaD §6). |

All other `AwsSolutionsChecks` rules pass by construction (no wildcard IAM resources, encryption enabled, tables have appropriate retention, etc.).

---

## 6. Test Rules

| Rule | Detail |
|---|---|
| Each stack file (`data-stack.ts`, `lambda-stack.ts`, `observability-stack.ts`) has an adjacent test file (`*.test.ts`) in `infra/lib/` | Convention |
| Each test file includes at least one snapshot test (`toMatchSnapshot`) | Q3=A |
| Each test file includes at least one fine-grained `Template.hasResourceProperties` assertion per resource type | Q3=A |
| Snapshot files committed to git under `infra/lib/__snapshots__/` | Convention |
| Tests use the dev environment config (`devConfig`) — deterministic and predictable | Convention |
| Test file naming: `<stack>.test.ts` (NOT under `tests/` because `infra/` is a separate package tree per Application Design Q1=A) | Hexagonal layout |

---

## 7. Cross-Stack Reference Rules

| Reference | Mechanism | Rationale |
|---|---|---|
| Lambda → content-hashes table ARN | Direct prop (`contentHashTable.tableArn`) | Same app; typed |
| Lambda → workspace-config table ARN | Direct prop | Same |
| Observability → Lambda function | Direct prop | Same |
| Observability → DDB tables | Direct prop | Same |
| Lambda → State Machine ARN | env-var from `envConfig.stateMachineArn` (which is itself populated from `Fn.importValue` or hardcoded per-env) | Upstream stack outside this app |
| Lambda → Document bucket ARN | Same | Upstream |
| Observability → Alarms SNS topic | `StringParameter.valueFromLookup` from SSM | Managed externally |

---

## 8. Per-Environment Config Boundary

| Property | Differs per env? | Value source |
|---|---|---|
| `region`, `account` | Yes | Per-env config file |
| `pitrEnabledContentHashes` | Yes (false in dev) | Per-env config |
| `deletionProtectionEnabled` | Yes (false in dev) | Per-env config |
| `logLevel` | Yes (DEBUG in dev) | Per-env config |
| `powertoolsDev` | Yes (true in dev) | Per-env config |
| `powertoolsLoggerSampleRate` | Yes (1.0 dev / 0.1 staging / 0.01 prod) | Per-env config |
| `reservedConcurrentExecutions` | Yes (undefined in dev/staging, 100 in prod) | Per-env config |
| `logRetentionDays` | Yes (7/30/90) | Per-env config |
| `stateMachineArn`, `documentBucketArn` | Yes | Per-env config (hardcoded; upgrade to `Fn.importValue` when upstream stacks are wired) |
| `xraySamplingFixedRate` | Yes (0.5/0.1/0.05) | Per-env config |
| `alarmsSnsTopicSsmPath` | Yes | Per-env config |
| `lambdaInsightsEnabled` | Yes (false in dev) | Per-env config |
| Memory, timeout, architecture, billing mode, encryption | No | Stack code constants |

This boundary ensures that "rolling out a config change" never touches stack code — only the per-env config files.

---

## 9. PBT Compliance for U-4

Per Q6=A — **N/A with rationale**:

CDK code is declarative AWS resource specification, not algorithmic logic. There are no input/output relationships to property-test across an input space. The PBT-01 rule's verification criteria explicitly accept this determination: *"Components with no identifiable properties are explicitly marked as 'No PBT properties identified' with a brief rationale"*.

The equivalent coverage is provided by:
- **Snapshot tests** — detect any unintended drift
- **Fine-grained `Template.hasResourceProperties` assertions** — encode the spec verbatim
- **`cdk-nag`** — validates AWS best-practice rules at synth time

No PBT property catalogue is required for U-4.

---

## 10. SECURITY Compliance — Final Picture

This table combines U-2 + U-3 + U-4 SECURITY coverage. The whole service's SECURITY posture is summarised here.

| Rule | Coverage | Where |
|---|---|---|
| SECURITY-01 (encryption at rest + in transit) | ✅ Compliant | DDB SSE (AWS_MANAGED) in U-2 IaD; Lambda env vars KMS-encrypted by default; TLS for all SDK calls (default) |
| SECURITY-02 (network access logs) | ✅ N/A | No load balancers / API gateways / CDNs |
| SECURITY-03 (app-level logging) | ✅ Compliant | Powertools Logger + correlation ID + redaction (`LOG_EVENT=false`) in U-3 |
| SECURITY-04 (HTTP headers) | ✅ N/A | No HTML-serving endpoints |
| SECURITY-05 (input validation) | ✅ Compliant | Zod schema in `InputValidator` (U-3 application layer) |
| SECURITY-06 (least-privilege IAM) | ✅ Compliant | Per-resource per-action policies in U-3 IaD §2.4 → U-4 CDK |
| SECURITY-07 (restrictive network) | ✅ Justified deviation | Lambda outside VPC per U-1 IaD Q4=B with revisit trigger documented |
| SECURITY-08 (app-level access control) | ✅ Compliant | Object-level auth implicit via `workspaceId` partition key throughout |
| SECURITY-09 (hardening) | ✅ Compliant | Generic SendTaskFailure errors; DDB no public access; Lambda `POWERTOOLS_DEV=false` in prod |
| SECURITY-10 (supply chain) | ✅ Compliant | All `@aws-sdk/*` exact-pinned + `zod` exact-pinned + LocalStack image pinned |
| SECURITY-11 (secure design) | ✅ Compliant | Hexagonal layer separation; security-critical logic isolated (SlipsheetDecider, OLE2Parser); defense-in-depth in OLE2 parser |
| SECURITY-12 (auth/credentials) | ✅ N/A | Service-to-service IAM only; no user credentials |
| SECURITY-13 (data integrity) | ✅ Compliant | Result-typed plumbing; conditional DDB writes; CloudWatch Logs as audit trail |
| SECURITY-14 (alerting + monitoring) | ✅ Compliant | 10 alarms across U-2 + U-3 alarms, all routed via SNS topic with PagerDuty + Slack subscribers |
| SECURITY-15 (fail-safe defaults) | ✅ Compliant | Global try/catch + Result plumbing + fail-closed on unknown errors |

**No blocking findings across the entire service.** Two documented deviations:
1. SECURITY-07 (Lambda outside VPC) — cold-start savings; revisit when VPC-private resources are added
2. cdk-nag `AwsSolutions-L2` (no Lambda DLQ) — SFN task-retry serves the dead-letter role

---

## 11. Cross-Cutting Reminders

- **U-4 doesn't make infrastructure decisions** — those are all in U-2 + U-3 IaD docs. U-4's job is faithful translation to CDK.
- **Per-env values live in `infra/config/*.ts` only** — no environment-conditional logic anywhere else in CDK code.
- **Every cdk-nag warning must be addressed**: either fix the issue or add a documented suppression with reason.
- **Snapshot tests are committed** — re-running `vitest run --update` MUST happen as a deliberate change (the diff makes the change visible during code review).
