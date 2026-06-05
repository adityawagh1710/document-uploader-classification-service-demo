#!/usr/bin/env bash
# UPSERTs an A-alias record at $INGRESS_HOST pointing at the live ALB
# allocated by the classification-ui Ingress. Idempotent.
#
# Runs as the last step of `make deploy-dev` (when ingress is enabled).
# Polls the Ingress for its ADDRESS, resolves the ALB's canonical hosted
# zone ID, then submits a Route 53 change-batch.
#
# Required env:
#   AWS_PROFILE         (e.g. opus2-dev)
#   AWS_REGION          (e.g. eu-west-1)
#   ROUTE53_ZONE_ID     (the hosted zone holding $INGRESS_HOST)
#   INGRESS_HOST        (the FQDN to upsert, e.g. classification-ui.dev.opus2.example.com)
#   K8S_NAMESPACE       (default: classification-service-sandbox)
#   INGRESS_NAME        (default: classification-ui)

set -euo pipefail

NAMESPACE="${K8S_NAMESPACE:-classification-service-sandbox}"
INGRESS="${INGRESS_NAME:-classification-ui}"
: "${AWS_PROFILE:?AWS_PROFILE must be set}"
: "${AWS_REGION:?AWS_REGION must be set}"
: "${ROUTE53_ZONE_ID:?ROUTE53_ZONE_ID must be set}"
: "${INGRESS_HOST:?INGRESS_HOST must be set}"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }

log "waiting for Ingress $NAMESPACE/$INGRESS to expose ALB hostname..."
alb_host=""
for _ in $(seq 1 60); do
  alb_host=$(kubectl -n "$NAMESPACE" get ingress "$INGRESS" \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
  if [[ -n "$alb_host" ]]; then break; fi
  sleep 5
done
if [[ -z "$alb_host" ]]; then
  log "Ingress did not expose a hostname within 5 minutes — aborting"
  exit 2
fi
log "ALB hostname: $alb_host"

# Resolve the ALB's CanonicalHostedZoneId by ARN lookup on the LB whose DNS
# name matches. ALBs are regional — this hits the same region as our cluster.
alb_zone=$(AWS_PROFILE="$AWS_PROFILE" aws elbv2 describe-load-balancers \
  --region "$AWS_REGION" \
  --query "LoadBalancers[?DNSName=='${alb_host}'].CanonicalHostedZoneId | [0]" \
  --output text)
if [[ -z "$alb_zone" || "$alb_zone" == "None" ]]; then
  log "could not resolve ALB CanonicalHostedZoneId for $alb_host"
  exit 3
fi
log "ALB hosted zone: $alb_zone"

change_batch=$(cat <<EOF
{
  "Comment": "classification-ui deploy — UPSERT alias to $alb_host",
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "$INGRESS_HOST",
      "Type": "A",
      "AliasTarget": {
        "HostedZoneId": "$alb_zone",
        "DNSName": "$alb_host",
        "EvaluateTargetHealth": false
      }
    }
  }]
}
EOF
)

change_id=$(AWS_PROFILE="$AWS_PROFILE" aws route53 change-resource-record-sets \
  --hosted-zone-id "$ROUTE53_ZONE_ID" \
  --change-batch "$change_batch" \
  --query 'ChangeInfo.Id' --output text)
log "Route 53 change submitted: $change_id"
log "UPSERT complete: $INGRESS_HOST → $alb_host"
