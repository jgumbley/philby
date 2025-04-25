# Memory Makefile - Git wrapper for Philby's memory management

.PHONY: init commit status log id clean

# Default target
all: status
	@echo "Memory repository status shown above."

# Initialize the git repository if not already done
init:
	@if [ ! -d .git ]; then \
		git init; \
		git config user.name "Philby"; \
		git config user.email "philby@example.com"; \
		touch .gitkeep; \
		git add .gitkeep; \
		git commit -m "Initialize memory repository"; \
		echo "Memory repository initialized"; \
	else \
		echo "Memory repository already initialized"; \
	fi

# Save current state to memory (commit changes)
commit:
	@if [ ! -d .git ]; then \
		$(MAKE) init; \
	fi
	@git add -A
	@if git diff --cached --quiet; then \
		echo "No changes to commit"; \
	else \
		git commit -m "Save state $(shell date +%Y-%m-%d_%H:%M:%S)"; \
		echo "State saved with commit: $$(git rev-parse HEAD)"; \
	fi

# Generate ID from latest commit hash
id:
	@if [ ! -d .git ]; then \
		$(MAKE) init; \
	fi
	@git rev-parse HEAD 2>/dev/null || echo "no-commit"

# Show repository status
status:
	@if [ ! -d .git ]; then \
		echo "Memory repository not initialized"; \
		exit 1; \
	fi
	@git status

# Show commit history
log:
	@if [ ! -d .git ]; then \
		echo "Memory repository not initialized"; \
		exit 1; \
	fi
	@git log --oneline -n 10

# Clean up untracked files
clean:
	@if [ -d .git ]; then \
		git clean -fd; \
		echo "Cleaned untracked files"; \
	else \
		echo "Memory repository not initialized"; \
	fi