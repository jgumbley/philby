SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
MODULE := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ifneq ($(origin prompt),undefined)
export PROMPT := $(value prompt)
endif
unexport prompt
override PROMPT := $(value PROMPT)
override PROMPT_FILE := $(value PROMPT_FILE)
override GOOGLE_ACCOUNT := $(value GOOGLE_ACCOUNT)
override CREDENTIALS_FILE := $(value CREDENTIALS_FILE)
override URL := $(value URL)
override SPACE := $(value SPACE)
override TYPE := $(value TYPE)
override SINCE := $(value SINCE)
override OUTPUT := $(value OUTPUT)
override RANGE := $(value RANGE)
override MAX_BYTES := $(value MAX_BYTES)
override MAX_SLIDES := $(value MAX_SLIDES)
export PROMPT PROMPT_FILE GOOGLE_ACCOUNT CREDENTIALS_FILE URL SPACE TYPE SINCE OUTPUT RANGE MAX_BYTES MAX_SLIDES
override MAKEOVERRIDES :=
.PHONY: help credentials login diagnose read spaces messages export download check test
help:
	@echo 'Requires the current gogcli executable on PATH; installation belongs to setup-system'
	@echo 'credentials CREDENTIALS_FILE=path — register an OAuth client JSON file with gog'
	@echo 'login GOOGLE_ACCOUNT=email — authorize read-only Chat/Drive/Docs/Sheets/Slides'
	@echo 'diagnose [GOOGLE_ACCOUNT=email] — inspect client version and local authentication metadata'
	@echo 'read GOOGLE_ACCOUNT=email URL=link [RANGE=A1:B20] [MAX_BYTES=100000] [MAX_SLIDES=40] [OUTPUT=new.txt]'
	@echo 'read/download URL input: URL, then PROMPT_FILE, prompt/PROMPT, then stdin; use absolute paths with make -C'
	@echo 'spaces GOOGLE_ACCOUNT=email [TYPE=all|space|direct|group] [OUTPUT=new.json] — list spaces with last-message times'
	@echo 'messages GOOGLE_ACCOUNT=email SPACE=spaces/... [OUTPUT=new.json] — read Chat messages chronologically'
	@echo 'export GOOGLE_ACCOUNT=email SPACE=spaces/... SINCE=RFC3339 OUTPUT=new.json — export messages since a timestamp'
	@echo 'download GOOGLE_ACCOUNT=email URL=link OUTPUT=new-file — download a Drive file'
	@echo 'Output files are created privately and never overwrite existing paths; API failures return nonzero'
	@echo 'check test — syntax checks and deterministic shared-tool contract tests; no Google account required'
credentials login diagnose read spaces messages export download:
	@node "$(MODULE)/google-workspace.mjs" $@
check:
	@node --check "$(MODULE)/google-workspace.mjs"
	@for file in "$(MODULE)"/test/*.mjs; do node --check "$$file"; done
test:
	@node --test "$(MODULE)"/test/*.test.mjs
