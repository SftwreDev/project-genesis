BACKEND_PORT ?= 8787
FRONTEND_PORT ?= 3310
POSTGRES_USER ?= genesis
POSTGRES_PASSWORD ?= genesis
POSTGRES_DB ?= genesis
POSTGRES_PORT ?= 5432

export GENESIS_PORT := $(BACKEND_PORT)
export GENESIS_BACKEND_PORT := $(BACKEND_PORT)
export GENESIS_FRONTEND_PORT := $(FRONTEND_PORT)
export VITE_BACKEND_PORT := $(BACKEND_PORT)
export DATABASE_URL := postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@localhost:$(POSTGRES_PORT)/$(POSTGRES_DB)?sslmode=disable

COMPOSE := docker compose

.PHONY: setup setup-backend setup-frontend backend frontend dev db-up db-down

setup: setup-backend setup-frontend
	@echo ""
	@echo "Setup complete."
	@echo "  make dev          local Go + Vite with Docker Postgres"
	@echo "  Frontend -> http://localhost:$(FRONTEND_PORT)"
	@echo "  Backend  -> http://localhost:$(BACKEND_PORT)"

setup-backend:
	@command -v go >/dev/null 2>&1 || (echo "Go is required: https://go.dev/dl/" && exit 1)
	cd backend && go mod download

setup-frontend:
	@command -v npm >/dev/null 2>&1 || (echo "Node/npm is required: https://nodejs.org/" && exit 1)
	cd frontend && npm install

db-up:
	$(COMPOSE) up postgres -d --wait

db-down:
	$(COMPOSE) stop postgres

backend: db-up
	cd backend && go run cmd/api/main.go

frontend:
	cd frontend && npm run dev

dev: db-up
	@echo "Frontend -> http://localhost:$(FRONTEND_PORT)"
	@echo "Backend  -> http://localhost:$(BACKEND_PORT)"
	$(MAKE) -j 2 backend-no-db frontend

backend-no-db:
	cd backend && go run cmd/api/main.go
