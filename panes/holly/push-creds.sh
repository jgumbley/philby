#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST=holly.smeg
REMOTE_REPO=wip/philby
LOCAL_REPO="${PHILBY_ROOT:-/home/system/wip/philby}"

cd "$LOCAL_REPO"

patterns=('*.provider' '*.provider.disabled' '.env' '.env.*')

files=()
for pat in "${patterns[@]}"; do
  while IFS= read -r f; do
    case "$f" in
      *.example) continue ;;
    esac
    files+=("$f")
  done < <(compgen -G "$pat" || true)
done

if [ "${#files[@]}" -eq 0 ]; then
  echo "no local profiles/creds to push"
  exit 0
fi

archive=$(mktemp /tmp/philby-creds.XXXXXX.tgz)
trap 'rm -f "$archive"' EXIT
printf '%s\n' "${files[@]}" | tar -czf "$archive" -T -

ssh -o BatchMode=yes "$REMOTE_HOST" "tar -xzf - -C '$REMOTE_REPO'" < "$archive" 2>/dev/null

printf -v args '%q ' "${files[@]}"
ssh -o BatchMode=yes "$REMOTE_HOST" "bash -s -- $args 2>&1" 2>/dev/null <<'EOF' | awk '{print} /REFUSED|error|fatal/{bad=1} END{exit bad}'
set -euo pipefail
cd wip/philby
chmod 600 "$@"
printf 'pushed creds: %s\n' "$@"
EOF
