# Project:Genesis

Visual kubectl workflow builder for Kubernetes. Drag commands onto a canvas, connect steps, configure parameters, and run them against your kubeconfig — with a live terminal, workflow groups, saved projects, and optional kube context switching.

## Features

- **Command library** — Pods, Deployments, Services, ConfigMaps, Nodes, Namespaces, taints/tolerations, and workflow tools (Delay, Schedule)
- **Visual canvas** — Connect nodes top-to-bottom; execution follows graph order
- **Saved projects** — Persist canvas workflows in PostgreSQL (nodes, edges, groups, contexts)
- **Config panel** — Parameters, YAML editor (Tab/Shift+Tab indent), custom fields
- **Kube context** — Global + per-node `--context`; upstream context flows downstream
- **Namespace inheritance** — Namespace flows to connected downstream nodes
- **Workflow groups** — Multi-select nodes, save named groups, resize group area, run/ungroup/delete
- **Terminal** — Tabbed output, pause/stop/resume, resizable panel, colored log levels
- **Rich output** — Describe formatting, streaming pod logs

## Prerequisites

- Go 1.26+
- Node.js 18+ and npm
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose v2 (PostgreSQL only)
- Working `~/.kube/config` and cluster access for kubectl commands

## Quick start

```bash
make setup
make dev
```

Open **http://localhost:3310**

| Service    | Port | Description        |
|------------|------|--------------------|
| Frontend   | 3310 | Vite dev server    |
| Backend    | 8787 | Go API + `~/.kube` |
| PostgreSQL | 5432 | Docker container   |

## Makefile targets

| Target | Description |
|--------|-------------|
| `make setup` | `go mod download` + `npm install` |
| `make dev` | Docker Postgres + local backend + Vite |
| `make db-up` | Start PostgreSQL container only |
| `make db-down` | Stop PostgreSQL container |
| `make backend` | Go API only (starts Postgres first) |
| `make frontend` | Vite dev server only |

## Environment

Copy `.env.example` to `.env` and adjust if needed:

| Variable | Default |
|----------|---------|
| `FRONTEND_PORT` | `3310` |
| `BACKEND_PORT` | `8787` |
| `POSTGRES_USER` | `genesis` |
| `POSTGRES_PASSWORD` | `genesis` |
| `POSTGRES_DB` | `genesis` |
| `POSTGRES_PORT` | `5432` |
| `DATABASE_URL` | `postgres://genesis:genesis@localhost:5432/genesis?sslmode=disable` |

## Architecture

```
┌──────────────┐   /api proxy   ┌─────────────┐   SQL    ┌────────────┐
│ Vite + React │ ─────────────► │ Go API      │ ───────► │ PostgreSQL │
│ (:3310)      │                │ ~/.kube     │          │ (Docker)   │
└──────────────┘                └─────────────┘          └────────────┘
```

## License

Private / personal project — add a license if you plan to publish.
