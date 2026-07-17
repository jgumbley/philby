#!/bin/sh
# Philby GLM cleanup: tear down the whole operator environment cleanly.
#
# What it does, in order:
#   1. Kill the philby-owned tmux server (socket `philby-glm`). This closes
#      every window/pane in the `philby` session and SIGHUPs the supervised
#      processes attached to them — the pi agent, subagents, shell panes.
#   2. Stop the `logseq-web` docker container, which holds the ttyd server
#      and the python textual viewer. `docker stop` ends both gracefully.
#      Reversible: re-run `make web` (in logseq_jg) to restart it.
#   3. Sweep for orphan host processes that escaped the tmux teardown, scoped
#      to this operator stack's command lines (never a blanket `pkill`):
#        - `common.mk pi-agent` / `philby-glm.*pi-agent`  (operator agent)
#        - `viewer/tui.py`                                (textual viewer)
#        - `ttyd-mobile-entrypoint`                      (ttyd bootstrap)
#        - bare `ttyd` not managed by docker             (rare host-direct runs)
#      TERM first, then KILL after a short grace period.
#
# If run from INSIDE the philby tmux session, this script self-detaches
# (re-execs under nohup) before killing the server, so the teardown completes
# after the calling pane is gone. The log is written to /tmp/philby-cleanup.log.
set -u

SOCKET="${PHILBY_TMUX_SOCKET:-philby-glm}"
CONTAINER="${LOGSEQ_WEB_CONTAINER:-logseq-web}"
LOG="${PHILBY_CLEANUP_LOG:-/tmp/philby-cleanup.log}"

# Self-detach if invoked from inside the philby tmux session: killing the
# server would SIGHUP this script's pane mid-run. Re-exec detached so the
# teardown completes (reparented to init), and tell the caller where the log is.
if [ -n "${TMUX:-}" ] && tmux -L "$SOCKET" info >/dev/null 2>&1; then
    if [ "${PHILBY_CLEANUP_DETACHED:-0}" != "1" ]; then
        PHILBY_CLEANUP_DETACHED=1 nohup sh "$0" "$@" </dev/null >"$LOG" 2>&1 &
        printf 'cleanup: detached (killing the tmux server would kill this pane).\n'
        printf 'cleanup: log -> %s\n' "$LOG"
        exit 0
    fi
fi

printf '== philby-glm cleanup ==\n'

# 1. Tear down the philby-owned tmux server.
if tmux -L "$SOCKET" info >/dev/null 2>&1; then
    printf -- '- killing tmux server on socket %s\n' "$SOCKET"
    tmux -L "$SOCKET" kill-server 2>/dev/null || true
else
    printf -- '- no tmux server on socket %s (already gone)\n' "$SOCKET"
fi

# 2. Stop the logseq-web container (ttyd + textual viewer).
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
    printf -- '- stopping docker container %s\n' "$CONTAINER"
    docker stop "$CONTAINER" >/dev/null 2>&1 || true
else
    printf -- '- docker container %s not running (skipping)\n' "$CONTAINER"
fi

# 3. Sweep for orphan host processes that escaped the tmux teardown.
#    Scoped patterns; TERM first, KILL after a grace period.
patterns='common\.mk pi-agent philby-glm.*pi-agent viewer/tui\.py ttyd-mobile-entrypoint'
swept=0
for pat in $patterns; do
    if pgrep -f "$pat" >/dev/null 2>&1; then
        printf -- '- killing orphan processes matching: %s\n' "$pat"
        pkill -TERM -f "$pat" 2>/dev/null || true
        swept=1
    fi
done
if pgrep -x ttyd >/dev/null 2>&1; then
    printf -- '- killing orphan host ttyd process(es)\n'
    pkill -TERM -x ttyd 2>/dev/null || true
    swept=1
fi
if [ "$swept" = "1" ]; then
    sleep 1
    for pat in $patterns; do
        pkill -KILL -f "$pat" 2>/dev/null || true
    done
    pkill -KILL -x ttyd 2>/dev/null || true
fi

printf '== cleanup done ==\n'
