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
override export BROWSER := $(value BROWSER)
override export BROWSER_ENDPOINT := $(value BROWSER_ENDPOINT)
override export TAB := $(value TAB)
override export GRAPH_ROOT := $(value GRAPH_ROOT)
override export CHANGE := $(value CHANGE)
override INPUT := $(value INPUT)
override OUTPUT := $(value OUTPUT)
export INPUT OUTPUT
BROWSER_TOOLS := browser-connect browser-disconnect browser-status browser-tabs browser-run
WIKI_TOOLS := wiki-context wiki-publish wiki-index wiki-lint wiki-viewer-start wiki-viewer-stop wiki-viewer-status wiki-viewer-doctor wiki-viewer-install wiki-viewer-capture wiki-browse
export VIEWER_PORT
.PHONY: help processes ask reason research twitter $(BROWSER_TOOLS) browser-check browser-test $(WIKI_TOOLS) wiki-check wiki-test pane-repo-inspect pane-repo-init pane-repo-verify repo-views prompt-audit migrate-state provider-setup
help:
	@echo 'provider-models PROVIDER=name — list gateway model metadata using the root name.provider credentials'
	@echo 'provider-setup — copy missing .env and openrouter.provider examples; leave existing files untouched'
	@echo 'processes — current-user process tree with elapsed and CPU time; excludes arguments'
	@echo 'ask reason twitter — fresh independent consultations, no local tools or pane context'
	@echo 'research — tactical web lookup: search, read pages/PDFs, and return a concise practical answer'
	@echo 'PROMPT_FILE (absolute or relative to current directory), prompt, or stdin; override *_MODEL'
	@echo 'Research uses OpenRouter web tools, up to six calls and two minutes; RESEARCH_MODEL=openrouter/openai/gpt-5.5'
	@echo 'Browser: BROWSER=chrome|firefox is required; connect to an existing browser, never launch one'
	@echo 'browser-connect / browser-disconnect — open or stop the persistent browser service pane'
	@echo 'browser-status — check connection; browser-tabs — list page URLs and titles'
	@echo 'browser-run — Puppeteer async function body from PROMPT_FILE, prompt, or stdin; return a JSON value'
	@echo 'Scripts receive browser and page; TAB=unique case-insensitive URL/title substring selects page'
	@echo 'Without TAB, page is undefined; browser is always available'
	@echo 'BROWSER_ENDPOINT=ws://... or wss://... overrides Chrome channel discovery / Firefox localhost:9222/session'
	@echo 'Calls share the pane connection and serialize. Status shows the busy caller and queue. Scripts are never replayed.'
	@echo 'browser-check / browser-test — validate shared/browser; setup and examples: shared/browser/README.md'
	@echo 'ocr INPUT=local.pdf|png|jpg|jpeg [OUTPUT=new.txt] — local English text extraction with Scribe.js'
	@echo 'ocr-diagnose / ocr-check / ocr-test — check dependencies / syntax / temporary document tests'
	@echo 'OCR prints text with form-feed page separators; OUTPUT saves without overwriting; shared/ocr/README.md'
	@echo 'Wiki: GRAPH_ROOT=existing graph directory; wiki-context uses PROMPT_FILE, prompt, or stdin'
	@echo 'wiki-publish CHANGE=stable-change-id; wiki-index; wiki-lint; commands serialize per graph'
	@echo 'wiki-viewer-install / wiki-viewer-doctor; wiki-viewer-start / wiki-viewer-stop / wiki-viewer-status GRAPH_ROOT=path [VIEWER_PORT=8080]'
	@echo 'wiki-browse GRAPH_ROOT=path — read-only TUI; browser viewer binds all interfaces without authentication'
	@echo 'wiki-viewer-capture [VIEWER_PORT=8080] — capture a browser terminal; optional literal keys via PROMPT_FILE, prompt, stdin'
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
	@$(MAKE) --no-print-directory -f "$(ROOT)/shared/browser/Makefile" $(@:browser-%=%)
.PHONY: ocr ocr-diagnose ocr-check ocr-test
ocr ocr-diagnose ocr-check ocr-test: override MAKEOVERRIDES :=
ocr:
	@$(MAKE) --no-print-directory -s -f "$(ROOT)/shared/ocr/Makefile" run
ocr-diagnose ocr-check ocr-test:
	@$(MAKE) --no-print-directory -s -f "$(ROOT)/shared/ocr/Makefile" $(@:ocr-%=%)
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
