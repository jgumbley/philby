.DEFAULT_GOAL := help
.DELETE_ON_ERROR:
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

WORLD := /home/system/wip/eaadwig/eaadwig-world
TOOLKIT := /home/system/wip/eaadwig/openmw-worldbuilding
LAUNCHER := $(HOME)/.local/bin/eaadwig-play
OPENMW := /opt/games/openmw/current/bin/openmw
SCENE ?= scriptorium
STORYBOARD ?= buildwas

export SCENE

.PHONY: help play status storyboard
help:
	@echo 'play SCENE=scriptorium — launch the eaadwig world game fullscreen on its screen'
	@echo '  scenes: scriptorium (default), buildwas_riverside, hanley_mill, arley_passage'
	@echo 'status — verify launcher, world, OpenMW binary and display setup'
	@echo 'storyboard STORYBOARD=buildwas — open the curses storyboard review TUI as its own tmux window'

play:
	@test -x "$(LAUNCHER)" || { echo "missing launcher: $(LAUNCHER)" >&2; exit 1; }
	@test -d "$(WORLD)" || { echo "missing world: $(WORLD)" >&2; exit 1; }
	@exec "$(LAUNCHER)" "$(SCENE)"

storyboard:
	@test -n "$$TMUX" || { echo "storyboard must run inside tmux" >&2; exit 1; }
	@test -d "$(TOOLKIT)" || { echo "missing toolkit: $(TOOLKIT)" >&2; exit 1; }
	@test -d "$(WORLD)/notes/storyboards/$(STORYBOARD)" || { echo "missing storyboard: $(WORLD)/notes/storyboards/$(STORYBOARD)" >&2; exit 1; }
	tmux set-option -g allow-passthrough on
	tmux new-window -t "$$(tmux display-message -p '#{session_name}:')" -n storyboard -c "$(TOOLKIT)" "env TMUX=\$$TMUX TMUX_PANE=\$$TMUX_PANE $(MAKE) -C $(TOOLKIT) storyboard-review WORLD=$(WORLD) STORYBOARD=$(STORYBOARD)"

status:
	@echo "launcher: $(if $(wildcard $(LAUNCHER)),$(LAUNCHER),MISSING)"
	@echo "world:    $(if $(wildcard $(WORLD)/Makefile),$(WORLD),MISSING)"
	@echo "openmw:   $(if $(wildcard $(OPENMW)),$(OPENMW),MISSING)"
	@echo "scenes:   $$(python3 -c 'import json;print(", ".join(json.load(open("$(WORLD)/game.json"))["scenes"]))')"
	@echo "storyboards: $$(ls "$(WORLD)/notes/storyboards" 2>/dev/null | tr '\n' ' ')"
	@swaymsg -t get_outputs 2>/dev/null | python3 -c 'import json,sys; [print("output:   "+o["name"]+" "+str(o["rect"]["width"])+"x"+str(o["rect"]["height"])) for o in json.load(sys.stdin) if o.get("active")]' || echo "output:   sway unavailable"
