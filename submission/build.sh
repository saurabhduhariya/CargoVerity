#!/usr/bin/env bash
# Rebuilds submission/CargoVerity-handoff.zip from the two main documents plus the appendix.
# Edit submission/Technical-Design-Document.md and docs/deployment.md first, then run:
#   bash submission/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/appendix"

cp submission/Technical-Design-Document.md docs/deployment.md "$stage/"
for f in architecture ai-extraction ai-feasibility real-ai-smoke-test-report benchmark-and-success-targets \
         assumptions sample-data-manifest security-and-privacy operations deployment-runbook test-results; do
  cp "docs/$f.md" "$stage/appendix/"
done

# Replace long dashes with a plain hyphen in the bundled copies.
sed -i 's/ — / - /g; s/—/-/g; s/–/-/g' "$stage"/*.md "$stage"/appendix/*.md

if grep -rnE '\[FILL' "$stage"/*.md; then
  echo "Warning: the [FILL ...] placeholders above are still in the documents." >&2
fi

rm -f submission/CargoVerity-handoff.zip
(cd "$stage" && zip -qr "$OLDPWD/submission/CargoVerity-handoff.zip" .)
ls -l submission/CargoVerity-handoff.zip
