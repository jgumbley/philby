.DEFAULT_GOAL := help
.DELETE_ON_ERROR:
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

export CMD

.PHONY: help holly holly-check
help:
	@echo 'holly — run a command on system@holly.smeg over SSH'
	@echo '  make holly CMD="hostname; uptime"'
	@echo '  echo "command" | make holly'
	@echo '  make holly                     # reads command from stdin'
	@echo '  HOLLY_HOST=user@host make holly CMD=...   # override target'
	@echo 'holly-check — verify SSH connectivity and report remote identity'

holly:
	@bash "$(CURDIR)/holly.sh" $(if $(CMD),$(CMD))

holly-check:
	@bash "$(CURDIR)/holly.sh" 'echo CONNECTED; hostname; uptime'
