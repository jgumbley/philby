
update:
	$(MAKE) -f common.mk update

digest:
	$(MAKE) -f common.mk digest

ingest:
	$(MAKE) -f common.mk ingest

clean:
	$(MAKE) -f common.mk clean

agent-%:
	$(MAKE) -f common.mk $@
