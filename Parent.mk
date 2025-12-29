include common.mk

.PHONY: rocknix tiefighter tiefighter-media

rocknix:
	@set -eu; \
	image="ghcr.io/rocknix/rocknix-build:latest"; \
	echo "Pulling $$image"; \
	docker pull "$$image"; \
	echo ""; \
	echo "Starting $$image (mounting $(CURDIR) at /work)"; \
	docker run --rm -it -P \
		-v "$(CURDIR):/work" \
		-w /work \
		"$$image"
	$(call success)

tiefighter:
	@set -eu; \
	if [ ! -f "./tiefighter.iso" ]; then \
		echo "Missing ./tiefighter.iso"; \
		echo "Run: make tiefighter-media ISO_SRC=\"/path/to/TIE Fighter Collector's CD-ROM.iso\""; \
		exit 2; \
	fi; \
	image="jgoerzen/dosbox:latest"; \
	echo "Pulling $$image"; \
	docker pull "$$image"; \
	echo ""; \
	echo "Starting $$image"; \
	echo " - Mounting $(CURDIR) at /dos/drive_c"; \
	echo " - VNC server: localhost:5901 (password: tiefighter)"; \
	echo ""; \
	echo "Inside DOSBox, mount the ISO and switch to the CD drive:"; \
	echo "  IMGMOUNT D /dos/drive_c/tiefighter.iso -t iso"; \
	echo "  D:"; \
	echo "  DIR"; \
	echo ""; \
	docker run --rm \
		-p 5901:5901 \
		-v "$(CURDIR):/dos/drive_c" \
		-e VNCPASSWORD="tiefighter" \
		"$$image"
	$(call success)

tiefighter-media:
	@set -eu; \
	if [ -z "$(ISO_SRC)" ]; then \
		echo "Usage: make tiefighter-media ISO_SRC=\"/path/to/TIE Fighter Collector's CD-ROM.iso\""; \
		exit 2; \
	fi; \
	src="$(ISO_SRC)"; \
	dest="./tiefighter.iso"; \
	if [ -e "$$dest" ]; then \
		echo "Refusing to overwrite $$dest"; \
		exit 1; \
	fi; \
	if [ ! -f "$$src" ]; then \
		echo "Missing ISO at: $$src"; \
		exit 2; \
	fi; \
	echo "Copying ISO to $$dest"; \
	cp "$$src" "$$dest"
	$(call success)
