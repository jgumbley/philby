ifeq ($(MAKECMDGOALS),search)
MAKEFLAGS += --no-print-directory
endif
.PHONY: search
search: override MAKEOVERRIDES :=
search:
	@$(MAKE) --no-print-directory -s -C "$(ROOT)" build >&2
	@node --disable-warning=ExperimentalWarning "$(ROOT)/dist/src/cli.js" search
