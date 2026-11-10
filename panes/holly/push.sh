#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST=holly.smeg
REMOTE_REPO=wip/philby
LOCAL_REPO="${PHILBY_ROOT:-/home/system/wip/philby}"

head_sha=$(git -C "$LOCAL_REPO" rev-parse HEAD)
bundle=$(mktemp /tmp/philby-push.XXXXXX.bundle)
trap 'rm -f "$bundle"' EXIT

git -C "$LOCAL_REPO" bundle create "$bundle" HEAD
scp -o BatchMode=yes -q "$bundle" "$REMOTE_HOST:/tmp/philby-push.bundle"

ssh -o BatchMode=yes "$REMOTE_HOST" "bash -s -- '$head_sha' 2>&1" 2>/dev/null <<'EOF' | awk '{print} /REFUSED|error|fatal/{bad=1} END{exit bad}'
set -euo pipefail
head_sha="$1"
cd "wip/philby"
git fetch /tmp/philby-push.bundle HEAD
if ! git merge-base --is-ancestor HEAD "$head_sha"; then
  echo "REFUSED: remote HEAD is not an ancestor of local HEAD $head_sha" >&2
  echo "Remote has divergent commits; reconcile manually." >&2
  exit 1
fi
git merge --ff-only "$head_sha"
rm -f /tmp/philby-push.bundle
echo "pushed $head_sha"
git log --oneline -1
EOF
