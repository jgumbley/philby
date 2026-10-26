SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
MODULE := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT := $(abspath $(MODULE)/../..)
ifneq ($(origin prompt),undefined)
export PROMPT := $(value prompt)
endif
export PROMPT PROMPT_FILE BROWSER BROWSER_ENDPOINT
override export TAB := $(value TAB)
.PHONY: help build app-build check test connect disconnect status tabs run
help:
	@echo 'BROWSER=chrome|firefox; attach to your existing browser; no browser is launched'
	@echo 'connect — open a persistent browser service pane; disconnect — stop it, leaving the browser open'
	@echo 'status — service state, active caller and queue; tabs — list existing page URLs and titles'
	@echo 'run — async Puppeteer body from PROMPT_FILE, prompt, or stdin; browser and page are available'
	@echo 'TAB=unique URL/title substring selects page; omitted TAB leaves page undefined'
	@echo 'BROWSER_ENDPOINT=ws://... overrides the browser connection endpoint'
	@echo 'Connect once; commands share the pane connection and serialize; status shows the busy caller and queue'
	@echo 'build check test — compile, typecheck, or test installed Chrome and Firefox with temporary profiles'
$(ROOT)/node_modules/.package-lock.json: $(ROOT)/package.json $(ROOT)/package-lock.json
	@$(MAKE) --no-print-directory -s -C "$(ROOT)" deps >&2
$(MODULE)/dist/.built: $(wildcard $(MODULE)/src/*.ts $(MODULE)/test/*.ts) $(MODULE)/Makefile $(MODULE)/tsconfig.json $(ROOT)/tsconfig.json $(ROOT)/node_modules/.package-lock.json
	@"$(ROOT)/node_modules/.bin/tsc" -p "$(MODULE)/tsconfig.json" >&2
	@touch "$@"
app-build:
	@$(MAKE) --no-print-directory -s -C "$(ROOT)" build >&2
build: app-build $(MODULE)/dist/.built
check: $(ROOT)/node_modules/.package-lock.json
	@"$(ROOT)/node_modules/.bin/tsc" -p "$(MODULE)/tsconfig.json" --noEmit
test: build
	@node --disable-warning=ExperimentalWarning --test "$(MODULE)"/dist/test/*.test.js
connect disconnect status tabs run: build
	@node --disable-warning=ExperimentalWarning "$(MODULE)/dist/src/browser.js" $@
