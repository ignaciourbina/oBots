include .env
export

VENV_BIN := $(CURDIR)/.venv/bin
OTREE_PROJECT_DIR ?= otree_project
OTREE_PORT ?= auto
OTREE_LOG_DIR ?= /tmp/otree-bots
OTREE_DB_DIR ?= /tmp/otree-bots
OTREE_ISOLATE_DB ?= 1
OTREE_CREATE_SESSION ?= 1
OTREE_SESSION_CONFIG ?= stress_multi_app_suite

.PHONY: help run dev build clean test lint watch otree up package package-win package-linux

help:
	@echo "Available targets:"
	@echo "  help         Show this help message"
	@echo "  run          Run bots against OTREE_SESSION_URL"
	@echo "  dev          Run bots with verbose logging"
	@echo "  otree        Start oTree devserver"
	@echo "  up           Start oTree + launch Electron app"
	@echo "  build        Build TypeScript and renderer assets"
	@echo "  watch        Run TypeScript watch mode"
	@echo "  test         Run tests"
	@echo "  lint         Run type-check (no emit)"
	@echo "  clean        Remove build artifacts"
	@echo "  package      Package Electron app for current platform"
	@echo "  package-linux Package Electron app for Linux"
	@echo "  package-win  Package Electron app for Windows"

# Run bots against the session URL from .env
run: build
	npx electron dist/main/index.js -- --url $(OTREE_SESSION_URL) -n $(OTREE_PLAYERS)

# Run with verbose logging
dev: build
	npx electron dist/main/index.js -- --url $(OTREE_SESSION_URL) -n $(OTREE_PLAYERS) --verbose

# Start oTree devserver with venv PATH correctly set
otree:
	@set -e; \
	PORT="$(OTREE_PORT)"; \
	if [ "$$PORT" = "auto" ]; then \
		PORT="$$(PATH="$(VENV_BIN):$$PATH" python -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"; \
	fi; \
	echo "[otree] starting devserver on port $$PORT"; \
	cd $(OTREE_PROJECT_DIR) && PATH="$(VENV_BIN):$$PATH" otree devserver "$$PORT"

# One-command workflow: start oTree + launch Electron app
# Stops oTree automatically when the Electron app exits.
up: build
	@set -e; \
	RUN_LABEL="$${RUN_ID:-$$(date +%Y%m%d-%H%M%S)-$$$$}"; \
	PORT="$(OTREE_PORT)"; \
	if [ "$$PORT" = "auto" ]; then \
		PORT="$$(PATH="$(VENV_BIN):$$PATH" python -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"; \
	fi; \
	mkdir -p "$(OTREE_LOG_DIR)" "$(OTREE_DB_DIR)"; \
	LOG_FILE="$(OTREE_LOG_DIR)/otree-devserver-$$RUN_LABEL-$$PORT.log"; \
	DB_URL=""; \
	if [ "$(OTREE_ISOLATE_DB)" = "1" ]; then \
		DB_FILE="$(OTREE_DB_DIR)/otree-$$RUN_LABEL.sqlite3"; \
		DB_URL="sqlite:////$$DB_FILE"; \
	fi; \
	cd $(OTREE_PROJECT_DIR); \
	if [ -n "$$DB_URL" ]; then export OTREE_DATABASE_URL="$$DB_URL"; fi; \
	PATH="$(VENV_BIN):$$PATH" otree devserver "$$PORT" > "$$LOG_FILE" 2>&1 & \
	OTREE_PID=$$!; \
	cd ..; \
	trap 'kill $$OTREE_PID 2>/dev/null || true' EXIT INT TERM; \
	sleep 2; \
	RUN_URL="$(OTREE_SESSION_URL)"; \
	if [ "$(OTREE_CREATE_SESSION)" = "1" ]; then \
		cd "$(OTREE_PROJECT_DIR)"; \
		if [ -n "$$DB_URL" ]; then export OTREE_DATABASE_URL="$$DB_URL"; fi; \
		CREATE_OUT="$$(PATH="$(VENV_BIN):$$PATH" otree create_session "$(OTREE_SESSION_CONFIG)" "$(OTREE_PLAYERS)")"; \
		echo "$$CREATE_OUT"; \
		SESSION_CODE="$$(printf "%s\n" "$$CREATE_OUT" | awk '/Created session with code/{print $$5; exit}')"; \
		if [ -z "$$SESSION_CODE" ]; then \
			echo "[up] failed to parse session code from create_session output"; \
			exit 1; \
		fi; \
		RUN_URL="http://localhost:$$PORT/join/$$SESSION_CODE"; \
		cd ..; \
		else \
			if [ -z "$$RUN_URL" ]; then \
				echo "[up] OTREE_SESSION_URL is empty and OTREE_CREATE_SESSION=0"; \
				exit 1; \
			fi; \
			RUN_URL="$$(PATH="$(VENV_BIN):$$PATH" python -c 'import sys; from urllib.parse import urlparse, urlunparse; url=sys.argv[1]; port=sys.argv[2]; p=urlparse(url); is_local=(p.scheme in (\"http\",\"https\") and p.hostname in (\"localhost\",\"127.0.0.1\")); print(urlunparse((p.scheme, p.hostname+\":\"+str(port), p.path, p.params, p.query, p.fragment)) if is_local else url)' "$$RUN_URL" "$$PORT")"; \
		fi; \
	echo "[up] run_id=$$RUN_LABEL port=$$PORT"; \
	echo "[up] otree_log=$$LOG_FILE"; \
	echo "[up] url=$$RUN_URL"; \
	npx electron dist/main/index.js -- --url "$$RUN_URL" -n "$(OTREE_PLAYERS)"

# Build TypeScript + copy renderer assets
build:
	npm run build

# Watch mode (TypeScript only)
watch:
	npm run watch

# Run tests
test:
	npm run test

# Type-check without emitting
lint:
	npm run lint

# Remove build artifacts
clean:
	rm -rf dist

# Package Electron app for the current platform
package: build
	npx electron-builder

# Package Electron app for Linux (AppImage + deb)
package-linux: build
	npx electron-builder --linux

# Package Electron app for Windows (.exe installer)
package-win: build
	npx electron-builder --win
