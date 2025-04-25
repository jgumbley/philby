define success
	@tput setaf 2; \
	echo ""; \
	owls="🦉 🦆 🦢 🐦 🦜"; \
	n=$$(expr $$(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 5 + 1); \
	owl=$$(echo $$owls | cut -d' ' -f$$n); \
	printf "%s > \033[33m%s\033[0m completed [OK]\n" "$$owl" "$(@)"; \
	tput sgr0;
endef

define say
	. venv/bin/activate && \
		python say.py "$$(cat $(1))"
endef

.PHONY: done clean clean-% clean-history save_xml

done: done.txt
	$(call say,done.txt)
	$(call success)

done.txt: save_xml
	ps
	make
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

thinking.txt: make.txt task.txt venv prompt.txt
	$(call say,task.txt)
	. venv/bin/activate && \
	export LLM_GEMINI_KEY=$$(cat api_key.txt) && \
	cat prompt.txt | llm prompt -m "gemini-2.5-pro-preview-03-25" | python gather.py thinking.txt
	$(call success)

clean-task:
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

action.txt: venv thinking.txt
	. venv/bin/activate && \
	cat thinking.txt | python parse.py action.txt
	$(call success)

save_xml: venv action.txt
	. venv/bin/activate && \
	python save_history.py task.txt id.txt prompt.txt thinking.txt action.txt > history.xml
	rm -f id.txt
	rm -f prompt.txt
	rm -f thinking.txt
	rm -f action.txt
	$(call success)

clean:
	rm -Rf venv
	rm make.txt
	$(call success)

