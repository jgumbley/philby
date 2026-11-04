SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/..)
ifneq ($(origin prompt),undefined)
export PROMPT := $(value prompt)
endif
unexport prompt
override PROMPT := $(value PROMPT)
override PROMPT_FILE := $(value PROMPT_FILE)
export PROMPT PROMPT_FILE
export slug
export PROVIDER
override export BROWSER := $(value BROWSER)
override export BROWSER_ENDPOINT := $(value BROWSER_ENDPOINT)
override export TAB := $(value TAB)
override export GRAPH_ROOT := $(value GRAPH_ROOT)
override export CHANGE := $(value CHANGE)
override INPUT := $(value INPUT)
override OUTPUT := $(value OUTPUT)
export INPUT OUTPUT
override export GOOGLE_ACCOUNT := $(value GOOGLE_ACCOUNT)
override export CREDENTIALS_FILE := $(value CREDENTIALS_FILE)
override export URL := $(value URL)
override export SPACE := $(value SPACE)
override export TYPE := $(value TYPE)
override export SINCE := $(value SINCE)
override export RANGE := $(value RANGE)
override export MAX_BYTES := $(value MAX_BYTES)
override export MAX_SLIDES := $(value MAX_SLIDES)
BROWSER_TOOLS := browser-connect browser-disconnect browser-status browser-tabs browser-run
WIKI_TOOLS := wiki-context wiki-publish wiki-index wiki-lint wiki-browse
GOOGLE_WORKSPACE_TOOLS := google-workspace-credentials google-workspace-login google-workspace-diagnose google-workspace-read google-workspace-spaces google-workspace-messages google-workspace-export google-workspace-download google-workspace-check google-workspace-test
.PHONY: help ask reason twitter $(BROWSER_TOOLS) browser-check browser-test $(WIKI_TOOLS) wiki-check wiki-test provider-setup
help:
	@echo 'provider-login PROVIDER=name — sign in to a TYPE=openai AUTH=oauth provider using ChatGPT'
	@echo 'provider-models PROVIDER=name — list gateway model metadata using the root name.provider credentials'
	@echo 'provider-setup — copy missing .env and openrouter.provider examples; leave existing files untouched'
	@echo 'ask reason twitter — fresh independent consultations, no local tools or pane context'
	@echo 'PROMPT_FILE (absolute or relative to current directory), prompt, or stdin; override *_MODEL'
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
	@echo 'slides-generate OUTPUT=new.pptx — PptxGenJS async body receiving pptx, from PROMPT_FILE, prompt, or stdin'
	@echo 'slides-diagnose / slides-check / slides-test — dependency diagnostics and local generation checks'
	@echo 'Slides preserve existing outputs; use absolute paths with make -C; shared/slides/README.md'
	@echo 'Google Workspace requires the current gogcli executable on PATH; install through setup-system'
	@echo 'google-workspace-credentials CREDENTIALS_FILE=path; google-workspace-login GOOGLE_ACCOUNT=email — authorize read-only Chat/Drive/Docs/Sheets/Slides'
	@echo 'google-workspace-read GOOGLE_ACCOUNT=email URL=link [RANGE=A1:B20] [MAX_BYTES=100000] [MAX_SLIDES=40] [OUTPUT=new.txt]'
	@echo 'URL can instead come from PROMPT_FILE, prompt, or stdin; google-workspace-download requires OUTPUT=new-file'
	@echo 'google-workspace-spaces GOOGLE_ACCOUNT=email [TYPE=all|space|direct|group] [OUTPUT=new.json] — list Chat spaces with last-message times'
	@echo 'google-workspace-messages GOOGLE_ACCOUNT=email SPACE=spaces/... [OUTPUT=new.json] — messages oldest first'
	@echo 'google-workspace-export GOOGLE_ACCOUNT=email SPACE=spaces/... SINCE=RFC3339 OUTPUT=new.json — export messages since an explicit timestamp'
	@echo 'google-workspace-diagnose [GOOGLE_ACCOUNT=email] / google-workspace-check / google-workspace-test; shared/google-workspace/README.md'
	@echo 'Wiki: GRAPH_ROOT=existing graph directory; wiki-context uses PROMPT_FILE, prompt, or stdin'
	@echo 'wiki-publish CHANGE=stable-change-id; wiki-index; wiki-lint; commands serialize per graph'
	@echo 'wiki-browse GRAPH_ROOT=path — local read-only terminal browser'
	@echo 'wiki-check / wiki-test — check / validate the owned Rust source in shared/graphwiki'
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
.PHONY: slides-generate slides-diagnose slides-check slides-test
slides-generate slides-diagnose slides-check slides-test: override MAKEOVERRIDES :=
slides-generate slides-diagnose slides-check slides-test:
	@$(MAKE) --no-print-directory -s -f "$(ROOT)/shared/slides/Makefile" $(@:slides-%=%)
.PHONY: $(GOOGLE_WORKSPACE_TOOLS)
$(GOOGLE_WORKSPACE_TOOLS): override MAKEOVERRIDES :=
$(GOOGLE_WORKSPACE_TOOLS):
	@$(MAKE) --no-print-directory -s -f "$(ROOT)/shared/google-workspace/Makefile" $(@:google-workspace-%=%)
$(WIKI_TOOLS):
	@$(MAKE) --no-print-directory -f "$(ROOT)/shared/graphwiki/Makefile" $@
wiki-check:
	@$(MAKE) --no-print-directory -C "$(ROOT)/shared/graphwiki" check
wiki-test:
	@$(MAKE) --no-print-directory -C "$(ROOT)/shared/graphwiki" ci
provider-setup:
	@node "$(ROOT)/shared/provider-setup.mjs"
.PHONY: provider-models provider-login
provider-login:
	@$(MAKE) --no-print-directory -s -C "$(ROOT)" build
	@node --disable-warning=ExperimentalWarning "$(ROOT)/shared/provider-login.mjs"
provider-models:
	@node "$(ROOT)/shared/provider-models.mjs"
