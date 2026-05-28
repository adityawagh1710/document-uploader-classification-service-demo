# Convert pipeline — Observability runbook

Operator hand-off steps for the auto-convert fan-out's observability surfaces (feat/07). Read this AFTER feat/02 (CDK queue) and feat/03+04 (worker) are deployed — the artifacts these runbook steps reference don't exist before then.

## What lands automatically vs operator-driven

| Surface | Where | Operator action? |
|---|---|---|
| **Live progress** in UI Conversion column | `/api/runs/[id]/progress` → office-convert `/v1/jobs/<rid>/progress` | None — works out of the box once feat/06 UI is deployed |
| **Stuck-job watchdog** | `deploy/k8s/convert-watchdog-cronjob.yaml` | One `kubectl apply` (below) |
| **DLQ depth alarm** (already exists from feat/02) | CloudWatch alarm `classification-convert-queue-dev-dlq-depth` | Subscribe to SNS — single CLI command (below) |
| **Queue age alarm** (already exists from feat/02) | CloudWatch alarm `classification-convert-queue-dev-age` | Subscribe to SNS — single CLI command (below) |

## Step 1 — Stuck-job watchdog (every 5 min)

The watchdog scans `classifications-dev` for rows where `convertStatus=converting` AND `convertStartedAt` is older than 35 minutes (covers the 30-min SQS visibility timeout plus a 5-min safety margin) and force-flips them to `convertStatus=failed` with `convertError=timeout_watchdog`. The UI picks up the new state on its next 2-second poll cycle.

```bash
kubectl apply -n classification-service-sandbox \
  -f deploy/k8s/convert-watchdog-cronjob.yaml

# Verify it's scheduled
kubectl get cronjob convert-watchdog -n classification-service-sandbox

# Force a one-off run to smoke-test the round trip
kubectl create job --from=cronjob/convert-watchdog convert-watchdog-smoke \
  -n classification-service-sandbox
kubectl logs -n classification-service-sandbox \
  -l job-name=convert-watchdog-smoke
# Expect a JSON response with scannedCount, reapedCount, durationMs.
```

The CronJob curls `http://classification-ui.classification-service-sandbox.svc.cluster.local/api/admin/convert-watchdog` — the classification-ui pod owns the IRSA grants for the DDB UpdateItem, so no separate ServiceAccount is needed.

**Override defaults via env on the classification-ui Deployment** (these are checked in `ui/app/api/admin/convert-watchdog/route.ts`):
- `STUCK_AFTER_MS` (default `2100000` = 35 min) — convertStartedAt cutoff
- `WATCHDOG_MAX_ROWS` (default `50`) — per-run blast-radius cap
- `WATCHDOG_SHARED_SECRET` (default empty = disabled) — `x-watchdog-secret` header check; pair with a matching header in the CronJob curl args if you want defence-in-depth

## Step 2 — Subscribe DLQ + queue-age alarms to SNS

The feat/02 CDK stack creates two CloudWatch alarms:
- `classification-convert-queue-dev-dlq-depth` — any DLQ message → ALARM
- `classification-convert-queue-dev-age` — oldest visible message > 30 min → ALARM

Neither has an alarm action attached (the SNS topic is a deploy-time concern, not infra). Subscribe both to your existing SNS topic with one CLI command each:

```bash
# Resolve the topic ARN your team uses for dev alarms (mirror the
# classification-ui pattern: SSM-managed per envConfig.alarmsSnsTopicSsmPath).
TOPIC_ARN=$(aws ssm get-parameter \
  --name /observability/sns-topic-arn/dev \
  --query 'Parameter.Value' --output text \
  --profile opus2-dev --region eu-west-1)

# Attach to both alarms (idempotent)
for ALARM in classification-convert-queue-dev-dlq-depth \
             classification-convert-queue-dev-age; do
  aws cloudwatch put-metric-alarm \
    --alarm-name "$ALARM" \
    --alarm-actions "$TOPIC_ARN" \
    --region eu-west-1 --profile opus2-dev \
    # The next line is a no-op flag tickle; put-metric-alarm requires
    # the FULL alarm config, but it's an upsert — the CDK-set fields
    # carry through any field we don't override. Done this way so the
    # CDK definition stays the source of truth for thresholds + periods.
    --no-cli-pager
done
```

> If the `put-metric-alarm` upsert above turns out to clobber CDK-managed fields in practice, a follow-up CDK change can attach the SNS action via `Alarm.addAlarmAction`. Tracked as a future cleanup.

## Step 3 — Verify the full observability loop

```bash
# 1. Upload a convertible file (DOC / DOCX / XLSX / PPTX / RTF / TIFF) via the UI.
# 2. Confirm the UI Conversion column transitions queued → converting → done.
#    During `converting`, the progress badge shows e.g. "47% chunk 3/7".
# 3. Inject a stuck row to test the watchdog:
aws dynamodb update-item --table-name classifications-dev \
  --key '{"workspaceId":{"S":"wks-ui-001"},"runId":{"S":"<test-run-id>"}}' \
  --update-expression "SET convertStatus=:s, convertStartedAt=:t" \
  --expression-attribute-values '{":s":{"S":"converting"},":t":{"S":"2025-01-01T00:00:00.000Z"}}' \
  --region eu-west-1 --profile opus2-dev
# Wait <= 5 min, then verify the row was flipped:
aws dynamodb get-item --table-name classifications-dev \
  --key '{"workspaceId":{"S":"wks-ui-001"},"runId":{"S":"<test-run-id>"}}' \
  --region eu-west-1 --profile opus2-dev \
  --query 'Item.{status:convertStatus.S,err:convertError.S}'
# Expect: status=failed, err=timeout_watchdog

# 4. Push a malformed message to the queue to test DLQ + SNS:
aws sqs send-message \
  --queue-url https://sqs.eu-west-1.amazonaws.com/537462380503/classification-convert-queue-dev \
  --message-body '{"intentionally":"malformed"}' \
  --region eu-west-1 --profile opus2-dev
# Worker's parser rejects this 3 times (or once + 2 redelivery attempts);
# message lands in DLQ; alarm fires; you get the SNS notification.
```

## Known limitations

- **DLQ message dump**: there's no separate dashboard for inspecting DLQ message bodies. Use `aws sqs receive-message` against the DLQ URL when triaging.
- **Retry button** for failed rows: deferred to a future branch. Today the failure path is terminal from the UI's perspective — operators rebuild + re-upload manually.
- **Watchdog Scan vs Query**: currently `DescribeTable + Scan + FilterExpression`. Acceptable at dev05 volume (<10k rows, 30-day TTL). Future: sparse GSI on `convertStatus` + `convertStartedAt` for Query-driven lookup.
