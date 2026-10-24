SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := build

MODULE := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
CARGO ?= cargo
DIGEST_FILES := AGENTS.md README.md DECISIONS.md Makefile Cargo.toml Cargo.lock .clippy.toml rustfmt.toml common.mk wiki.mjs tests/fixtures/consumer.mk
DIGEST_DIRS := src tests
include $(dir $(lastword $(MAKEFILE_LIST)))common.mk

export OPERATION ARGUMENT GRAPH_ROOT
ifneq ($(origin prompt),undefined)
export PROMPT := $(value prompt)
endif
export PROMPT PROMPT_FILE
override export GRAPH_ROOT := $(value GRAPH_ROOT)
override export CHANGE := $(value CHANGE)

.PHONY: help wiki-context wiki-publish wiki-index wiki-lint run build compile invoke release test check fmt fmt-check clippy doc lint clean ci coverage complexity

help:
	@echo 'wiki-context GRAPH_ROOT=path — search with PROMPT_FILE, prompt, or stdin'
	@echo 'wiki-publish GRAPH_ROOT=path CHANGE=id; wiki-index; wiki-lint — graph operations'
	@echo 'check — compile checks; test — formatting, Clippy and tests; ci — test and build'

wiki-context wiki-publish wiki-index wiki-lint:
	@node "$(MODULE)/wiki.mjs" $(@:wiki-%=%)

run: build
	$(CARGO) run --locked

compile:
	@$(CARGO) build --locked --quiet

invoke:
	@$(CARGO) run --locked --quiet -- "$$OPERATION" "$$GRAPH_ROOT" "$$ARGUMENT"

fmt:
	$(CARGO) fmt --all

fmt-check:
	$(CARGO) fmt --all -- --check

clippy: fmt-check
	$(CARGO) clippy --locked --all-targets -- -D warnings -D clippy::cognitive-complexity \
	  -D clippy::too-many-arguments -D clippy::too-many-lines \
	  -D clippy::nonminimal-bool -D clippy::needless_continue \
	  -D clippy::large-enum-variant -D clippy::result_large_err \
	  -D clippy::type-complexity -D clippy::excessive-nesting

lint: clippy

complexity:
	$(CARGO) test --locked --test complexity -- --nocapture

test: clippy
	$(CARGO) test --locked

build: test
	$(CARGO) build --locked

release:
	$(CARGO) build --locked --release

ci: build

coverage:
	$(CARGO) llvm-cov --summary-only

check:
	$(CARGO) check --locked

doc:
	$(CARGO) doc --locked

clean:
	$(CARGO) clean
