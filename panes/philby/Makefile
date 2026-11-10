SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
export SOCKET TARGET
export slug MODEL
.PHONY: help inspect-status inspect-views inspect-screen
help:
	@echo 'openai-diagnose — OpenAI credential metadata and model shortlist, without credential values'
	@echo 'openai-shortlist — add Holly’s OpenAI Astra and GPT-6.1 Sol choices to the existing shortlist'
	@echo 'frame-model slug=receiving-frame MODEL=provider/model-id — select a model through the running frame, preserving its conversation'
	@echo 'inspect-status — local philby process and unfinished work metadata'
	@echo 'inspect-views [SOCKET=name] — tmux frame locations and titles'
	@echo 'inspect-screen TARGET=frame-id [SOCKET=name] — last 40 visible terminal lines; private output'
	@echo 'update-fetch — fetch origin main for inspection without changing the checkout'
	@echo 'update-pull — fast-forward this checkout to the inspected origin/main'
	@echo 'provider-diagnose — report local provider metadata without credential values'
	@echo 'provider-backup — private backup of configuration and state; requires closed frames'
	@echo 'provider-migrate — migrate this checkout’s legacy OpenRouter key and shortlist through native Pi APIs; refuse credential conflicts'
	@echo 'provider-limit-output — cap the legacy shortlist and consultation models at 8192 output tokens in native Pi configuration'
	@echo 'provider-verify — verify credential equality, native shortlist, output limits and Git exclusion without showing secrets'
	@echo 'verify-picker — run the isolated native Pi model-picker integration test'
	@echo 'state-list — list root .state names, types and sizes without reading private contents'
	@echo 'provider-backup-remove BACKUP=provider-upgrade-timestamp — delete one explicitly named migration backup'
inspect-status:
	@node --disable-warning=ExperimentalWarning "$(ROOT)/dist/src/cli.js" status philby | node inspect.mjs status
inspect-views:
	@node inspect.mjs views
inspect-screen:
	@node inspect.mjs screen
.PHONY: update-fetch update-pull
update-fetch:
	@git -C "$(ROOT)" fetch origin main
update-pull:
	@git -C "$(ROOT)" merge --ff-only origin/main
.PHONY: provider-diagnose
provider-diagnose:
	@node provider-migrate.mjs diagnose
.PHONY: provider-backup
provider-backup:
	@node --disable-warning=ExperimentalWarning provider-migrate.mjs backup
.PHONY: provider-migrate
provider-migrate:
	@node --disable-warning=ExperimentalWarning provider-migrate.mjs migrate
.PHONY: provider-limit-output
provider-limit-output:
	@node --disable-warning=ExperimentalWarning provider-migrate.mjs limit-output
.PHONY: provider-verify
provider-verify:
	@node --disable-warning=ExperimentalWarning provider-migrate.mjs verify
.PHONY: verify-picker
verify-picker:
	@$(MAKE) --no-print-directory -C "$(ROOT)" build
	@cd "$(ROOT)" && node --test --test-name-pattern='native model shortlist' dist/tmux/test/tmux.test.js
.PHONY: state-list provider-backup-remove
export BACKUP
state-list:
	@node --disable-warning=ExperimentalWarning provider-migrate.mjs state-list
provider-backup-remove:
	@node --disable-warning=ExperimentalWarning provider-migrate.mjs backup-remove
.PHONY: openai-diagnose openai-shortlist frame-model
openai-diagnose:
	@node openai.mjs diagnose
openai-shortlist:
	@node openai.mjs shortlist
frame-model:
	@node openai.mjs select
