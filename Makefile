# AgentPulse — Unified Lifecycle Commands (macOS / Linux / Windows Git Bash)
SHELL := /usr/bin/env bash

# Automatically pick a working Node >= 20 binary (handles Homebrew node@24/22/20 fallback)
NODE := $(shell \
  for b in "$$(command -v node 2>/dev/null)" /opt/homebrew/opt/node@24/bin/node /opt/homebrew/opt/node@22/bin/node /opt/homebrew/opt/node@20/bin/node /usr/local/bin/node; do \
    if [ -n "$$b" ] && [ -x "$$b" ] && "$$b" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" 2>/dev/null; then \
      echo "$$b"; break; \
    fi; \
  done)
NODE_DIR := $(dir $(NODE))
ENV_PATH := PATH="$(NODE_DIR):$(PATH)"

.PHONY: help install start start-demo stop restart status logs test launch

help:
	@echo ""
	@echo "  AgentPulse Commands:"
	@echo "    make install      Install dependencies and build server + dashboard"
	@echo "    make start        Start AgentPulse as a background daemon & open dashboard"
	@echo "    make start-demo   Start background daemon with simulated multi-agent swarms"
	@echo "    make stop         Stop the background daemon cleanly"
	@echo "    make restart      Restart the background daemon"
	@echo "    make status       Check daemon status, PID, port, and event count"
	@echo "    make logs         View recent daemon logs (including Models Identified)"
	@echo "    make test         Run typecheck and unit/integration test suite"
	@echo "    make launch       Open the interactive menu"
	@echo ""

install:
	@$(ENV_PATH) $(NODE) scripts/agentpulse-ctl.mjs install

start:
	@$(ENV_PATH) $(NODE) scripts/agentpulse-ctl.mjs start

start-demo:
	@$(ENV_PATH) $(NODE) scripts/agentpulse-ctl.mjs start --demo

stop:
	@$(ENV_PATH) $(NODE) scripts/agentpulse-ctl.mjs stop

restart:
	@$(ENV_PATH) $(NODE) scripts/agentpulse-ctl.mjs restart

status:
	@$(ENV_PATH) $(NODE) scripts/agentpulse-ctl.mjs status

logs:
	@$(ENV_PATH) $(NODE) scripts/agentpulse-ctl.mjs logs

test:
	@$(ENV_PATH) npm run typecheck && $(ENV_PATH) npm test

launch:
	@$(ENV_PATH) $(NODE) scripts/launch.mjs
