SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
PANE := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT := $(if $(PHILBY_ROOT),$(PHILBY_ROOT),$(abspath $(PANE)/../..))
override export GRAPH_ROOT := $(PANE)/wiki
.PHONY: help context publish index lint
help:
	@echo 'context — search wiki pages using PROMPT_FILE, prompt, or stdin'
	@echo 'publish CHANGE=stable-change-id — publish unchanged .drafts/<change> contents'
	@echo 'index — rebuild the catalogue; lint — check graph structure'
	@echo 'Graph: wiki/; one writing pane; retain drafts and .graphwiki recovery state'
context publish index lint:
	@$(MAKE) --no-print-directory -f "$(ROOT)/shared/Makefile" wiki-$@ GRAPH_ROOT="$$GRAPH_ROOT"
