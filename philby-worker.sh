#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
spec_targets="${PHILBY_SPEC_TARGETS:-}"

if [ -z "$spec_targets" ]; then
  echo "PHILBY_SPEC_TARGETS is required" >&2
  exit 2
fi

cd "$repo_root"

echo "[philby-worker] running spec targets: $spec_targets"
for target in $spec_targets; do
  make "$target"
done
