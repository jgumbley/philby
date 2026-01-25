
update:
	$(MAKE) -f common.mk update

digest:
	$(MAKE) -f common.mk digest

ingest:
	$(MAKE) -f common.mk ingest

spec:
	$(MAKE) -f common.mk spec

spec-doc:
	$(MAKE) -f common.mk spec-doc

agent:
	$(MAKE) -f common.mk agent

test:
	$(MAKE) -f common.mk test

clean:
	$(MAKE) -f common.mk clean

sync:
	$(MAKE) -f common.mk sync

pane:
	$(MAKE) -f common.mk pane
