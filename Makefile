define success
	@tput setaf 2; \
	echo ""; \
	owls="🦉 🦆 🦢 🐦 🦜"; \
	n=$$(expr $$(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 5 + 1); \
	owl=$$(echo $$owls | cut -d' ' -f$$n); \
	printf "%s > \033[33m%s\033[0m completed [OK]\n" "$$owl" "$(@)"; \
	tput sgr0;
endef

.PHONY: all clean html cleanblog aliases make readme

readme:
	@echo "Philby Coding Assistant" > README.txt
	@echo "=======================" >> README.txt
	@echo "" >> README.txt
	@echo "A minimalist LLM agent tool system." >> README.txt
	$(call success)

all: venv readme
	cat README.txt
	$(call success)

make: venv
	. venv/bin/activate && \
	LLM_GEMINI_KEY=$$(cat .api-key.txt) llm -m gemini-2.5-pro-exp-03-25 "$$(cat make-a-makefile.txt && echo '' && cat Makefile)" | python parse_llm_tool_call.py
	$(call success)

venv: requirements.txt
	python3 -m venv venv
	. venv/bin/activate && \
	pip install -r requirements.txt
	$(call success)

