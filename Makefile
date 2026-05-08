.PHONY: up down logs build

DC := $(shell docker compose version > /dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

up:
	@sh start.sh

down:
	$(DC) -f docker-compose.yml down 2>/dev/null || true
	$(DC) -f docker-compose.standalone.yml down 2>/dev/null || true

logs:
	$(DC) logs -f 2>/dev/null || $(DC) -f docker-compose.standalone.yml logs -f

build:
	$(DC) build
