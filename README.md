# Project:Genesis

Visual kubectl workflow builder for Kubernetes. Drag commands onto a canvas, connect steps, configure parameters, and run them against your kubeconfig — with a live terminal, workflow groups, saved projects, and optional kube context switching.

Shipped as **one Go binary** with the React UI embedded via `embed`.

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

- [Go](https://go.dev/dl/) 1.26+
- [Node.js](https://nodejs.org/) 18+ and npm (build UI only)
- Working `~/.kube/config` and cluster access for kubectl commands

## Quick start

```bash
make setup
make run
```

Open **http://localhost:8787** — UI and API on same port.

Build distributable binary:

```bash
make build
./bin/genesis
```

Cross-compile example:

```bash
make build-frontend
cd backend && GOOS=windows GOARCH=amd64 go build -o ../bin/genesis.exe ./cmd/api
```

## Development

Hot reload with Vite + Go API:

```bash
make dev
```

- UI (dev): http://localhost:3310
- API: http://localhost:8787

## Makefile targets

| Target | Description |
|--------|-------------|
| `make setup` | Install Go + npm dependencies |
| `make build` | Build frontend + single `bin/genesis` binary |
| `make build-frontend` | Vite production build into `backend/web/dist` |
| `make run` | Build and run `bin/genesis` |
| `make dev` | Vite dev server + Go API (hot reload) |
| `make backend` | Go API only |
| `make frontend` | Vite dev server only |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `GENESIS_PORT` | `8787` | HTTP port (UI + API) |
| `GENESIS_DB_PATH` | — | Full path to SQLite file |
| `GENESIS_DATA_DIR` | `~/.genesis` | Data directory (uses `genesis.db` inside) |
| `GENESIS_FRONTEND_PORT` | `3310` | Vite dev port (`make dev` only) |

## How to use

1. Drag commands from the left palette onto the canvas.
2. Connect nodes (source → target) to define run order.
3. Click a node to edit parameters in the right panel.
4. **Projects** → **New Project** for blank canvas; **Save** to persist.
5. Optional: set **Kube Context** or enable global context in header.
6. Click **Run Workflow** or **Run** on a node / group.
7. Watch output in the bottom terminal.

## Architecture

```
┌─────────────────────────────────────┐
│  genesis binary                     │
│  ├─ embedded React UI (embed.FS)  │
│  ├─ REST API (/api/*)              │
│  ├─ client-go → ~/.kube            │
│  └─ SQLite → ~/.genesis/genesis.db │
└─────────────────────────────────────┘
```

**Frontend** — React, TypeScript, Vite, `@xyflow/react` (built into Go binary)

**Backend** — Go, gorilla/mux, `k8s.io/client-go`, pure-Go SQLite (`modernc.org/sqlite`)

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/commands/execute` | Run a catalog command |
| `POST` | `/api/commands/stream-pod-logs` | Stream pod logs |
| `GET`  | `/api/workflows` | List saved projects |
| `POST` | `/api/workflows` | Create project |
| `GET`  | `/api/workflows/{id}` | Load project |
| `PUT`  | `/api/workflows/{id}` | Update project |
| `DELETE` | `/api/workflows/{id}` | Delete project |

## Project layout

```
project-genesis/
├── Makefile
├── bin/genesis              # built binary
├── backend/
│   ├── cmd/api/main.go
│   ├── web/
│   │   ├── static.go        # //go:embed dist
│   │   └── dist/            # Vite output (embedded)
│   └── internal/
│       ├── handlers/
│       ├── k8s/
│       └── store/           # SQLite workflow projects
└── frontend/
    └── src/
```

## License

Private / personal project — add a license if you plan to publish.
