.PHONY: up down logs build update clean _check_mode

DC := $(shell docker compose version > /dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
MODE := $(shell grep "^DEPLOY_MODE=" .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')

ifeq ($(MODE),full)
  COMPOSE_FILE := docker-compose.yml
else ifeq ($(MODE),standalone)
  COMPOSE_FILE := docker-compose.standalone.yml
else
  COMPOSE_FILE :=
endif

# Enable BuildKit — no intermediate containers, faster builds
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

_check_mode:
ifeq ($(COMPOSE_FILE),)
	@echo ""
	@echo "  ✖  ERROR: DEPLOY_MODE is not set in .env."
	@echo "     Set DEPLOY_MODE=standalone or DEPLOY_MODE=full."
	@echo ""
	@exit 1
endif

up:
	@sh start.sh

down: _check_mode
	$(DC) -f $(COMPOSE_FILE) down

logs: _check_mode
	$(DC) -f $(COMPOSE_FILE) logs -f

build: _check_mode
	$(DC) -f $(COMPOSE_FILE) build

update: _check_mode
	$(DC) -f $(COMPOSE_FILE) down
	$(DC) -f $(COMPOSE_FILE) build --no-cache
	@sh start.sh
	docker image prune -f

# Remove MailHSC containers, dangling images and build cache
clean: _check_mode
	$(DC) -f $(COMPOSE_FILE) rm -f 2>/dev/null || true
	docker image prune -f
	docker builder prune -f
	@echo "Cleaned up MailHSC containers, dangling images and build cache."
