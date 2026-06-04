.PHONY: up down logs build update clean

DC := $(shell docker compose version > /dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
MODE := $(shell grep "^DEPLOY_MODE=" .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
MODE := $(if $(MODE),$(MODE),standalone)

ifeq ($(MODE),full)
  COMPOSE_FILE := docker-compose.yml
else
  COMPOSE_FILE := docker-compose.standalone.yml
endif

# Enable BuildKit — no intermediate containers, faster builds
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

up:
	@sh start.sh

down:
	$(DC) -f $(COMPOSE_FILE) down

logs:
	$(DC) -f $(COMPOSE_FILE) logs -f

build:
	$(DC) -f $(COMPOSE_FILE) build

update:
	$(DC) -f $(COMPOSE_FILE) down
	$(DC) -f $(COMPOSE_FILE) build --no-cache
	@sh start.sh

# Remove dangling images and stopped containers left by builds
clean:
	docker container prune -f
	docker image prune -f
	@echo "Cleaned up dangling containers and images."
