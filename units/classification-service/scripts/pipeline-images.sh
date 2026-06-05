#!/usr/bin/env bash
#
# pipeline-images.sh — bridge sibling-repo images into the classification
# pipeline's OWN image namespace.
#
# Why this exists
# ---------------
# The `--profile pipeline` stack in ../docker-compose.yml runs two downstream
# services that are BUILT and OWNED by sibling repos:
#   - office-convert  (built in ../../../office-conversion-service-demo)
#   - zip-extraction  (built in ../../../zip-extraction-service-demo)
#
# To keep every locally-built image name unique per repo (no two repos ever
# build or reference the same tag), this repo NEVER references a sibling's tag
# directly in its compose file. Instead the compose services point at
# classification-owned aliases, and this script is the single, explicit place
# the cross-repo coupling lives — it retags (a cheap, copy-free alias of the
# same image ID) the sibling images into the `classification-pipeline/*`
# namespace.
#
# Prerequisite: build the sibling images first, in their own repos:
#   (office) cd ../../../office-conversion-service-demo && make build-go    # -> office-convert:go
#   (zip)    cd ../../../zip-extraction-service-demo/services/zip-extraction \
#              && docker compose -f deploy/docker-compose.yml build zip-extraction  # -> zip-extraction-service:dev
#
# Then:
#   ./scripts/pipeline-images.sh
#   docker compose --profile pipeline up
#
# Override the SRC vars if your siblings use different local tags.
set -euo pipefail

# Sibling-owned source tags (the ONLY place classification names them).
OFFICE_CONVERT_SRC_IMAGE="${OFFICE_CONVERT_SRC_IMAGE:-office-convert:go}"
ZIP_EXTRACTION_SRC_IMAGE="${ZIP_EXTRACTION_SRC_IMAGE:-zip-extraction-service:dev}"

# Classification-owned destination aliases (match docker-compose.yml defaults).
OFFICE_CONVERT_DST_IMAGE="${PIPELINE_OFFICE_CONVERT_IMAGE:-classification-pipeline/office-convert:local}"
ZIP_EXTRACTION_DST_IMAGE="${PIPELINE_ZIP_EXTRACTION_IMAGE:-classification-pipeline/zip-extraction:local}"

retag() {
  local src="$1" dst="$2" repo="$3"
  if ! docker image inspect "$src" >/dev/null 2>&1; then
    echo "ERROR: source image '$src' not found locally." >&2
    echo "       Build it first in ../../../$repo (see that repo's README), then re-run." >&2
    return 1
  fi
  docker tag "$src" "$dst"
  echo "  retagged  $src  ->  $dst"
}

echo "==> Bridging sibling images into the classification-pipeline namespace"
retag "$OFFICE_CONVERT_SRC_IMAGE" "$OFFICE_CONVERT_DST_IMAGE" "office-conversion-service-demo"
retag "$ZIP_EXTRACTION_SRC_IMAGE" "$ZIP_EXTRACTION_DST_IMAGE" "zip-extraction-service-demo"
echo "==> Done. Now run:  docker compose --profile pipeline up"
