.PHONY: ask reason twitter
ask reason twitter:
	@$(MAKE) --no-print-directory -C "$(ROOT)" build
	@ROUTE=$@ node --disable-warning=ExperimentalWarning "$(ROOT)/dist/src/cli.js" consult
