SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/..)
.PHONY: help deps build check test
help:
	@echo 'deps / build / check — use the shared Philby TypeScript project'
	@echo 'test — validate tmux frames, selection, terminal input, persistence and shutdown'
	@echo 'Runtime: make -C "$(ROOT)"; frame, frame-new, frame-list, window, quit and cleanup'
deps build check:
	@$(MAKE) --no-print-directory -C "$(ROOT)" $@
test: build
	@cd "$(ROOT)" && node --test dist/tmux/test/*.test.js
