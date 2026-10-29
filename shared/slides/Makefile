SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
MODULE := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT := $(abspath $(MODULE)/../..)
ifneq ($(origin prompt),undefined)
export PROMPT := $(value prompt)
endif
unexport prompt
override PROMPT := $(value PROMPT)
override PROMPT_FILE := $(value PROMPT_FILE)
override OUTPUT := $(value OUTPUT)
export PROMPT PROMPT_FILE OUTPUT
override MAKEOVERRIDES :=
.PHONY: help deps generate diagnose check test
help:
	@echo 'generate OUTPUT=new.pptx — async JavaScript body receiving pptx, from PROMPT_FILE, prompt, or stdin'
	@echo 'Creates OUTPUT exclusively; relative paths use the current working directory'
	@echo 'diagnose — verify PptxGenJS and serialize a presentation in memory'
	@echo 'check test — validate the shared slide tool with temporary presentations'
deps:
	@$(MAKE) --no-print-directory -s -C "$(ROOT)" deps >&2
generate diagnose: deps
	@node "$(MODULE)/slides.mjs" $@
check: deps
	@node --check "$(MODULE)/slides.mjs"
	@node --check "$(MODULE)/examples/branded.js"
	@node --check "$(MODULE)/test/slides.test.mjs"
test: deps
	@node --test "$(MODULE)"/test/*.test.mjs
