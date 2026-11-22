.PHONY: pane-start pane-list pane-stop
pane-start pane-stop: override export PANE := $(value PANE)
pane-start: override export TARGET := $(value TARGET)
pane-start: override export PANE_SOURCE := $(value PANE_SOURCE)
pane-start pane-list pane-stop: override MAKEOVERRIDES :=
pane-start pane-list pane-stop:
	@$(MAKE) --no-print-directory -s -C "$(ROOT)" build
	@node --disable-warning=ExperimentalWarning "$(ROOT)/dist/src/cli.js" $@
