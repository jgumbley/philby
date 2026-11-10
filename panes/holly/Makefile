.DEFAULT_GOAL := help
.PHONY: help publish pull push-creds
help:
	@echo 'publish — publish the local philby HEAD and gitignored creds to holly.smeg:~/wip/philby (fast-forward only, git bundle + tar over SSH)'
	@echo 'pull — pull in-progress philby work from holly.smeg:~/wip/philby into the local repo (fast-forward only, code-only, via git bundle over SSH)'
	@echo 'push-creds — push gitignored root profiles/.env (provider creds) to holly over SSH; never via git'
publish: push-creds
	@bash push.sh
pull:
	@bash pull.sh
push-creds:
	@bash push-creds.sh
