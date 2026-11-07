SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := run
include shared/graphwiki/clipboard.mk
ifneq ($(origin prompt),undefined)
export PROMPT := $(value prompt)
endif
export PROMPT
override PLAN := $(value PLAN)
export PLAN
export PROMPT_FILE slug from REQUEST_ID MODE FIELD MARK ACTIVE PLAN ALL PHILBY_DETACHED TYPE
.PHONY: run pane pane-new pane-close pane-stop pane-send pane-report pane-capture pane-list pane-memory pane-plan pane-plan-set pane-new-session pane-updates pane-tools window deps deps-update build check test check-all test-all help digest ingest quit cleanup ask reason twitter full-pi
define success
	@exec >&2; \
	printf '\033[32m\n'; \
	set -- 🕵️ 🔒 📡 🗝️ 🥃; \
	icon_idx=$$(( $$(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % $$# + 1 )); \
	while [ $$icon_idx -gt 1 ]; do shift; icon_idx=$$((icon_idx - 1)); done; \
	printf '%s > \033[33m%s\033[0m accomplished\n' "$$1" '$@'; \
	printf '\033[90m{{{ %s | user=%s | host=%s | procid=%s | parentproc=%s }}}\033[0m\n\033[0m' "$$(date +%Y-%m-%d_%H:%M:%S)" "$$(whoami)" "$$(hostname)" "$$$$" "$$PPID"
endef
node_modules/.package-lock.json: package.json package-lock.json
	npm ci


deps: node_modules/.package-lock.json

deps-update:
	npm update --package-lock-only
	npm install --package-lock-only
	$(MAKE) -B deps

dist/.built: $(wildcard src/*.ts test/*.ts tmux/*.ts tmux/test/*.ts) tsconfig.json package.json package-lock.json node_modules/.package-lock.json
	rm -rf dist/src dist/test dist/tmux
	npm run build
	@touch dist/.built

build: dist/.built
run: build
	@node --disable-warning=ExperimentalWarning dist/src/cli.js open
pane: run
pane-new pane-close pane-stop pane-send pane-report pane-capture pane-list pane-memory pane-plan pane-plan-set pane-new-session pane-updates pane-tools: build
	@node --disable-warning=ExperimentalWarning dist/src/cli.js $(@:pane-%=%)
window quit cleanup: build
	@node --disable-warning=ExperimentalWarning dist/src/cli.js $@
check: deps
	@npm run check
	$(success)
test: build
	@npm test
	$(success)
check-all: check
	@$(MAKE) --no-print-directory -C shared/browser check
	@$(MAKE) --no-print-directory -C shared/ocr check
	@$(MAKE) --no-print-directory -C shared/slides check
	@$(MAKE) --no-print-directory -C shared/google-workspace check
	@$(MAKE) --no-print-directory -C shared/graphwiki check
test-all: test
	@$(MAKE) --no-print-directory -C tmux test
	@$(MAKE) --no-print-directory -C shared/browser test
	@$(MAKE) --no-print-directory -C shared/ocr test
	@$(MAKE) --no-print-directory -C shared/slides test
	@$(MAKE) --no-print-directory -C shared/google-workspace test
	@$(MAKE) --no-print-directory -C shared/graphwiki test
full-pi:
	@$(MAKE) --no-print-directory -C shared $@
ask reason twitter: build
	@$(MAKE) --no-print-directory -C shared $@
help:
	@echo 'deps-update — refresh the npm lockfile for package.json, then install the locked dependencies'
	@echo 'full-pi — open the complete native Pi interface using this checkout’s .pi/agent configuration'
	@echo 'make — create/open pane chooser; make pane slug=<slug> [TYPE=plain|graphwiki] — create or resume'
	@echo 'Navigation: Ctrl-End / Ctrl-Home; macOS Kitty: Cmd-Option-Right / Cmd-Option-Left (requires allow_remote_control yes)'
	@echo 'pane-new — select a saved pane or New pane; pane-list — saved agents and every live tmux view'
	@echo 'pane-close pane-stop pane-send pane-capture pane-list pane-memory'
	@echo 'pane-plan pane-plan-set pane-new-session pane-updates pane-tools pane-report'
	@echo 'Messages and reports: slug=receiving-pane, from=sending-pane (or current pane), REQUEST_ID=, MODE=steer'
	@echo 'Inputs: FIELD=, MARK=1, ACTIVE=1, PLAN=...; TYPE selects a creation recipe'
	@echo 'Prompts: PROMPT_FILE=path, prompt=..., or stdin.'
	@echo 'Plan mode: pane-plan shows status; pane-plan-set ACTIVE=1 enables read-only mode; ACTIVE=0 with PLAN= or prompt exits and saves plan'
	@echo 'New session: pane-new-session starts a fresh transcript, preserving files, tools, memory and archived history'
	@echo 'pane-capture ALL=1 — include archived entries from before /new in chronological order'
	@echo 'window deps build check test digest ingest cleanup; shared: ask reason twitter'
	@echo 'check/test — core; check-all/test-all — include module checks and tests'
	@echo 'digest — print existing Git-tracked files; ingest — copy that digest to the macOS or Linux clipboard'
	@echo 'quit — close all Philby panes after y/n confirmation; /quit works inside any agent pane'
	@echo 'Browser tools: make -C shared help (browser-status, browser-tabs, browser-run; BROWSER=chrome|firefox)'
	@echo 'OCR: make -C shared ocr INPUT=/path/document.pdf [OUTPUT=/path/new.txt]; ocr-diagnose'
	@echo 'Slides: make -C shared slides-generate PROMPT_FILE=/path/deck.js OUTPUT=/path/new.pptx; slides-diagnose'
	@echo 'Google Workspace: make -C shared help (google-workspace-login, -read, -spaces, -messages, -export, -download, -diagnose)'
	@echo 'Wiki tools: make -C shared help (wiki-context, wiki-publish, wiki-index, wiki-lint)'
digest:
	@set -eu -o pipefail; git ls-files -z --deduplicate | LC_ALL=C sort -z | while IFS= read -r -d '' file; do [ -e "$$file" ] || continue; printf '\n--- %s ---\n' "$$file"; cat -- "$$file"; done
	$(success)
ingest:
	$(copy_digest)
	$(success)
