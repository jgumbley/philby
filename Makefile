
update:
	$(MAKE) -f common.mk update

digest:
	$(MAKE) -f common.mk digest

ingest:
	$(MAKE) -f common.mk ingest

clean:
	$(MAKE) -f common.mk clean

sync:
	$(MAKE) -f common.mk sync

agent-%:
	$(MAKE) -f common.mk $@
