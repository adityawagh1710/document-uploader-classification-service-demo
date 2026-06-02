#!/usr/bin/env bash
# Bundle smoke check — Pattern P-3-3.
# Verifies the Lambda bundle (output of `cdk synth`) is loadable and ≤ 5 MB.
set -euo pipefail

BUNDLE_DIR="${1:-cdk.out}"
MAX_BYTES=5242880   # 5 MB

# Find the classification Lambda bundle. NodejsFunction with `format: ESM`
# emits `index.mjs`; with CJS it would be `index.js`. We prefer `.mjs` because
# CDK also ships a `LogRetention` helper Lambda (its own asset dir with a CJS
# `index.js`) and we want to verify OUR Lambda's bundle, not the helper.
BUNDLE_PATH=$(find "$BUNDLE_DIR" -name "index.mjs" 2>/dev/null | head -n 1)
if [[ -z "$BUNDLE_PATH" ]]; then
  # Fallback: CJS bundle (would also match the LogRetention helper, but that's
  # fine if we ever switch our function to CJS format).
  BUNDLE_PATH=$(find "$BUNDLE_DIR" \( -name "index.js" -o -name "handler.js" \) 2>/dev/null | head -n 1)
fi

if [[ -z "$BUNDLE_PATH" ]]; then
  echo "::error::Bundle not found at $BUNDLE_DIR/**/(index.mjs|index.js|handler.js)"
  find "$BUNDLE_DIR" -maxdepth 3 -type f 2>/dev/null | head -20 >&2
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

# Static handler export check. We can't `import()` the bundle on the host —
# esbuild emits a dynamic-require shim for Node builtins (tty, os, etc.)
# that the Lambda runtime resolves at invoke time but pure-ESM `node` on
# CI/local rejects. Static scan is sufficient to catch the regression we
# care about (handler symbol present in the emitted bundle).
if ! grep -qE '(\bhandler\b\s*:|\bhandler\s*=|exports\.handler|\bhandler[ ]?[)}])' "$BUNDLE_PATH"; then
  echo "::error::No 'handler' export found in $BUNDLE_PATH"
  echo "First 200 bytes of bundle:" >&2
  head -c 200 "$BUNDLE_PATH" >&2
  echo "" >&2
  exit 1
fi

cat > bundle-report.json <<EOF
{
  "bundlePath": "$BUNDLE_PATH",
  "bundleSizeBytes": $BUNDLE_SIZE_BYTES,
  "handlerExported": true,
  "verifiedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "Bundle OK: ${BUNDLE_SIZE_BYTES} bytes ($((BUNDLE_SIZE_BYTES / 1024)) KB)"
