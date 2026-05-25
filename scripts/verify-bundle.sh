#!/usr/bin/env bash
# Bundle smoke check — Pattern P-3-3.
# Verifies the Lambda bundle (output of `cdk synth`) is loadable and ≤ 5 MB.
set -euo pipefail

BUNDLE_DIR="${1:-cdk.out}"
MAX_BYTES=5242880   # 5 MB

# Find handler.js in any asset directory (CDK creates asset.<hash>/)
BUNDLE_PATH=$(find "$BUNDLE_DIR" -name "handler.js" 2>/dev/null | head -n 1)

if [[ -z "$BUNDLE_PATH" ]]; then
  echo "::error::Bundle not found at $BUNDLE_DIR/**/handler.js"
  exit 1
fi

if [[ "$(uname)" == "Darwin" ]]; then
  BUNDLE_SIZE_BYTES=$(stat -f%z "$BUNDLE_PATH")
else
  BUNDLE_SIZE_BYTES=$(stat -c%s "$BUNDLE_PATH")
fi

if [[ "$BUNDLE_SIZE_BYTES" -gt "$MAX_BYTES" ]]; then
  echo "::error::Bundle size ${BUNDLE_SIZE_BYTES} > 5MB (${MAX_BYTES})"
  exit 1
fi

# Smoke check: load and verify handler export
node --input-type=module -e "
  const m = await import('$BUNDLE_PATH');
  if (typeof m.handler !== 'function') {
    console.error('handler export missing or not a function');
    process.exit(1);
  }
"

cat > bundle-report.json <<EOF
{
  "bundlePath": "$BUNDLE_PATH",
  "bundleSizeBytes": $BUNDLE_SIZE_BYTES,
  "handlerExported": true,
  "verifiedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "Bundle OK: ${BUNDLE_SIZE_BYTES} bytes ($((BUNDLE_SIZE_BYTES / 1024)) KB)"
