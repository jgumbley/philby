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
		python say.py "$$(cat task.txt)"
endef

.PHONY: all clean readme prompt clean-% clean-history save_xml

all: task
	$(call success)

make.txt:
	man make > make.txt
	$(call success)

readme:
	@cat README.md
	$(call success)

task.txt:
	@read -p "Enter your task: " user_input && \
	echo "---This is your task---" >> task.txt && \
	echo "$$user_input" >> task.txt
	$(call success)

task: make.txt task.txt venv
	$(call say)
	. venv/bin/activate && \
	export LLM_GEMINI_KEY=$$(cat api_key.txt) && \
	cat make.txt README.md task.txt | llm prompt -m "gemini-2.5-pro-exp-03-25" | python gather.py thinking.txt
	$(call success)

clean-task:
	rm task.txt
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

save_xml: venv task.txt id.txt
	. venv/bin/activate && \
	cat thinking.txt | python save_history.py > history.xml
	$(call success)

clean:
	rm -Rf venv
	rm make.txt
	$(call success)

