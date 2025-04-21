define success
	@tput setaf 2; \
	echo ""; \
	owls="🦉 🦆 🦢 🐦 🦜"; \
	n=$$(expr $$(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 5 + 1); \
	owl=$$(echo $$owls | cut -d' ' -f$$n); \
	printf "%s > \033[33m%s\033[0m completed [OK]\n" "$$owl" "$(@)"; \
	tput sgr0;
endef

.PHONY: all clean html cleanblog aliases make readme prompt task clean-%

all: venv agent-workflow
	$(call success)

readme:
	cat README.md
	$(call success)

prompt: venv
	@read -p "Enter your prompt: " user_input && \
	echo "$$user_input" > .prompt.txt && \
	cat workflow_context.txt && \
	. venv/bin/activate && \
	LLM_GEMINI_KEY=$$(cat .api-key.txt) llm -m gemini-2.5-pro-exp-03-25 "$$(cat workflow_context.txt && echo '\n\nUSER PROMPT:' && cat .prompt.txt)"
	$(call success)

task: venv
	@read -p "Enter your task: " user_input && \
	echo "$$user_input" > task && \
	cat workflow_context.txt && \
	. venv/bin/activate && \
	LLM_GEMINI_KEY=$$(cat .api-key.txt) llm -m gemini-2.5-pro-exp-03-25 "$$(cat workflow_context.txt && echo '\n\nUSER TASK:' && cat task)"
	$(call success)

# Pattern rule for cleaning any target
clean-%:
	@echo "Cleaning $*..."
	@rm -f $*
	$(call success)


make: venv
	. venv/bin/activate && \
	LLM_GEMINI_KEY=$$(cat .api-key.txt) llm -m gemini-2.5-pro-exp-03-25 "$$(cat make-a-makefile.txt && echo '' && cat Makefile)" | python parse_llm_tool_call.py
	$(call success)

# Automated agentic workflow without user interaction
agent-workflow: venv
	@echo "Starting automated agentic workflow..."
	. venv/bin/activate && \
	python -c 'import os; open("workflow_context.txt", "w").write("WORKFLOW CONTEXT:\n" + open("README.md").read())' && \
	. venv/bin/activate && \
	LLM_GEMINI_KEY=$$(cat .api-key.txt) llm -m gemini-2.5-pro-exp-03-25 "$$(cat workflow_context.txt)" | python parse_llm_tool_call.py > workflow_output.txt && \
	while true; do \
		cat workflow_output.txt >> workflow_history.txt; \
		LLM_GEMINI_KEY=$$(cat .api-key.txt) llm -m gemini-2.5-pro-exp-03-25 "$$(cat workflow_context.txt && echo '\n\nHISTORY:' && cat workflow_history.txt)" | python parse_llm_tool_call.py > workflow_output.txt; \
	done
	$(call success)

venv: requirements.txt
	python3 -m venv venv
	. venv/bin/activate && \
	pip install -r requirements.txt
	$(call success)

