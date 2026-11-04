SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
PANE := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT := $(if $(PHILBY_ROOT),$(PHILBY_ROOT),$(abspath $(PANE)/../..))
override GRAPH_ROOT := $(PANE)/wiki
export GRAPH_ROOT
.PHONY: help context publish index lint editorial-check browse
help:
	@echo 'context — search wiki pages using PROMPT_FILE, prompt, or stdin'
	@echo 'publish CHANGE=stable-change-id — publish unchanged .drafts/<change> contents'
	@echo 'index — rebuild the catalogue; lint — check graph structure and article provenance'
	@echo 'editorial-check [CHANGE=id] — check published or proposed articles; manually review source narration too'
	@echo 'Graph: wiki/; one writing pane; retain drafts and .graphwiki recovery state'
	@echo 'browse — open the local read-only terminal browser'
context index:
	@$(MAKE) --no-print-directory -f "$(ROOT)/shared/Makefile" wiki-$@ GRAPH_ROOT="$$GRAPH_ROOT"
publish:
	@$(MAKE) --no-print-directory editorial-check
	@$(MAKE) --no-print-directory -f "$(ROOT)/shared/Makefile" wiki-publish GRAPH_ROOT="$$GRAPH_ROOT"
browse:
	@$(MAKE) --no-print-directory -f "$(ROOT)/shared/Makefile" wiki-$@ GRAPH_ROOT="$$GRAPH_ROOT"

export CHANGE
editorial-check:
	@node "$(PANE)/editorial.mjs"
lint:
	@$(MAKE) --no-print-directory -f "$(ROOT)/shared/Makefile" wiki-lint GRAPH_ROOT="$(GRAPH_ROOT)"
	@$(MAKE) --no-print-directory editorial-check CHANGE=
