define success
	@tput setaf 2; \
	echo ""; \
	icons="🕵️ 🔒 📡 🗝️ 🥃"; \
	n=$$(expr $$(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 5 + 1); \
	icon=$$(echo $$icons | cut -d' ' -f$$n); \
	printf "%s > \033[33m%s\033[0m accomplished\n" "$$icon" "$(@)"; \
	printf "\033[90m{{{ %s | %s | user=%s | host=%s | procid=%s | parentproc=%s }}}\033[0m\n" "$$(date +%Y-%m-%d_%H:%M:%S)" "$$(whoami)" "$$(hostname)" "$$$$" "$$(ps -o ppid= -p $$$$)"; tput sgr0;
endef

define say
	. venv/bin/activate && \
		python say.py "$$(cat $(1))"
endef

.PHONY: step loop log sparkle fix digest ingest test test-dspy

all: loop
	$(call success)
	
sparkle:
	rm -f thinking.txt decision.txt prompt.txt
	$(call success)

log:
	. venv/bin/activate && llm logs
	$(call success)

api.key:
	$(error 'error missing api.key')

loop: action.txt
	@if [ -f done.txt ]; then \
		echo "Done marker found. Loop completed."; \
	else \
        rm -f action.txt thinking.txt prompt.txt \
        $(MAKE) loop; \
	fi
	$(call success)

task.txt:
	@read -p "Enter your task: " user_input && \
	echo "---This is your task---" >> task.txt && \
	echo "$$user_input" >> task.txt
	$(call success)

prompt.txt:
	cat README.md task.txt > prompt.txt
	$(call success)

thinking.txt: api.key task.txt venv prompt.txt
	$(call say,task.txt)
	. venv/bin/activate && \
	export LLM_GEMINI_KEY=$$(cat api.key) && \
	cat prompt.txt | llm prompt -c -m "gemini-2.5-pro-preview-03-25" | python gather.py thinking.txt
	$(call success)

decision.txt: venv thinking.txt
	. venv/bin/activate && \
	cat thinking.txt | python parse.py decision.txt
	git add .
	if ! git commit -t decision.txt; then \
		rm -f decision.txt; \
		exit 1; \
	fi
	$(call success)

action.txt: venv decision.txt
	@if grep -q "ask_handler" decision.txt; then \
		prompt=$$(cat decision.txt | grep -o '"prompt":"[^"]*"' | cut -d'"' -f4); \
		echo "$$prompt"; \
		read -p "> " user_response; \
		echo "$$user_response" > action.txt; \
	else \
		. venv/bin/activate && \
		python execute_decision.py decision.txt action.txt; \
	fi
	$(call success)

new:
	rm -f task.txt
	$(call success)

venv: requirements.txt
	python3 -m venv venv
	. venv/bin/activate && \
	pip install -r requirements.txt
	$(call success)

fix:
	claude "run makefile and fix"
	$(call success)

digest:
	@echo "=== Project Digest ==="
	@for file in $$(find . -type f -name "*.py" -o -name "*.md" -o -name "*.txt" -o -name "Makefile" | grep -v venv | grep -v __pycache__ | sort); do \
		echo ""; \
		echo "--- $$file ---"; \
		cat "$$file"; \
	done
	$(call success)

ingest:
	$(MAKE) digest | wl-copy
	$(call success)

test: venv
	. venv/bin/activate && \
	python test_parse_integration.py
	$(call success)

test-dspy: venv
	. venv/bin/activate && \
	python test_parse_integration.py --dspy-version
	$(call success)

clean: sparkle
	rm -Rf venv
	$(call success)

