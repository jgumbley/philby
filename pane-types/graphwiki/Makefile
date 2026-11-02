SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
PANE := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT := $(if $(PHILBY_ROOT),$(PHILBY_ROOT),$(abspath $(PANE)/../..))
override export GRAPH_ROOT := $(PANE)/wiki
VIEWER_PORT ?= 8080
export VIEWER_PORT
.PHONY: help context publish index lint viewer-start viewer-stop viewer-status viewer-doctor browse close
help:
	@echo 'context — search wiki pages using PROMPT_FILE, prompt, or stdin'
	@echo 'publish CHANGE=stable-change-id — publish unchanged .drafts/<change> contents'
	@echo 'index — rebuild the catalogue; lint — check graph structure'
	@echo 'Graph: wiki/; one writing pane; retain drafts and .graphwiki recovery state'
	@echo 'viewer-start / viewer-stop / viewer-status / viewer-doctor — ttyd on 0.0.0.0:8080, no authentication'
	@echo 'Set VIEWER_PORT in this Makefile for another port; browse — local read-only TUI; close — stop viewer'
context publish index lint:
	@$(MAKE) --no-print-directory -f "$(ROOT)/shared/Makefile" wiki-$@ GRAPH_ROOT="$$GRAPH_ROOT"
viewer-start viewer-stop viewer-status viewer-doctor browse:
	@$(MAKE) --no-print-directory -f "$(ROOT)/shared/Makefile" wiki-$@ GRAPH_ROOT="$$GRAPH_ROOT"
close: viewer-stop
