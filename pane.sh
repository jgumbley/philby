#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  pane.sh [--orient col|row] <pane-label> <command ...>
  pane.sh [--orient col|row] --shell <pane-label>
  pane.sh --kill [--force] <pane-id-or-label>

Each work unit is created as its own tmux window (named after the pane
label) so it shows on the bottom status bar and is navigable with the
prefix-less Ctrl-End / Ctrl-Home / Ctrl-Delete binds from philby.conf.

--orient is accepted for backward compatibility but is a no-op now
that panes are windows (every window is full-screen).

Kill mode resolves <pane-id-or-label> as an exact pane id (e.g. %13)
first, then as an exact pane title/label (e.g. philby-hal). It refuses
to kill the pane it is run from, and refuses to kill the operator
window (window index 1, named "philby"), unless --force is given.
EOF
  exit 1
}

kill_pane() {
  ref="$1"
  force="${2:-0}"
  if [ -z "${TMUX:-}" ]; then
    echo "pane kill must be run from inside an existing tmux session." >&2
    exit 1
  fi
  session_id="$(tmux display-message -p '#{session_id}')"
  target_pane=""
  while IFS= read -r line; do
    pid="${line%%::*}"
    rest="${line#*::}"
    title="${rest%%::*}"
    sid="${rest##*::}"
    [ "$sid" != "$session_id" ] && continue
    if [ "$pid" = "$ref" ] || [ "$title" = "$ref" ]; then
      target_pane="$pid"
      break
    fi
  done < <(tmux list-panes -a -F '#{pane_id}::#{pane_title}::#{session_id}' 2>/dev/null || true)
  if [ -z "$target_pane" ]; then
    echo "No pane matching \"$ref\" (by id or title) in this session." >&2
    exit 1
  fi
  if [ "$target_pane" = "${TMUX_PANE:-}" ] && [ "$force" -ne 1 ]; then
    echo "Refusing to kill the current pane ($target_pane). Re-run with --force to override." >&2
    exit 1
  fi
  # Refuse to close the operator window (index 1, named "philby") unless --force.
  # Killing its pane would kill the window and strand the operator session.
  op_win_index="$(tmux display-message -p -t "$target_pane" '#{window_index}' 2>/dev/null || true)"
  op_win_name="$(tmux display-message -p -t "$target_pane" '#{window_name}' 2>/dev/null || true)"
  if { [ "${op_win_index:-}" = "1" ] || [ "${op_win_name:-}" = "philby" ]; } && [ "$force" -ne 1 ]; then
    echo "Refusing to kill the operator window (index 1 / name \"philby\") via pane $target_pane. Re-run with --force to override." >&2
    exit 1
  fi
  tmux kill-pane -t "$target_pane"
  echo "Killed pane $target_pane (window closed; matched \"$ref\")."
}

use_shell=0
kill_mode=0
force=0
orient="${AGENT_PANE_ORIENT:-row}"
while [ $# -gt 0 ]; do
  case "$1" in
    --shell)
      use_shell=1
      shift
      ;;
    --orient)
      [ $# -ge 2 ] || usage
      orient="$2"
      shift 2
      ;;
    --kill)
      kill_mode=1
      shift
      ;;
    --force)
      force=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      usage
      ;;
    *)
      break
      ;;
  esac
done

# --orient is accepted for backward compatibility but is a no-op: every work
# unit is now its own full-screen window. Keep the col|row validation so old
# callers that pass --orient don't see a silent behavior change beyond the
# split becoming a new window.
case "$orient" in
  col|row) ;;
  *) echo "invalid --orient value \"$orient\" (expected col or row)" >&2; usage ;;
esac

if [ "$force" -eq 1 ] && [ "$kill_mode" -ne 1 ]; then
  usage
fi

if [ "$kill_mode" -eq 1 ]; then
  if [ $# -lt 1 ]; then
    usage
  fi
  kill_pane "$1" "$force"
  exit 0
fi

if [ $# -lt 1 ]; then
  usage
fi

pane_label="$1"
shift

if [ "$use_shell" -eq 1 ]; then
  set -- "${SHELL:-/bin/bash}"
fi

if [ $# -lt 1 ]; then
  usage
fi

cmd_display="$(printf ' %q' "$@")"
cmd_display="${cmd_display:1}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required to start an agent pane." >&2
  exit 1
fi

if [ -z "${TMUX:-}" ]; then
  echo "agent panes must be started from inside an existing tmux session." >&2
  exit 1
fi

repo_root="$(pwd)"
kitty_graphics=0
if command -v kitty >/dev/null 2>&1; then
  kitty_graphics=1
fi
# Orient / size are no longer used: every work unit is a full-screen window.

session_id="$(tmux display-message -p '#{session_id}')"
# Reuse an existing window/pane whose pane title already equals the label.
# Pane title is set by the runner via \033]2; so this matches prior behavior.
existing_pane="$(
  tmux list-panes -t "$session_id" -F '#{pane_id}::#{pane_title}' |
    awk -F '::' -v label="$pane_label" '$2 == label { print $1; exit }'
)"

if [ -n "$existing_pane" ]; then
  win_ref="$(tmux display-message -p -t "$existing_pane" '#{window_id}')"
  cat <<EOF
Window "$win_ref" (pane "$existing_pane") for "$pane_label" already exists in this session.
No new window was created.
Focus it with Ctrl-End / Ctrl-Home, or: tmux select-window -t $win_ref
To rerun in that pane: tmux send-keys -t $existing_pane C-m
To capture output: tmux capture-pane -pt $existing_pane
Close it when finished: Ctrl-Delete from inside it, or: tmux kill-window -t $win_ref
EOF
  exit 0
fi

runner_script="$(mktemp)"
cat > "$runner_script" <<'RUNNER_EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: tmux-agent-pane <pane-label> <command ...>" >&2
  exit 1
fi

pane_label="$1"
shift

export PHILBY_PANE_LABEL="$pane_label"
export PHILBY_REPO_ROOT="${PHILBY_REPO_ROOT:-$(pwd)}"
export PHILBY_KITTY_GRAPHICS="${PHILBY_KITTY_GRAPHICS:-0}"

cmd_display="$(printf ' %q' "$@")"
cmd_display="${cmd_display:1}"

printf '\033]2;%s\007' "$pane_label"

cat <<EOF
[agent:${pane_label}] Running ${cmd_display}

If prompted for credentials, type them directly in this pane.
Secrets typed here are not echoed and will not appear in captured output.

If PHILBY_KITTY_GRAPHICS=1, visual Make targets can display images through Kitty.

When the command finishes, reuse this same pane to rerun it:
- press Enter in this pane, or
- from another pane run: tmux send-keys -t "$TMUX_PANE" C-m

EOF

status=0
while :; do
  if "$@"; then
    status=0
  else
    status=$?
  fi

  cat <<EOF

[agent:${pane_label}] Command exited with status ${status}.
Reuse this pane by pressing Enter, or close it with Ctrl-b x.

EOF

  if [ ! -t 0 ]; then
    break
  fi
  read -r _ || break
done

exit "$status"
RUNNER_EOF

# Create the work unit as a new tmux window named after the label, so it
# appears on the bottom status bar and is navigable with the prefix-less
# Ctrl-* binds. -P -F '#{pane_id}' returns the single pane of the new window
# (every window has exactly one pane here), so capture/send-keys still work.
# The window is created after the current one and tmux selects it.
pane_id="$(tmux new-window -n "$pane_label" -c "$repo_root" -P -F '#{pane_id}' \
  env PHILBY_REPO_ROOT="$repo_root" PHILBY_KITTY_GRAPHICS="$kitty_graphics" bash "$runner_script" "$pane_label" "$@")"
rm -f "$runner_script"
win_ref="$(tmux display-message -p -t "$pane_id" '#{window_id}')"

cat <<EOF
Started tmux window "$win_ref" (pane "$pane_id"), named "$pane_label".
Command: $cmd_display
Navigate with Ctrl-End (next/new), Ctrl-Home (prev), Ctrl-Delete (close).
To capture output later: tmux capture-pane -pt $pane_id
To rerun in the same pane: tmux send-keys -t $pane_id C-m
EOF
