#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST=holly.smeg
REMOTE_REPO=wip/philby
LOCAL_REPO="${PHILBY_ROOT:-/home/system/wip/philby}"

bundle=$(mktemp /tmp/philby-pull.XXXXXX.bundle)
trap 'rm -f "$bundle"' EXIT

remote_sha=$(ssh -o BatchMode=yes "$REMOTE_HOST" "git -C '$REMOTE_REPO' rev-parse HEAD")
ssh -o BatchMode=yes "$REMOTE_HOST" "git -C '$REMOTE_REPO' bundle create /tmp/philby-pull.bundle HEAD" >/dev/null
scp -o BatchMode=yes -q "$REMOTE_HOST:/tmp/philby-pull.bundle" "$bundle"
ssh -o BatchMode=yes "$REMOTE_HOST" "rm -f /tmp/philby-pull.bundle"

local_sha=$(git -C "$LOCAL_REPO" rev-parse HEAD)
git -C "$LOCAL_REPO" fetch "$bundle" HEAD

if [ "$local_sha" = "$remote_sha" ]; then
  echo "up to date at $local_sha"
elif git -C "$LOCAL_REPO" merge-base --is-ancestor "$local_sha" "$remote_sha"; then
  git -C "$LOCAL_REPO" merge --ff-only "$remote_sha"
  echo "pulled $remote_sha"
  git -C "$LOCAL_REPO" log --oneline -1
elif git -C "$LOCAL_REPO" merge-base --is-ancestor "$remote_sha" "$local_sha"; then
  echo "up to date: local HEAD $local_sha is ahead of remote $remote_sha (publish to sync)"
else
  echo "REFUSED: local HEAD $local_sha and remote HEAD $remote_sha have diverged; reconcile manually" >&2
  exit 1
fi
