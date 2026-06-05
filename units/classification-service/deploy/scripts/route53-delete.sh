#!/usr/bin/env bash
# DELETEs the A-alias at $INGRESS_HOST. Must run BEFORE `helm uninstall`,
# because Route 53 needs the current AliasTarget DNSName/HostedZoneId in
# the change-batch payload — and that's gone once the Ingress is deleted.
#
# Required env (same as upsert):
#   AWS_PROFILE, AWS_REGION, ROUTE53_ZONE_ID, INGRESS_HOST
#   K8S_NAMESPACE (default classification-service-sandbox)
#   INGRESS_NAME  (default classification-ui)

set -euo pipefail

NAMESPACE="${K8S_NAMESPACE:-classification-service-sandbox}"
INGRESS="${INGRESS_NAME:-classification-ui}"
: "${AWS_PROFILE:?AWS_PROFILE must be set}"
: "${AWS_REGION:?AWS_REGION must be set}"
: "${ROUTE53_ZONE_ID:?ROUTE53_ZONE_ID must be set}"
: "${INGRESS_HOST:?INGRESS_HOST must be set}"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }

# If no record exists, exit clean (idempotent undeploy).
existing=$(AWS_PROFILE="$AWS_PROFILE" aws route53 list-resource-record-sets \
  --hosted-zone-id "$ROUTE53_ZONE_ID" \
  --query "ResourceRecordSets[?Name=='${INGRESS_HOST}.' && Type=='A'] | [0]" \
  --output json 2>/dev/null || echo "null")

if [[ "$existing" == "null" || -z "$existing" ]]; then
  log "no A record at $INGRESS_HOST — nothing to delete"
  exit 0
fi

alb_host=$(printf '%s' "$existing" | python3 -c \
  'import json,sys; r=json.load(sys.stdin); print(r["AliasTarget"]["DNSName"].rstrip("."))')
alb_zone=$(printf '%s' "$existing" | python3 -c \
  'import json,sys; r=json.load(sys.stdin); print(r["AliasTarget"]["HostedZoneId"])')

log "deleting A-alias $INGRESS_HOST → $alb_host (zone $alb_zone)"

change_batch=$(cat <<EOF
{
  "Comment": "classification-ui undeploy — DELETE alias",
  "Changes": [{
    "Action": "DELETE",
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
log "DELETE complete: $INGRESS_HOST"
