SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := digest

DIGEST_FILES := AGENTS.md README.md Makefile engine/common.mk logseq/config.edn
DIGEST_DIRS := pages journals
include engine/common.mk

export GRAPH_ROOT := $(CURDIR)
export ARGUMENT :=
context: export ARGUMENT = $(QUERY)
publish: export ARGUMENT = $(CHANGE)

.PHONY: context publish index lint

context publish index lint:
	@$(MAKE) --no-print-directory -s -C engine invoke OPERATION=$@
