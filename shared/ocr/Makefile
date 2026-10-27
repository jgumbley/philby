SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
MODULE := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT := $(abspath $(MODULE)/../..)
override INPUT := $(value INPUT)
override OUTPUT := $(value OUTPUT)
export INPUT OUTPUT
override MAKEOVERRIDES :=
.PHONY: help deps run diagnose check test
help:
	@echo 'run INPUT=local.pdf|png|jpg|jpeg [OUTPUT=new.txt] — extract English text with Scribe.js'
	@echo 'Prints text with form-feed page separators; OUTPUT saves it without overwriting an existing file'
	@echo 'diagnose — check Node, native rendering and bundled English language data'
	@echo 'check test — validate the shared OCR tool with temporary documents'
deps:
	@$(MAKE) --no-print-directory -s -C "$(ROOT)" deps >&2
run diagnose: deps
	@node "$(MODULE)/ocr.mjs" $@
check: deps
	@node --check "$(MODULE)/ocr.mjs"
test: deps
	@node --test "$(MODULE)"/test/*.test.mjs
