#!/usr/bin/env node
// Generate the LocalStack stage-infra block (SQS queues + Step Functions state
// machines) into bootstrap-localstack.sh from stages.registry.json — the single
// source of truth. Runtime is identical for both delivery models; `source.type`
// (unit | external) only affects compose/build wiring (see --compose).
//
// Usage:
//   node scripts/gen-stages.mjs            # regenerate the block in bootstrap-localstack.sh
//   node scripts/gen-stages.mjs --check    # CI drift gate: exit 1 if regeneration would change it
//   node scripts/gen-stages.mjs --summary  # print the routing table (category → SM → queue → source)
//   node scripts/gen-stages.mjs --compose <stage>   # print a compose service stanza for a stage
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = join(here, "..", "stages.registry.json");
const bootstrapPath = join(here, "bootstrap-localstack.sh");
const BEGIN = "# >>> BEGIN generated: stage queues + state machines (scripts/gen-stages.mjs from stages.registry.json) >>>";
const END = "# <<< END generated <<<";

const reg = JSON.parse(readFileSync(registryPath, "utf8"));
const d = reg.defaults ?? {};
const account = d.account ?? "000000000000";
const region = d.region ?? "eu-west-1";
const role = d.execRoleArn ?? `arn:aws:iam::${account}:role/sfn-exec`;

function stageBlock(s) {
  const q = s.queue;
  const timeout = s.timeoutSeconds ?? d.timeoutSeconds ?? 1800;
  const lines = [];
  lines.push(`# ---- stage: ${s.name} (category=${s.category}, source=${s.source?.type ?? "?"}) ----`);
  // queue(s)
  let attrs = "";
  if (q.dlq) {
    lines.push(`aws --endpoint-url="$ENDPOINT" sqs create-queue --queue-name "${q.dlq.name}" 2>/dev/null || true`);
    const dlqArn = `arn:aws:sqs:${region}:${account}:${q.dlq.name}`;
    lines.push(`__DLQ_ARN_${s.name}="${dlqArn}"`);
    const parts = [];
    if (q.visibilityTimeout) parts.push(`\\"VisibilityTimeout\\":\\"${q.visibilityTimeout}\\"`);
    if (q.retentionPeriod) parts.push(`\\"MessageRetentionPeriod\\":\\"${q.retentionPeriod}\\"`);
    parts.push(`\\"RedrivePolicy\\":\\"{\\\\\\"deadLetterTargetArn\\\\\\":\\\\\\"$__DLQ_ARN_${s.name}\\\\\\",\\\\\\"maxReceiveCount\\\\\\":\\\\\\"${q.dlq.maxReceiveCount ?? 3}\\\\\\"}\\"`);
    attrs = ` --attributes "{${parts.join(",")}}"`;
  } else if (q.visibilityTimeout || q.retentionPeriod) {
    const parts = [];
    if (q.visibilityTimeout) parts.push(`\\"VisibilityTimeout\\":\\"${q.visibilityTimeout}\\"`);
    if (q.retentionPeriod) parts.push(`\\"MessageRetentionPeriod\\":\\"${q.retentionPeriod}\\"`);
    attrs = ` --attributes "{${parts.join(",")}}"`;
  }
  lines.push(`aws --endpoint-url="$ENDPOINT" sqs create-queue --queue-name "${q.name}"${attrs} 2>/dev/null || true`);
  // ASL (unquoted heredoc: $ENDPOINT expands; \$ / \$\$ are JSONPath left literal)
  const body = s.claim
    .map((f) => `          "${f}.\\$":"\\$.${f}",`)
    .join("\n");
  const asl = [
    `cat > /tmp/stage-${s.name}.asl.json <<JSON`,
    `{ "Comment":"${s.name} stage via sqs waitForTaskToken (generated from stages.registry.json)", "StartAt":"${s.stateName}",`,
    `  "States":{`,
    `    "${s.stateName}":{ "Type":"Task",`,
    `      "Resource":"arn:aws:states:::sqs:sendMessage.waitForTaskToken",`,
    `      "Parameters":{ "QueueUrl":"$ENDPOINT/${account}/${q.name}",`,
    `        "MessageBody":{`,
    body,
    `          "taskToken.\\$":"\\$\\$.Task.Token" } },`,
    `      "TimeoutSeconds":${timeout},`,
    `      "Catch":[{ "ErrorEquals":["States.ALL"], "Next":"Failed" }], "End":true },`,
    `    "Failed":{ "Type":"Fail", "Error":"${s.failError}" } } }`,
    `JSON`,
  ].join("\n");
  lines.push(asl);
  lines.push(
    `aws --endpoint-url="$ENDPOINT" stepfunctions create-state-machine \\`,
    `  --name "${s.stateMachine}" \\`,
    `  --role-arn "${role}" \\`,
    `  --definition file:///tmp/stage-${s.name}.asl.json 2>/dev/null || true`,
  );
  return lines.join("\n");
}

function generatedRegion() {
  const blocks = reg.stages.map(stageBlock).join("\n\n");
  return [
    BEGIN,
    "# AUTO-GENERATED — do not edit by hand. Edit stages.registry.json then run:",
    "#   node scripts/gen-stages.mjs",
    "",
    blocks,
    END,
  ].join("\n");
}

function rewrite() {
  const sh = readFileSync(bootstrapPath, "utf8");
  const b = sh.indexOf(BEGIN);
  const e = sh.indexOf(END);
  if (b === -1 || e === -1) {
    console.error(`ERROR: markers not found in ${bootstrapPath}. Add:\n${BEGIN}\n${END}`);
    process.exit(2);
  }
  return sh.slice(0, b) + generatedRegion() + sh.slice(e + END.length);
}

const arg = process.argv[2];
if (arg === "--summary") {
  console.log("stage     category   stateMachine                        queue                          source");
  console.log("-".repeat(110));
  for (const s of reg.stages) {
    console.log(
      [s.name.padEnd(9), s.category.padEnd(10), s.stateMachine.padEnd(35), s.queue.name.padEnd(30),
       `${s.source?.type}${s.source?.repo ? " (" + s.source.repo + ")" : ""}`].join(" "),
    );
  }
} else if (arg === "--compose") {
  const name = process.argv[3];
  const s = reg.stages.find((x) => x.name === name);
  if (!s) { console.error(`no stage "${name}" in registry`); process.exit(2); }
  const svc = s.source.composeService ?? s.name;
  console.log(`# compose stanza for stage "${s.name}" (source: ${s.source.type})`);
  console.log(`  ${svc}:`);
  if (s.source.type === "unit") {
    console.log(`    build: { context: ../.., dockerfile: ${s.source.path}/Dockerfile }`);
  } else {
    console.log(`    image: ${s.source.image}`);
    console.log(`    pull_policy: never   # built in the sibling repo (${s.source.repo}); not pushed to a registry`);
  }
  console.log(`    profiles: ["pipeline"]`);
  console.log(`    depends_on: { localstack: { condition: service_healthy } }`);
  console.log(`    # env: point AWS_ENDPOINT_URL at localstack; consume "${s.queue.name}"; signal the taskToken back`);
} else {
  const next = rewrite();
  const cur = readFileSync(bootstrapPath, "utf8");
  if (arg === "--check") {
    if (next !== cur) {
      console.error("DRIFT: bootstrap-localstack.sh is out of sync with stages.registry.json. Run: node scripts/gen-stages.mjs");
      process.exit(1);
    }
    console.log("OK: bootstrap-localstack.sh is in sync with stages.registry.json");
  } else {
    writeFileSync(bootstrapPath, next);
    console.log(`Wrote stage infra for ${reg.stages.length} stage(s) into bootstrap-localstack.sh`);
  }
}
