SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := run
ifneq ($(origin prompt),undefined)
export PROMPT := $(value prompt)
endif
export PROMPT
export PROMPT_FILE slug from REQUEST_ID MODE FIELD ID PAUSED MARK PHILBY_DETACHED TYPE
export ASK_MODEL REASON_MODEL RESEARCH_MODEL TWITTER_MODEL
.PHONY: run pane pane-new pane-close pane-stop pane-send pane-report pane-capture pane-list pane-memory pane-checks pane-check-set pane-check-pause pane-check-remove pane-updates pane-tools window deps build check test check-all test-all help digest ingest quit cleanup migrate-mailboxes ask reason research twitter
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

dist/.built: $(wildcard src/*.ts test/*.ts tmux/*.ts tmux/test/*.ts) tsconfig.json package.json package-lock.json node_modules/.package-lock.json
	npm run build
	@touch dist/.built

build: dist/.built
run: build
	@node --disable-warning=ExperimentalWarning dist/src/cli.js open
pane: run
pane-new pane-close pane-stop pane-send pane-report pane-capture pane-list pane-memory pane-checks pane-check-set pane-check-pause pane-check-remove pane-updates pane-tools: build
	@node --disable-warning=ExperimentalWarning dist/src/cli.js $(@:pane-%=%)
window quit cleanup migrate-mailboxes: build
	@node --disable-warning=ExperimentalWarning dist/src/cli.js $@
check: deps
	@npm run check
	$(success)
test: build
	@npm test
	$(success)
check-all: check
	@$(MAKE) --no-print-directory -C shared/firefox check
	@$(MAKE) --no-print-directory -C shared/graphwiki check
test-all: test
	@$(MAKE) --no-print-directory -C tmux test
	@$(MAKE) --no-print-directory -C shared/firefox test
	@$(MAKE) --no-print-directory -C shared/graphwiki test
research:
	@$(MAKE) --no-print-directory -f shared/Makefile research
ask reason twitter: build
	@$(MAKE) --no-print-directory -C shared $@
help:
	@echo 'make — create/open pane chooser; make pane slug=<slug> [TYPE=plain|graphwiki] — create or resume'
	@echo 'pane-new — select a saved pane or New pane; pane-list — saved agents and every live tmux view'
	@echo 'pane-close pane-stop pane-send pane-capture pane-list pane-memory pane-checks'
	@echo 'pane-check-set pane-check-pause pane-check-remove pane-updates pane-tools pane-report'
	@echo 'Messages and reports: slug=receiving-pane, from=sending-pane (or current pane), REQUEST_ID=, MODE=steer'
	@echo 'Inputs: FIELD=, ID=, PAUSED=false, MARK=1; TYPE selects a creation recipe'
	@echo 'Prompts: PROMPT_FILE=path, prompt=..., or stdin. check-set accepts a JSON prompt.'
	@echo 'window deps build check test digest ingest cleanup; shared: ask reason research twitter'
	@echo 'check/test — core; check-all/test-all — include module checks and tests'
	@echo 'digest — print all Git-tracked files; ingest — copy that digest to the Wayland clipboard'
	@echo 'quit — close all Philby panes after y/n confirmation; /quit works inside any agent pane'
	@echo 'Firefox tools: make -C shared help (browser-tabs, browser-eval, browser-click and more)'
	@echo 'Wiki tools: make -C shared help (wiki-context, wiki-publish, wiki-index, wiki-lint)'
	@echo 'migrate-mailboxes — move pending legacy outboxes into receiving pane mailboxes; close all panes first'
	@echo 'Legacy state: make -C shared migrate-state after closing old panes'
digest:
	@git ls-files -z --deduplicate | LC_ALL=C sort -z | while IFS= read -r -d '' file; do printf '\n--- %s ---\n' "$$file"; cat -- "$$file"; done
	$(success)
ingest:
	@digest_file=$$(mktemp); trap 'rm -f "$$digest_file"' EXIT; $(MAKE) --no-print-directory -s digest > "$$digest_file"; wl-copy < "$$digest_file"
	$(success)
