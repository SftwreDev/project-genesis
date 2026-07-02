# Project:Genesis

Visual kubectl workflow builder for Kubernetes. Drag commands onto a canvas, connect steps, configure parameters, and run them against your kubeconfig — with a live terminal, workflow groups, saved projects, and optional kube context switching.

## Features

- **Command library** — Pods, Deployments, Services, ConfigMaps, Nodes, Namespaces, taints/tolerations, and workflow tools (Delay, Schedule)
- **Visual canvas** — Connect nodes top-to-bottom; execution follows graph order
- **Saved projects** — Persist canvas workflows in SQLite (nodes, edges, groups, contexts)
- **Config panel** — Parameters, YAML editor (Tab/Shift+Tab indent), custom fields
- **Kube context** — Global + per-node `--context`; upstream context flows downstream
- **Namespace inheritance** — Namespace flows to connected downstream nodes
- **Workflow groups** — Multi-select nodes, save named groups, resize group area, run/ungroup/delete
- **Terminal** — Tabbed output, pause/stop/resume, resizable panel, colored log levels
- **Rich output** — Describe formatting, streaming pod logs

## Prerequisites

- Go 1.26+
- Node.js 18+ and npm
- Working `~/.kube/config` and cluster access for kubectl commands

## Quick start

```bash
make setup
make dev
```

Open **http://localhost:3310**

| Service  | Port | Description     |
|----------|------|-----------------|
| Frontend | 3310 | Vite dev server |
| Backend  | 8787 | Go API + `~/.kube` |

Projects stored at `~/.genesis/genesis.db`.

## Makefile targets

| Target | Description |
|--------|-------------|
| `make setup` | `go mod download` + `npm install` |
| `make dev` | Local backend + Vite |
| `make backend` | Go API only |
| `make frontend` | Vite dev server only |

## Environment

Copy `.env.example` to `.env` and adjust if needed:

| Variable | Default |
|----------|---------|
| `GENESIS_PORT` / `BACKEND_PORT` | `8787` |
| `GENESIS_FRONTEND_PORT` / `FRONTEND_PORT` | `3310` |
| `GENESIS_DB_PATH` | — (full path override) |
| `GENESIS_DATA_DIR` | `~/.genesis` |

## Architecture

```
┌──────────────┐   /api proxy   ┌─────────────┐   SQLite   ~/.genesis/
│ Vite + React │ ─────────────► │ Go API      │ ─────────► genesis.db
│ (:3310)      │                │ ~/.kube     │
└──────────────┘                └─────────────┘
```

## License

Private / personal project — add a license if you plan to publish.
