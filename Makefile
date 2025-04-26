define success
	@tput setaf 2; \
	echo ""; \
	owls="🦉 🦆 🦢 🐦 🦜"; \
	n=$$(expr $$(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 5 + 1); \
	owl=$$(echo $$owls | cut -d' ' -f$$n); \
	printf "%s > \033[33m%s\033[0m done\n" "$$owl" "$(@)"; \
	id_content=$$(cat id.txt 2>/dev/null || echo "no-id"); \
	printf "\033[90m{{{ %s | %s | user=%s | host=%s | procid=%s | parentproc=%s }}}\033[0m\n" "$$(date +%Y-%m-%d_%H:%M:%S)" "$$id_content" "$$(whoami)" "$$(hostname)" "$$$$" "$$(ps -o ppid= -p $$$$)"; \
	echo "---"; \
	tput sgr0;
endef

define say
	. venv/bin/activate && \
		python say.py "$$(cat $(1))"
endef

.PHONY: clean clean-% step loop memory save_history

all: loop
	$(call success)

memory/.git:
	mkdir -p memory
	$(MAKE) -C memory init
	$(call success)

step: action.txt
	rm -f action.txt thinking.txt prompt.txt
	$(call success)
	
loop: step
	@if [ -f done.txt ]; then \
		echo "Done marker found. Loop completed."; \
	else \
		cat decision.txt; \
		read -p "Authorise? [y/N] " answer; \
		if [ "$${answer}" = "y" ]; then \
			$(MAKE) loop; \
		fi; \
	fi
	$(call success)

save_history: memory/.git
	cp thinking.txt memory/thinking.txt
	cp task.txt memory/task.txt
	cp prompt.txt memory/prompt.txt
	cp action.txt memory/action.txt
	$(MAKE) -C memory commit
	$(MAKE) -C memory id > id.txt
	$(call success)
	
task.txt:
	@read -p "Enter your task: " user_input && \
	echo "---This is your task---" >> task.txt && \
	echo "$$user_input" >> task.txt
	$(call success)

prompt.txt:
	cat README.md task.txt > prompt.txt
	$(call success)

thinking.txt: make.txt task.txt venv prompt.txt
	$(call say,task.txt)
	. venv/bin/activate && \
	export LLM_GEMINI_KEY=$$(cat api_key.txt) && \
	cat prompt.txt | llm prompt -m "gemini-2.5-pro-preview-03-25" | python gather.py thinking.txt
	$(call success)

decision.txt: venv thinking.txt
	. venv/bin/activate && \
	cat thinking.txt | python parse.py decision.txt
	$(call success)

action.txt: venv decision.txt
	@if grep -q "ask_handler" decision.txt; then \
		prompt=$$(cat decision.txt | grep -o '"prompt":"[^"]*"' | cut -d'"' -f4); \
		echo "$$prompt"; \
		read -p "> " user_response; \
		echo "$$user_response" > action.txt; \
	else \
		. venv/bin/activate && \
		python mcp_client.py decision.txt > action.txt; \
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

id.txt: memory/.git
	$(MAKE) -C memory id > id.txt
	$(call success)

history.txt: venv
	. venv/bin/activate && \
	python summarize_history.py > history.txt
	$(call success)

clean:
	rm -Rf venv
	rm make.txt
	$(call success)

