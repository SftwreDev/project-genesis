BACKEND_PORT ?= 8787
FRONTEND_PORT ?= 3310
BIN_DIR := bin
BINARY := $(BIN_DIR)/genesis

export GENESIS_PORT := $(BACKEND_PORT)
export GENESIS_BACKEND_PORT := $(BACKEND_PORT)
export GENESIS_FRONTEND_PORT := $(FRONTEND_PORT)
export VITE_BACKEND_PORT := $(BACKEND_PORT)

.PHONY: setup setup-backend setup-frontend build-frontend build run dev backend frontend

setup: setup-backend setup-frontend
	@echo ""
	@echo "Setup complete."
	@echo "  make build    build single genesis binary (UI embedded)"
	@echo "  make run      build + run genesis on :$(BACKEND_PORT)"
	@echo "  make dev      hot-reload Vite + Go API"

setup-backend:
	@command -v go >/dev/null 2>&1 || (echo "Go is required: https://go.dev/dl/" && exit 1)
	cd backend && go mod download

setup-frontend:
	@command -v npm >/dev/null 2>&1 || (echo "Node/npm is required: https://nodejs.org/" && exit 1)
	cd frontend && npm install

build-frontend:
	cd frontend && npm run build

build: build-frontend
	@mkdir -p $(BIN_DIR)
	cd backend && go build -o ../$(BINARY) ./cmd/api
	@echo ""
	@echo "Built $(BINARY)"

run: build
	./$(BINARY)

backend:
	cd backend && go run ./cmd/api

frontend:
	cd frontend && npm run dev

dev:
	@echo "Dev mode: Vite -> http://localhost:$(FRONTEND_PORT), API -> http://localhost:$(BACKEND_PORT)"
	$(MAKE) -j 2 backend frontend
