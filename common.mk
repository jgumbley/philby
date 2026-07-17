SHELL := /bin/bash

.PHONY: help run tmux-start tmux-entry digest digest-raw ingest pane pi pi-agent pi-check models openrouter-models subagent codex ask reason research twitter ascii-text generate-ascii-text image-demo image-show lg window respawn test clean cleanup

export PI_CODING_AGENT_DIR := $(CURDIR)/.pi/agent
export PI_CODING_AGENT_SESSION_DIR := $(PI_CODING_AGENT_DIR)/sessions

PI_PROVIDER ?= openrouter
PI_MODEL_ID ?= moonshotai/kimi-k3
PI_MODEL ?= $(PI_PROVIDER)/$(PI_MODEL_ID)
PI_MODEL_SEARCH ?= $(PI_MODEL)
PI_THINKING ?= max
PI_GLM_MODEL ?= openrouter/z-ai/glm-5.2
PI_GLM_THINKING ?= high
PI_MODELS ?= $(PI_MODEL):$(PI_THINKING),$(PI_GLM_MODEL):$(PI_GLM_THINKING)
PI_SESSION_NAME ?= philby-operator
PI_SYSTEM_PROMPT ?= system.md
PI_PANE_LABEL ?= philby
PI_ENTRYPOINT ?= pi
PHILBY_TMUX_SOCKET ?= philby-glm
PHILBY_TMUX_SESSION ?= philby
PHILBY_TMUX_WINDOW ?= philby
PHILBY_TMUX_CONF ?= $(CURDIR)/tmux/philby.conf
PI_ARTIFACT_DIR ?= $(CURDIR)/.pi/artifacts
IMAGE ?= $(PI_ARTIFACT_DIR)/operator-demo.png
TEXT ?= here

CODEX_PROMPT ?= $(if $(PROMPT),$(PROMPT),)
CODEX_MODEL ?=
CODEX_SANDBOX ?= read-only
export CODEX_PROMPT

# --- Delegation / model routing -------------------------------------------------
# Each target runs a fresh, ephemeral Pi session (no tools, no project context,
# no memory of this one) and prints the delegate's answer on stdout.
# Override any model with the matching *_MODEL variable, e.g.:
#   make research RESEARCH_MODEL=perplexity/sonar
ASK_MODEL ?= $(PI_MODEL)
ASK_THINKING ?= $(PI_THINKING)
# Disabled gpt-5.5-pro as the reason default: too expensive. Use the cheaper
# non-pro gpt-5.5 reasoning model instead. Override with:
#   make reason REASON_MODEL=openrouter/openai/gpt-5.5-pro
REASON_MODEL ?= openrouter/openai/gpt-5.5
REASON_THINKING ?= xhigh
# OpenRouter ":online" suffix enables server-side web search; no separate key.
# Gemini 3.1 Pro + :online provides the web-grounded research route.
RESEARCH_MODEL ?= openrouter/google/gemini-3.1-pro-preview:online
RESEARCH_THINKING ?= low
TWITTER_MODEL ?= openrouter/x-ai/grok-4.3:online
TWITTER_THINKING ?= off
SUBAGENT_NAME ?= $(if $(name),$(name),subagent)
SUBAGENT_PROMPT ?= $(if $(prompt),$(prompt),Read Makefile, run make digest, and wait for the operator's task.)

define success
	@pane_ref=""; \
	if [ -n "$${TMUX_PANE:-}" ] && command -v tmux >/dev/null 2>&1; then \
		pane_ref="$$(tmux display-message -p -t "$${TMUX_PANE}" '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || true)"; \
	fi; \
	pi_pid=""; \
	pi_etime=""; \
	p="$$$$"; \
	while [ "$$p" -gt 1 ] 2>/dev/null; do \
		comm="$$(ps -o comm= -p "$$p" 2>/dev/null || true)"; \
		if [ "$$comm" = "pi" ]; then \
			pi_pid="$$p"; \
			pi_etime="$$(ps -o etime= -p "$$p" 2>/dev/null | tr -d ' ' || true)"; \
			break; \
		fi; \
		next="$$(ps -o ppid= -p "$$p" 2>/dev/null | tr -d ' ' || true)"; \
		[ -z "$$next" ] && break; \
		p="$$next"; \
	done; \
	loc="$${pane_ref:-}"; \
	[ -n "$$loc" ] || loc="$${TMUX_PANE:-none}"; \
	pi_context=""; \
	if [ -n "$$pi_pid" ]; then \
		pi_context=" pi_pid=$$pi_pid pi_elapsed=$${pi_etime:-?}"; \
	fi; \
	printf '\033[32m%s completed [OK]\033[0m pane=%s%s\n' "$(@)" "$$loc" "$$pi_context"
endef

help:
	@printf '%s\n\n' 'philby says:'
	@$(MAKE) --no-print-directory -f common.mk ascii-text TEXT="just run make"

run: PI_ENTRYPOINT = run
run: pi

tmux-start:
	@set -euo pipefail; \
	command -v tmux >/dev/null; \
	test -f "$(PHILBY_TMUX_CONF)"; \
	entrypoint="$(PI_ENTRYPOINT)"; \
	if [ "$$entrypoint" = "make" ]; then \
		entrypoint_cmd="make"; \
	else \
		entrypoint_cmd="make $$entrypoint"; \
	fi; \
	printf 'philby says: starting tmux session "%s" with %s\n' "$(PHILBY_TMUX_SESSION)" "$(PHILBY_TMUX_CONF)"; \
	printf 'philby says: attaching now; detach with Ctrl-b d\n'; \
	exec tmux -L "$(PHILBY_TMUX_SOCKET)" -f "$(PHILBY_TMUX_CONF)" new-session -A \
		-s "$(PHILBY_TMUX_SESSION)" \
		-n "$(PHILBY_TMUX_WINDOW)" \
		-c "$(CURDIR)" \
		"$(MAKE) --no-print-directory -f common.mk tmux-entry PI_ENTRYPOINT=$$entrypoint"

tmux-entry:
	@set -u; \
	if command -v tmux >/dev/null 2>&1 && [ -n "$${TMUX:-}" ]; then \
		tmux rename-window "$(PHILBY_TMUX_WINDOW)" 2>/dev/null || true; \
		tmux select-pane -T "$(PI_PANE_LABEL)" 2>/dev/null || true; \
	fi; \
	printf '\033]2;%s\007' "$(PI_PANE_LABEL)"; \
	status=0; \
	$(MAKE) --no-print-directory -f common.mk pi-agent || status=$$?; \
	if [ "$$status" -ne 0 ]; then \
		printf '\nphilby says: agent startup exited with status %s\n' "$$status" >&2; \
	fi; \
	printf '\nphilby says: operator shell is ready in %s\n' "$(CURDIR)"; \
	exec "$${SHELL:-/bin/bash}" -l

digest-raw:
	@echo "=== Project Digest ==="
	@for file in $$(find . \
		-path "./.git" -prune -o \
		-path "./.venv" -prune -o \
		-path "./.uv-cache" -prune -o \
		-path "./.pi/agent/git" -prune -o \
		-path "./.pi/agent/npm" -prune -o \
		-path "./.pi/agent/sessions" -prune -o \
		-path "./.pi/agent/auth.json" -prune -o \
		-path "./.pi/git" -prune -o \
		-path "./.pi/npm" -prune -o \
		-type f \( \
			-name "*.md" -o \
			-name "*.conf" -o \
			-name "*.mk" -o \
			-name "*.py" -o \
			-name "*.sh" -o \
			-name "*.ts" -o \
			-name "*.json" -o \
			-name "Makefile" -o \
			-name ".gitignore" -o \
			-name ".env.example" \
		\) -print | sort); do \
		echo ""; \
		echo "--- $$file ---"; \
		cat "$$file"; \
	done

digest:
	@$(MAKE) --no-print-directory -f common.mk digest-raw
	$(call success)

ingest:
	@digest_output="$$( $(MAKE) --no-print-directory -f common.mk digest-raw )" && \
	payload="$$(printf '%s\n' "$$digest_output" | base64 | tr -d '\n')" && \
	if [ -n "$${TMUX:-}" ]; then \
		printf '\033Ptmux;\033\033]52;c;%s\a\033\\' "$$payload"; \
	else \
		printf '\033]52;c;%s\a' "$$payload"; \
	fi
	$(call success)

pane:
	@set -euo pipefail; \
	cmd_target="$(target)"; \
	kill_ref="$(kill)"; \
	orient="$(orient)"; \
	case "$$orient" in col|row) orient_arg="--orient $$orient";; *) orient_arg="";; esac; \
	if [ -n "$$kill_ref" ]; then \
		bash ./pane.sh --kill "$$kill_ref"; \
	elif [ -z "$$cmd_target" ]; then \
		bash ./pane.sh $$orient_arg --shell "philby-shell"; \
	else \
		bash ./pane.sh $$orient_arg "philby-$$cmd_target" $(MAKE) --no-print-directory "$$cmd_target"; \
	fi

pi:
	@set -euo pipefail; \
	entrypoint="$(PI_ENTRYPOINT)"; \
	if [ "$$entrypoint" = "make" ]; then \
		entrypoint_cmd="make"; \
	else \
		entrypoint_cmd="make $$entrypoint"; \
	fi; \
	if [ -z "$${TMUX:-}" ]; then \
		$(MAKE) --no-print-directory -f common.mk tmux-start PI_ENTRYPOINT="$$entrypoint"; \
		exit 0; \
	fi; \
	if command -v tmux >/dev/null 2>&1; then \
		tmux rename-window "$(PHILBY_TMUX_WINDOW)" 2>/dev/null || true; \
		tmux select-pane -T "$(PI_PANE_LABEL)" 2>/dev/null || true; \
	fi; \
	$(MAKE) --no-print-directory -f common.mk pi-agent

pi-agent:
	@set -euo pipefail; \
	if [ -z "$${TMUX:-}" ]; then \
		printf 'pi-agent must run inside tmux. Use: make pi\n' >&2; \
		exit 2; \
	fi; \
	if command -v tmux >/dev/null 2>&1; then tmux select-pane -T "$(PI_PANE_LABEL)" 2>/dev/null || true; fi; \
	printf '\033]2;%s\007' "$(PI_PANE_LABEL)"; \
	test -f "$(PI_SYSTEM_PROMPT)"; \
	test -f "$(PI_CODING_AGENT_DIR)/models.json"; \
	test -f "$(PI_CODING_AGENT_DIR)/settings.json"; \
	if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
	: "$${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is required. Put it in .env or export it before running make pi.}"; \
	args=( \
		--model "$(PI_MODEL)" \
		--models "$(PI_MODELS)" \
		--thinking "$(PI_THINKING)" \
		--session-dir "$(PI_CODING_AGENT_SESSION_DIR)" \
		--name "$(PI_SESSION_NAME)" \
		--append-system-prompt "$(PI_SYSTEM_PROMPT)" \
		--approve \
	); \
	if [ -n "$${PI_INITIAL_PROMPT:-}" ]; then \
		args+=("$$PI_INITIAL_PROMPT"); \
	fi; \
	exec pi "$${args[@]}"

subagent:
	@set -euo pipefail; \
	if [ -z "$${TMUX:-}" ]; then \
		printf 'make subagent must be run inside an existing tmux session.\n' >&2; \
		exit 2; \
	fi; \
	label="philby-$(SUBAGENT_NAME)"; \
	prompt="$(SUBAGENT_PROMPT)"; \
	bash ./pane.sh "$$label" env PI_INITIAL_PROMPT="$$prompt" $(MAKE) --no-print-directory pi-agent

pi-check:
	@set -euo pipefail; \
	command -v pi >/dev/null; \
	command -v tmux >/dev/null; \
	test -f "$(PI_SYSTEM_PROMPT)"; \
	test -f "$(PI_CODING_AGENT_DIR)/models.json"; \
	test -f "$(PI_CODING_AGENT_DIR)/settings.json"; \
	models="$$(OPENROUTER_API_KEY=dummy pi --offline --list-models "$(PI_MODEL_SEARCH)" 2>&1)"; \
	printf '%s\n' "$$models" | grep -q '^provider[[:space:]]'
	$(call success)

models:
	@printf 'PI_MODEL=%s\nPI_THINKING=%s\nPI_MODELS=%s\n\n' "$(PI_MODEL)" "$(PI_THINKING)" "$(PI_MODELS)"
	@OPENROUTER_API_KEY=dummy pi --offline --list-models "$(PI_MODEL_SEARCH)"

# Query OpenRouter's public catalog without sending local credentials.
# Usage: make openrouter-models [query=kimi]
openrouter-models:
	@set -euo pipefail; \
	command -v curl >/dev/null 2>&1; \
	command -v jq >/dev/null 2>&1; \
	query="$${query:-}"; \
	curl --fail --silent --show-error --location \
		https://openrouter.ai/api/v1/models | \
	jq -r --arg query "$$query" '.data | map(select(($$query == "") or ((.id + " " + (.name // "") + " " + (.description // "")) | ascii_downcase | contains($$query | ascii_downcase)))) | sort_by(.created // 0) | reverse | .[] | [.id, ((.created // 0) | todateiso8601), ((.context_length // "?") | tostring), ((.top_provider.max_completion_tokens // "?") | tostring), (.architecture.modality // "?"), (.pricing.prompt // "?"), (.pricing.completion // "?")] | @tsv'

codex:
	@set -euo pipefail; \
	prompt="$${CODEX_PROMPT:-}"; \
	if [ -z "$$prompt" ]; then \
		if [ -t 0 ]; then printf 'Usage: make codex PROMPT="..."  (or pipe a prompt on stdin)\n' >&2; exit 2; fi; \
			prompt="$$(cat)"; \
	fi; \
	if [ -z "$$prompt" ]; then printf 'Usage: make codex PROMPT="..."  (or pipe a prompt on stdin)\n' >&2; exit 2; fi; \
	if ! command -v codex >/dev/null 2>&1; then printf 'codex CLI not found on PATH.\n' >&2; exit 127; fi; \
	args=(codex exec --skip-git-repo-check -C "$(CURDIR)" -s "$(CODEX_SANDBOX)"); \
	[ -n "$(CODEX_MODEL)" ] && args+=(-m "$(CODEX_MODEL)"); \
	args+=("$$prompt"); \
	"$${args[@]}"

# Underlying primitive: route a self-contained prompt to any configured model.
# Usage: make ask ASK_MODEL=<provider/model> prompt='...'
#        echo '...' | make ask ASK_MODEL=<provider/model>
ask:
	@set -euo pipefail; \
	if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
	prompt="$${prompt:-$${PROMPT:-}}"; \
	if [ -z "$$prompt" ]; then \
		if [ -t 0 ]; then printf 'Usage: make ask ASK_MODEL=<provider/model> prompt="..."  (or pipe on stdin)\n' >&2; exit 2; fi; \
		prompt="$$(cat)"; \
	fi; \
	if [ -z "$$prompt" ]; then printf 'Usage: make ask ASK_MODEL=<provider/model> prompt="..."  (or pipe on stdin)\n' >&2; exit 2; fi; \
	command -v pi >/dev/null 2>&1 || { printf 'pi CLI not found on PATH.\n' >&2; exit 127; }; \
	model="$(ASK_MODEL)"; \
	case "$$model" in \
		openrouter/*) : "$${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is required for $$model. Put it in .env.}" ;; \
		*) : "$${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is required for $$model (all delegation routes through OpenRouter). Put it in .env.}" ;; \
	esac; \
	exec pi --print --no-tools --no-extensions --no-skills --no-themes --no-context-files --no-approve \
		--no-session --model "$$model" --thinking "$(ASK_THINKING)" "$$prompt"

# Deep reasoning / hard analysis via a flagship reasoning model.
# Usage: make reason prompt='...'
reason:
	@$(MAKE) --no-print-directory -f common.mk ask \
		ASK_MODEL="$(REASON_MODEL)" ASK_THINKING="$(REASON_THINKING)" \
		prompt="$${prompt:-$${PROMPT:-}}"

# General open-web search via OpenRouter's ":online" web plugin. Returns unverified external claims.
# Usage: make research prompt='...'
research:
	@$(MAKE) --no-print-directory -f common.mk ask \
		ASK_MODEL="$(RESEARCH_MODEL)" ASK_THINKING="$(RESEARCH_THINKING)" \
		prompt="$${prompt:-$${PROMPT:-}}"

# Real-time X/Twitter search via Grok (OpenRouter, ":online" for live web). Returns social claims, not fact.
# Usage: make twitter prompt='...'
twitter:
	@$(MAKE) --no-print-directory -f common.mk ask \
		ASK_MODEL="$(TWITTER_MODEL)" ASK_THINKING="$(TWITTER_THINKING)" \
		prompt="$${prompt:-$${PROMPT:-}}"

ascii-text:
	@python3 scripts/ascii_text.py "$(TEXT)"

generate-ascii-text: ascii-text

image-demo:
	@set -euo pipefail; \
	mkdir -p "$(PI_ARTIFACT_DIR)"; \
	image="$(PI_ARTIFACT_DIR)/operator-demo.png"; \
	python3 scripts/image_demo.py "$$image"; \
	$(MAKE) --no-print-directory -f common.mk image-show IMAGE="$$image"
	$(call success)

image-show:
	@set -euo pipefail; \
	image="$(IMAGE)"; \
	test -f "$$image"; \
	if [ -t 1 ] && command -v kitty >/dev/null 2>&1; then \
		kitty +kitten icat --passthrough=detect --align left "$$image"; \
	else \
		printf 'Image ready: %s\n' "$$image"; \
	fi
	$(call success)

lg:
	@set -euo pipefail; \
	command -v lazygit >/dev/null 2>&1 || { printf 'lazygit not found on PATH.\n' >&2; exit 127; }; \
	if [ -z "$${TMUX:-}" ]; then \
		printf 'philby says: make lg must run inside the philby tmux session. Start it with: make\n' >&2; \
		exit 2; \
	fi; \
	if tmux list-windows -F '#{window_name}' 2>/dev/null | grep -xFq 'lazygit'; then \
		tmux select-window -t lazygit; \
		printf 'philby says: focused existing lazygit window.\n'; \
	else \
		tmux new-window -n lazygit -c "$(CURDIR)" "lazygit -p \"$(CURDIR)\""; \
		printf 'philby says: opened lazygit in a new window (closes on exit). Navigate with Ctrl-End/Ctrl-Home; close with Ctrl-Delete.\n'; \
	fi
	$(call success)

# Open an interactive shell in a new tmux window. Default shell is fish.
# Usage: make window [shell=fish] [name=shell]
WINDOW_SHELL ?= fish
WINDOW_NAME ?= shell
window:
	@set -euo pipefail; \
	command -v tmux >/dev/null 2>&1; \
	shell="$(WINDOW_SHELL)"; \
	name="$(WINDOW_NAME)"; \
	if [ -z "$${TMUX:-}" ]; then \
		printf 'philby says: make window must run inside the philby tmux session. Start it with: make\n' >&2; \
		exit 2; \
	fi; \
	if ! command -v "$$shell" >/dev/null 2>&1; then \
		printf 'philby says: shell "%s" not found on PATH.\n' "$$shell" >&2; \
		exit 127; \
	fi; \
	if tmux list-windows -F '#{window_name}' 2>/dev/null | grep -xFq "$$name"; then \
		tmux select-window -t "$$name"; \
		printf 'philby says: focused existing %s window.\n' "$$name"; \
	else \
		tmux new-window -n "$$name" -c "$(CURDIR)" "$$shell"; \
		printf 'philby says: opened %s in a new window. Navigate with Ctrl-End/Ctrl-Home; close with Ctrl-Delete.\n' "$$shell"; \
	fi
	$(call success)

respawn:
	@set -euo pipefail; \
	command -v tmux >/dev/null 2>&1; \
	conf="$(PHILBY_TMUX_CONF)"; \
	test -f "$$conf"; \
	socket="$(PHILBY_TMUX_SOCKET)"; \
	if ! tmux -L "$$socket" info >/dev/null 2>&1; then \
		printf 'philby says: tmux server "%s" is not running; bootstrapping via make tmux-start.\n' "$$socket" >&2; \
		exec $(MAKE) --no-print-directory -f common.mk tmux-start PI_ENTRYPOINT="$(PI_ENTRYPOINT)"; \
	fi; \
	tmux -L "$$socket" source-file "$$conf"; \
	printf 'philby says: reloaded %s on socket %s; menubar refreshed.\n' "$$conf" "$$socket"
	$(call success)

test: pi-check
	@$(MAKE) --no-print-directory -f common.mk digest-raw >/dev/null
	$(call success)

clean:
	rm -Rf "$(PI_CODING_AGENT_DIR)/sessions"
	$(call success)

# Teardown the whole operator environment: kill the philby tmux server
# (closing all windows/panes and supervised processes), stop the logseq-web
# container (ttyd + textual viewer), and sweep orphan host processes. Safe to
# run from inside the philby session (it self-detaches). Reversible: re-run
# `make` to restart the operator, `make -C ../logseq_jg web` to restart the
# viewer.
cleanup:
	@sh tools/cleanup.sh
