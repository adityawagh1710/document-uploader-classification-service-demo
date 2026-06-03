# Integrate your service into the classification pipeline

This repo orchestrates a document pipeline: an **ingestion router (BFF)** classifies an
upload, then hands the post-classify work to **stage services** (convert, archive/zip,
…) over **AWS Step Functions + SQS**, using a **task-token** round-trip. This guide is
for a team adding a **new stage** to that pipeline.

> **The one idea that makes this simple:** at runtime every stage is identical — a
> **queue + a Standard state machine + an `sqs:sendMessage.waitForTaskToken` round-trip**.
> The orchestrator only needs `category → queue → state machine → IAM`. It does **not**
> care where your code runs. So there are two equally-valid delivery models, and the
> **only** thing that differs between them is one field (`source.type`):
>
> | model | your code lives in | how it's wired | who does it like this today |
> |---|---|---|---|
> | **`unit`** | a `units/<id>/` dir **in this monorepo** | built from a local Dockerfile | `classification-service/worker` (convert) |
> | **`external`** | **your own repo** | referenced by image; interop by contract | `zip-extraction-service-demo` (archive) |

Pick whichever fits your team. Everything below works the same for both.

---

## 0. The inputs you need (all in this repo)

| Input | Where | What it gives you |
|---|---|---|
| **Wire contract** | `libs/pipeline-contracts/schema/pipeline-contracts.schema.json` (language-neutral) + `libs/pipeline-contracts/go/` (Go binding) | the message envelope your stage receives. Non-Go services model from the JSON Schema; Go services import the module. |
| **Participation contract** | `aidlc-docs/operations/sfn/SFN_Stage_Service_Shared_Contract.md` | the must-honour rules: S3 claim-check, envelope, **task-token signal**, idempotency, error classification, IRSA, naming — **+ a per-service Definition of Done**. |
| **Stage registry** | `units/classification-service/stages.registry.json` | the single source of truth you edit to register your stage. |
| **Generator** | `units/classification-service/scripts/gen-stages.mjs` | turns the registry into the LocalStack bootstrap + compose hints. |
| **Local harness** | `units/classification-service/docker-compose.yml` (`--profile pipeline`) | a full local pipeline (LocalStack S3/DDB/SQS/SFN) to test against. |

---

## 1. The runtime contract (what your stage must do)

Your service consumes one SQS message and signals the result back. Minimum viable stage:

1. **Receive** the claim off your queue. The body is the **envelope** + a `taskToken`:
   ```json
   { "pipelineExecutionId": "...", "tenantId": "...", "documentId": "...",
     "sourceBucket": "...", "sourceKey": "...", "correlationId": "...",
     "taskToken": "<opaque SFN token>" }
   ```
2. **Fetch** the input from S3 via the claim-check (`sourceBucket`/`sourceKey`) — never inline bytes.
3. **Do your work** (idempotently — `documentId` is the idempotency key; the same execution name may be retried).
4. **Signal** back on the `taskToken`:
   - success → `states:SendTaskSuccess` with a small JSON output (e.g. `{ "status": "SUCCESS", ... }`)
   - terminal failure → `states:SendTaskFailure` (`error`, `cause`)
   - **transient** failure → **don't signal**; let SQS redrive. The state machine's `TimeoutSeconds` (1800s) + `Catch` are the backstop.

That's the whole protocol. Full rules + the Definition-of-Done checklist: **`aidlc-docs/operations/sfn/SFN_Stage_Service_Shared_Contract.md`**.

---

## 2. Register your stage (edit one file, run one command)

Add an entry to `units/classification-service/stages.registry.json`. The `source` block is
the **only** part that differs between the two models:

```jsonc
{
  "name": "ocr",                       // your stage id
  "category": "ocr",                   // the classifier category that routes here
  "stateName": "Ocr",
  "stateMachine": "classification-ocr-pipeline",
  "failError": "OcrFailed",
  "routerEnv": "OCR_STATE_MACHINE_ARN", // env var the router reads for this SM's ARN
  "queue": { "name": "ocr-queue" },     // add "dlq"/"visibilityTimeout" if you need them
  "claim": ["pipelineExecutionId","tenantId","documentId","sourceBucket","sourceKey","correlationId"],

  // --- MODEL A: a unit in THIS monorepo ---
  "source": { "type": "unit", "path": "units/ocr-service", "image": "ocr-service:dev", "composeService": "ocr" }

  // --- MODEL B: your own repo, interop by contract ---
  // "source": { "type": "external", "repo": "ocr-service-demo", "image": "ocr:dev", "composeService": "ocr" }
}
```

Then regenerate the LocalStack infra (queues + state machine) — deterministic, committed:

```bash
cd units/classification-service
node scripts/gen-stages.mjs                 # writes the stage block into bootstrap-localstack.sh
node scripts/gen-stages.mjs --summary       # see the routing table
node scripts/gen-stages.mjs --compose ocr   # prints the compose service stanza for your model
node scripts/gen-stages.mjs --check         # CI drift gate (run in CI to keep registry ⇄ bootstrap in sync)
```

---

## 3. What gets wired — and by whom

| Surface | Auto from the registry? | What you do |
|---|---|---|
| **LocalStack queue + state machine** | ✅ generated into `bootstrap-localstack.sh` | nothing — just run the generator |
| **Compose service** | ⚙️ stanza printed by `--compose` | paste it under the `pipeline` profile (Model A builds from `path`; Model B uses your `image`) |
| **Router routing** | ⚠️ partly | set the `routerEnv` ARN in the router env. If your claim uses extra fields beyond the standard envelope, add a resolver branch (see `units/ingestion-service/ingestion-subgraph/graph/schema.resolvers.go` — convert/archive are the templates) |
| **dev05 (real AWS)** | 📋 planned | the CDK `ClassificationPipelineStack` + IRSA grants — see `aidlc-docs/operations/sfn/Dev05_SFN_Enablement_Plan.md`. Both models need: state-machine exec role `sqs:SendMessage`; your service IRSA `states:SendTaskSuccess/Failure`. |

> **Model B note:** your service code never enters this repo. Your branch *here* carries only
> the **classification-side wiring** (the registry entry + router env + the compose image
> reference). Your service + its Dockerfile + its IRSA live in your repo.

---

## 4. Test it locally (the real gate)

```bash
cd units/classification-service
docker compose --profile pipeline up        # LocalStack → bootstrap → classify → router → UI (:3000) + stages
# upload a document that classifies into your category, then:
aws --endpoint-url=http://localhost:4566 --region eu-west-1 stepfunctions list-executions \
  --state-machine-arn arn:aws:states:eu-west-1:000000000000:stateMachine:classification-<your>-pipeline \
  --query 'executions[].{name:name,status:status}' --output table
```
A `SUCCEEDED` execution = your stage received the claim, did the work, and signalled the
token. (If it `TIMED_OUT` after 30 min, your service didn't `SendTaskSuccess` — check the
`taskToken` handling.)

---

## 5. Contribution workflow

1. Branch off **`integration`**.
2. Build your service (Model A: a new `units/<id>/` here; Model B: in your own repo).
3. Add the registry entry + run the generator; add the compose stanza; set the router env.
4. Verify locally (§4) — execution `SUCCEEDED`.
5. PR back into `integration`. Tick the Definition of Done in the shared-contract doc.

Questions on the orchestration model: `aidlc-docs/operations/sfn/StepFunctions_Pipeline_Design.md`
(+ the `SFN_Pipeline_Flows.pdf` flowchart).
