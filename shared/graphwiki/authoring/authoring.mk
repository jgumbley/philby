GRAPHWIKI_AUTHORING := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
GRAPHWIKI_SHARED := $(abspath $(GRAPHWIKI_AUTHORING)/../..)
override GRAPH_ROOT := $(CURDIR)/wiki
export GRAPH_ROOT
.PHONY: context publish index lint editorial-check
context index:
	@$(MAKE) --no-print-directory -f "$(GRAPHWIKI_SHARED)/Makefile" wiki-$@ GRAPH_ROOT="$$GRAPH_ROOT"
publish:
	@$(MAKE) --no-print-directory editorial-check
	@$(MAKE) --no-print-directory -f "$(GRAPHWIKI_SHARED)/Makefile" wiki-publish GRAPH_ROOT="$$GRAPH_ROOT"

export CHANGE
editorial-check:
	@node "$(GRAPHWIKI_AUTHORING)/editorial.mjs"
lint:
	@$(MAKE) --no-print-directory -f "$(GRAPHWIKI_SHARED)/Makefile" wiki-lint GRAPH_ROOT="$$GRAPH_ROOT"
	@$(MAKE) --no-print-directory editorial-check CHANGE=
