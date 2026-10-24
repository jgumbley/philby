SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
MODULE := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT := $(abspath $(MODULE)/../..)
FIREFOX_PORT ?= 9222
export FIREFOX_PORT PROMPT_FILE
override export TAB := $(value TAB)
override export URL := $(value URL)
override export SELECTOR := $(value SELECTOR)
override export KEY := $(value KEY)
override export OUT := $(value OUT)
override export MARK := $(value MARK)
override export WINDOW := $(value WINDOW)
ifneq ($(origin EXPR),undefined)
override export EXPR := $(value EXPR)
endif
ifneq ($(origin TEXT),undefined)
override export TEXT := $(value TEXT)
endif
TOOLS := start tabs open navigate focus close eval click fill press fullscreen screenshot windows window-focus window-close
.PHONY: help build check test $(TOOLS)
help:
	@echo 'start — enable remote control after quitting Firefox; FIREFOX_PORT=9222, existing normal profile'
	@echo 'tabs; open URL=... [MARK=slug] opens a tiled Sway window; MARK reuses it'
	@echo 'TAB=unique URL/title substring or * pattern: focus close navigate URL=...'
	@echo 'eval EXPR=... or PROMPT_FILE=... or stdin (JavaScript expression; async supported)'
	@echo 'click SELECTOR=...; fill SELECTOR=... TEXT=...; press KEY=Enter'
	@echo 'fullscreen SELECTOR=video; screenshot OUT=/absolute/path.png'
	@echo 'windows; window-focus / window-close WINDOW=exact-Sway-id-or-mark'
	@echo 'Commands serialize. Errors fail visibly; inspect page state before retrying a failed action.'
	@echo 'build check test — compile, typecheck, or run isolated Firefox integration checks'
$(ROOT)/node_modules/.package-lock.json: $(ROOT)/package.json $(ROOT)/package-lock.json
	@$(MAKE) --no-print-directory -s -C "$(ROOT)" deps >&2
$(MODULE)/dist/.built: $(wildcard $(MODULE)/src/*.ts $(MODULE)/test/*.ts) $(MODULE)/Makefile $(MODULE)/tsconfig.json $(ROOT)/tsconfig.json $(ROOT)/node_modules/.package-lock.json
	@"$(ROOT)/node_modules/.bin/tsc" -p "$(MODULE)/tsconfig.json" >&2
	@touch "$@"
build: $(MODULE)/dist/.built
check: $(ROOT)/node_modules/.package-lock.json
	@"$(ROOT)/node_modules/.bin/tsc" -p "$(MODULE)/tsconfig.json" --noEmit
test: build
	@node --test "$(MODULE)"/dist/test/*.test.js
$(TOOLS): build
	@flock -w 60 "$${XDG_RUNTIME_DIR:?}/philby-firefox-$$FIREFOX_PORT.lock" node "$(MODULE)/dist/src/browser.js" $@
