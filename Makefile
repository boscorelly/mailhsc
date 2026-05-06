.PHONY: up down logs build

up:
	@sh start.sh

down:
	docker compose down

logs:
	docker compose logs -f

build:
	docker compose build
