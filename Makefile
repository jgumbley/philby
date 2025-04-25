define success
	@tput setaf 2; \
	echo ""; \
	owls="🦉 🦆 🦢 🐦 🦜"; \
	n=$$(expr $$(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 5 + 1); \
	owl=$$(echo $$owls | cut -d' ' -f$$n); \
	printf "%s > \033[33m%s\033[0m completed [OK]\n" "$$owl" "$(@)"; \
	id_content=$$(cat id.txt 2>/dev/null || echo "no-id"); \
	printf "{{{ %s | %s | user=%s | host=%s | procid=%s | parentproc=%s }}}\n" "$$(date +%Y-%m-%d_%H:%M:%S)" "$$id_content" "$$(whoami)" "$$(hostname)" "$$$$" "$$(ps -o ppid= -p $$$$)"; \
	echo "---"; \
	tput sgr0;
endef

define say
	. venv/bin/activate && \
		python say.py "$$(cat $(1))"
endef

.PHONY: clean clean-% save_xml step loop

all: loop
	$(call success)

step: action.txt
	rm -f thinking.txt
	rm -f prompt.txt
	rm -f id.txt
	$(call success)
	
loop: step
	@if [ -f done.txt ]; then \
		echo "Done marker found. Loop completed."; \
	else \
		cat action.txt; \
		read -p "Authorise? [y/N] " answer; \
		if [ "$${answer}" = "y" ]; then \
			$(MAKE) loop; \
		fi; \
	fi
	$(call success)

save_history:
	. venv/bin/activate && \
	python save_history.py task.txt id.txt prompt.txt thinking.txt action.txt > history.xml
	$(call success)
	
make.txt:
	man make > make.txt
	$(call success)

task.txt:
	@read -p "Enter your task: " user_input && \
	echo "---This is your task---" >> task.txt && \
	echo "$$user_input" >> task.txt
	$(call success)

prompt.txt:
	cat README.md make.txt task.txt > prompt.txt
	$(call success)

thinking.txt: make.txt task.txt venv prompt.txt
	$(call say,task.txt)
	. venv/bin/activate && \
	export LLM_GEMINI_KEY=$$(cat api_key.txt) && \
	cat prompt.txt | llm prompt -m "gemini-2.5-pro-preview-03-25" | python gather.py thinking.txt
	$(call success)

action.txt: venv thinking.txt
	. venv/bin/activate && \
	cat thinking.txt | python parse.py action.txt
	$(call success)

new:
	rm -f task.txt
	$(call success)

venv: requirements.txt
	python3 -m venv venv
	. venv/bin/activate && \
	pip install -r requirements.txt
	$(call success)

id.txt: venv
	. venv/bin/activate && \
	python generate_id.py id.txt
	$(call success)

history.txt: venv
	. venv/bin/activate && \
	python summarize_history.py > history.txt
	$(call success)

clean:
	rm -Rf venv
	rm make.txt
	$(call success)

