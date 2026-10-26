SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/..)
ifneq ($(origin prompt),undefined)
export PROMPT := $(value prompt)
endif
export PROMPT
export PROMPT_FILE
export slug
export PROVIDER
override export BASELINE := $(value BASELINE)
override export TAB := $(value TAB)
override export URL := $(value URL)
override export SELECTOR := $(value SELECTOR)
override export KEY := $(value KEY)
override export OUT := $(value OUT)
override export MARK := $(value MARK)
override export WINDOW := $(value WINDOW)
override export GRAPH_ROOT := $(value GRAPH_ROOT)
override export CHANGE := $(value CHANGE)
ifneq ($(origin EXPR),undefined)
override export EXPR := $(value EXPR)
endif
ifneq ($(origin TEXT),undefined)
override export TEXT := $(value TEXT)
endif
BROWSER_TOOLS := browser-start browser-tabs browser-open browser-navigate browser-focus browser-close browser-eval browser-click browser-fill browser-press browser-fullscreen browser-screenshot browser-windows browser-window-focus browser-window-close
WIKI_TOOLS := wiki-context wiki-publish wiki-index wiki-lint
.PHONY: help processes ask reason research twitter $(BROWSER_TOOLS) browser-check browser-test $(WIKI_TOOLS) wiki-check wiki-test pane-repo-inspect pane-repo-init pane-repo-verify repo-views prompt-audit migrate-state provider-setup
help:
	@echo 'provider-models PROVIDER=name — list gateway model metadata using the root name.provider credentials'
	@echo 'provider-setup — copy missing .env and openrouter.provider examples; leave existing files untouched'
	@echo 'processes — current-user process tree with elapsed and CPU time; excludes arguments'
	@echo 'ask reason twitter — fresh independent consultations, no local tools or pane context'
	@echo 'research — tactical web lookup: search, read pages/PDFs, and return a concise practical answer'
	@echo 'PROMPT_FILE (absolute or relative to current directory), prompt, or stdin; override *_MODEL'
	@echo 'Research uses OpenRouter web tools, up to six calls and two minutes; RESEARCH_MODEL=openrouter/openai/gpt-5.5'
	@echo 'Firefox: browser-start (after quitting Firefox); FIREFOX_PORT=9222, existing normal profile'
	@echo 'browser-tabs; browser-open URL=... [MARK=slug] opens a tiled Sway window; MARK reuses it'
	@echo 'TAB=unique URL/title substring or * pattern: browser-focus browser-close browser-navigate URL=...'
	@echo 'browser-eval EXPR=... or PROMPT_FILE=... or stdin (JavaScript expression; async supported)'
	@echo 'browser-click SELECTOR=...; browser-fill SELECTOR=... TEXT=...; browser-press KEY=Enter'
	@echo 'browser-fullscreen SELECTOR=video; browser-screenshot OUT=/absolute/path.png'
	@echo 'browser-windows; browser-window-focus / browser-window-close WINDOW=exact-Sway-id-or-mark'
	@echo 'Commands serialize. Errors fail visibly; inspect page state before retrying a failed action.'
	@echo 'browser-check / browser-test — validate the Firefox module in shared/firefox'
	@echo 'Wiki: GRAPH_ROOT=existing graph directory; wiki-context uses PROMPT_FILE, prompt, or stdin'
	@echo 'wiki-publish CHANGE=stable-change-id; wiki-index; wiki-lint; commands serialize per graph'
	@echo 'wiki-check / wiki-test — check / validate the owned Rust source in shared/graphwiki'
	@echo 'pane-repo-inspect / pane-repo-init / pane-repo-verify slug=... — manage an independent pane repository'
	@echo 'repo-views — list tmux working directories and repositories'
	@echo 'prompt-audit BASELINE=revision — inspect serialized instruction metadata from pane-capture JSON on stdin, offline'
	@echo 'migrate-state — move legacy state into pane directories and remove the old coordinator; close old panes first'
processes:
	@ps -u "$$(id -u)" -o pid,ppid,stat,etime,time,comm --forest
research:
	@$(MAKE) --no-print-directory -s -C "$(ROOT)" build >&2
	@node "$(ROOT)/shared/research.mjs"
ask reason twitter:
	@$(MAKE) --no-print-directory -C "$(ROOT)" build
	@ROUTE=$@ node --disable-warning=ExperimentalWarning "$(ROOT)/dist/src/cli.js" consult
$(BROWSER_TOOLS) browser-check browser-test:
	@$(MAKE) --no-print-directory -f "$(ROOT)/shared/firefox/Makefile" $(@:browser-%=%)
$(WIKI_TOOLS):
	@$(MAKE) --no-print-directory -f "$(ROOT)/shared/graphwiki/Makefile" $@
wiki-check:
	@$(MAKE) --no-print-directory -C "$(ROOT)/shared/graphwiki" check
wiki-test:
	@$(MAKE) --no-print-directory -C "$(ROOT)/shared/graphwiki" ci
pane-repo-inspect pane-repo-init pane-repo-verify:
	@node "$(ROOT)/shared/pane-repo.mjs" $(@:pane-repo-%=%)
repo-views prompt-audit migrate-state:
	@node "$(ROOT)/shared/$@.mjs"
provider-setup:
	@node "$(ROOT)/shared/provider-setup.mjs"
.PHONY: provider-models
provider-models:
	@node "$(ROOT)/shared/provider-models.mjs"
