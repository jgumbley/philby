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
export INPUT
export PROMPT_FILE id from REQUEST_ID MODE FIELD MARK ACTIVE PLAN ALL PHILBY_DETACHED TYPE
export LEVEL
ifneq ($(origin ENABLED),undefined)
export ENABLED
endif
.PHONY: run frame-migrate frame frame-new frame-close frame-stop frame-send frame-report frame-capture frame-list frame-memory frame-plan frame-plan-set frame-new-session frame-updates frame-tools window deps deps-update build check test check-all test-all help digest ingest quit cleanup ask reason twitter full-pi
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
config-check: build
	@node --disable-warning=ExperimentalWarning dist/src/cli.js config-check
frame-config-check: build
	@node --disable-warning=ExperimentalWarning dist/src/cli.js frame-config-check
frame-config-migrate: build
	@node --disable-warning=ExperimentalWarning dist/src/cli.js config-migrate
.PHONY: config-check frame-config-check frame-config-migrate frame-thinking frame-messaging
run: build
	@node --disable-warning=ExperimentalWarning dist/src/cli.js open
frame-migrate: build
	@env -u PHILBY_PANES_DIR node --disable-warning=ExperimentalWarning dist/src/cli.js migrate
frame: run
frame-new frame-close frame-stop frame-send frame-report frame-capture frame-list frame-memory frame-plan frame-plan-set frame-new-session frame-updates frame-tools frame-thinking frame-messaging: build
	@node --disable-warning=ExperimentalWarning dist/src/cli.js $(@:frame-%=%)
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
	@echo 'config-check; frame-config-check id=<id> — validate Varlock schemas without printing values'
	@echo 'frame-config-migrate id=<id> — write settings from an existing closed frame’s saved conversation'
	@echo 'frame-thinking id=<id> LEVEL=off|minimal|low|medium|high|xhigh|max|default — save a frame thinking preference'
	@echo 'frame-messaging id=<id> [ENABLED=true|false] — inspect messaging; change it while the frame is closed'
	@echo 'deps-update — refresh the npm lockfile for package.json, then install the locked dependencies'
	@echo 'full-pi — open the complete native Pi interface using this checkout’s .pi/agent configuration'
	@echo 'make — create/open frame chooser; make frame id=<id> [TYPE=plain|graphwiki] — create or resume'
	@echo 'Navigation: Ctrl-End / Ctrl-Home; macOS Kitty: Cmd-Option-Right / Cmd-Option-Left (requires allow_remote_control yes)'
	@echo 'frame-migrate [INPUT=old-directory] — rename panes/ to frames/ in place; PHILBY_FRAMES_DIR selects destination'
	@echo 'frame-new — select a saved frame or New frame; frame-list — saved agents and every live tmux view'
	@echo 'frame-close frame-stop frame-send frame-capture frame-list frame-memory'
	@echo 'frame-plan frame-plan-set frame-new-session frame-updates frame-tools frame-report'
	@echo 'Messages and reports: id=receiving-frame, from=sending-frame (or current frame), REQUEST_ID=, MODE=steer'
	@echo 'Inputs: FIELD=, MARK=1, ACTIVE=1, PLAN=...; TYPE selects a creation recipe'
	@echo 'Prompts: PROMPT_FILE=path, prompt=..., or stdin.'
	@echo 'Plan mode: frame-plan shows status; frame-plan-set ACTIVE=1 enables read-only mode; ACTIVE=0 with PLAN= or prompt exits and saves plan'
	@echo 'New session: frame-new-session starts a fresh transcript, preserving files, tools, memory and archived history'
	@echo 'frame-capture ALL=1 — include archived entries from before /new in chronological order'
	@echo 'window deps build check test digest ingest cleanup; shared: ask reason twitter'
	@echo 'check/test — core; check-all/test-all — include module checks and tests'
	@echo 'digest — print existing Git-tracked files; ingest — copy that digest to the macOS or Linux clipboard'
	@echo 'quit — close all Philby frames after y/n confirmation; /quit works inside any agent frame'
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
