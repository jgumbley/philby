#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
spec_targets="${PHILBY_SPEC_TARGETS:-}"

if [ -z "$spec_targets" ]; then
  echo "PHILBY_SPEC_TARGETS is required" >&2
  exit 2
fi

# Stub spawner: hand off to the worker with the same environment.
exec bash "$repo_root/philby-worker.sh"
