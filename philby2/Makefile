.DEFAULT_GOAL := help

.PHONY: help tui run tui-image blue red pi pi-check codex codex-check
export UV_CACHE_DIR := $(CURDIR)/.uv-cache
export PI_CODING_AGENT_DIR := $(CURDIR)/.pi/agent
TUI_IMAGE ?= philby2-tui:local
TUI_VENV_VOLUME ?= philby2-tui-venv
TUI_UV_CACHE_VOLUME ?= philby2-tui-uv-cache

help:
	@echo "Targets:"
	@echo "  make tui        Run the Textual app locally"
	@echo "  make tui-image  Build the custom ttyd/Textual image"
	@echo "  make run        Run ttyd + Textual in the custom container at http://127.0.0.1:7681"
	@echo "  make pi         Launch the pi coding agent in this shell"
	@echo "  make pi-check   Verify pi is available in the Docker image"
	@echo "  make codex-check Verify codex is available in the Docker image"
	@echo "  make blue       Blue pill shell-out action (launches codex)"
	@echo "  make red        Red pill shell-out action (launches pi)"
	@echo "  make codex      shell out to codex to modify the agent code" 

include common.mk

codex:
	codex

tui: .venv/
	uv run python tui_app.py

tui-image:
	docker build -t $(TUI_IMAGE) -f Dockerfile.tui .

run: tui-image
	docker run --rm -i \
		-p 127.0.0.1:7681:7681 \
		-v "$$(pwd)":/workspace \
		-v "$(TUI_VENV_VOLUME)":/workspace/.venv \
		-v "$(TUI_UV_CACHE_VOLUME)":/workspace/.uv-cache \
		-w /workspace \
		$(TUI_IMAGE)

blue:
	@printf '\nBlue pill selected. Launching codex.\n\n'
	@$(MAKE) codex

pi:
	@pi

pi-check: tui-image
	docker run --rm -i \
		-e PI_CODING_AGENT_DIR=/tmp/pi/agent \
		-v "$$(pwd)":/workspace \
		-w /workspace \
		$(TUI_IMAGE) \
		/bin/sh -lc 'command -v pi && node --version && pi --help >/dev/null'

codex-check: tui-image
	docker run --rm -i \
		-v "$$(pwd)":/workspace \
		-w /workspace \
		$(TUI_IMAGE) \
		/bin/sh -lc 'command -v codex && codex --version >/dev/null'

red:
	@printf '\nRed pill selected. Launching pi coding agent.\n\n'
	@$(MAKE) pi
