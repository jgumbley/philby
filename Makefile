define success
	@tput setaf 2; \
	echo ""; \
	owls="🦉 🦆 🦢 🐦 🦜"; \
	n=$$(expr $$(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 5 + 1); \
	owl=$$(echo $$owls | cut -d' ' -f$$n); \
	printf "%s > \033[33m%s\033[0m completed [OK]\n" "$$owl" "$(@)"; \
	tput sgr0;
endef

.PHONY: all clean readme prompt clean-% clean-history

all: task
	$(call success)

readme:
	@cat README.md
	$(call success)

task.txt:
	@cat README.md > task.txt
	@echo "---------------------------------------" >> task.txt
	@read -p "Enter your task: " user_input && \
	echo "---This is your task---" >> task.txt && \
	echo "$$user_input" >> task.txt
	$(call success)

task: task.txt
	. venv/bin/activate && \
	LLM_OPENROUTER_API_KEY=$$(cat .api.key) llm prompt "gemini-2.5-pro-exp-03-25" "$$(cat task.txt)" | python parse_llm_tool_call.py
	$(call success)

clean-task:
	rm task.txt
	$(call success)

venv: requirements.txt
	python3 -m venv venv
	. venv/bin/activate && \
	pip install -r requirements.txt
	$(call success)

clean:
	rm -Rf venv
	$(call success)

