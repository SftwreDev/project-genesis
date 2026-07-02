BACKEND_PORT ?= 8787
FRONTEND_PORT ?= 3310

export GENESIS_PORT := $(BACKEND_PORT)
export GENESIS_BACKEND_PORT := $(BACKEND_PORT)
export GENESIS_FRONTEND_PORT := $(FRONTEND_PORT)
export VITE_BACKEND_PORT := $(BACKEND_PORT)

.PHONY: setup setup-backend setup-frontend backend frontend dev

setup: setup-backend setup-frontend
	@echo ""
	@echo "Setup complete."
	@echo "  make dev          start backend + frontend"
	@echo "  Frontend -> http://localhost:$(FRONTEND_PORT)"
	@echo "  Backend  -> http://localhost:$(BACKEND_PORT)"

setup-backend:
	@command -v go >/dev/null 2>&1 || (echo "Go is required: https://go.dev/dl/" && exit 1)
	cd backend && go mod download

setup-frontend:
	@command -v npm >/dev/null 2>&1 || (echo "Node/npm is required: https://nodejs.org/" && exit 1)
	cd frontend && npm install

backend:
	cd backend && go run cmd/api/main.go

frontend:
	cd frontend && npm run dev

dev:
	@echo "Frontend -> http://localhost:$(FRONTEND_PORT)"
	@echo "Backend  -> http://localhost:$(BACKEND_PORT)"
	$(MAKE) -j 2 backend frontend
