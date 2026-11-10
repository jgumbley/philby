#!/bin/bash
set -euo pipefail

HOST="${HOLLY_HOST:-system@holly.smeg}"

if [ "$#" -gt 0 ]; then
  exec ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "$@"
fi

cmd="$(cat)"
if [ -z "$cmd" ]; then
  echo "usage: make holly CMD='hostname; uptime'" >&2
  echo "   or: echo 'command' | make holly" >&2
  exit 2
fi

exec ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "$cmd"
