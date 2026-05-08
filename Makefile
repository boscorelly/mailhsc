.PHONY: up down logs build

up:
	@sh start.sh

down:
	docker compose -f docker-compose.yml down 2>/dev/null || true
	docker compose -f docker-compose.standalone.yml down 2>/dev/null || true

logs:
	docker compose logs -f 2>/dev/null || docker compose -f docker-compose.standalone.yml logs -f

build:
	docker compose build
