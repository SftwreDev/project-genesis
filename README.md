# Project:Genesis

Visual kubectl workflow builder for Kubernetes. Drag commands onto a canvas, connect steps, configure parameters, and run them against your local kubeconfig — with a live terminal, workflow groups, and optional kube context switching.

## Features

- **Command library** — Pods, Deployments, Services, ConfigMaps, Nodes, Namespaces, taints/tolerations, and workflow tools (Delay, Schedule)
- **Visual canvas** — Connect nodes top-to-bottom; execution follows graph order
- **Config panel** — Parameters, YAML editor (Tab/Shift+Tab indent), custom fields
- **Kube context** — Optional `--context` per card; upstream context flows to connected downstream nodes
- **Namespace** — Use a namespace name or `--all-namespaces` / `-A` / `all` / `*` on list commands
- **Workflow groups** — Multi-select nodes, save named groups, resize group area, run/ungroup/delete from canvas
- **Terminal** — Tabbed output, re-runs reuse same tab per workflow topology, resizable panel
- **Rich output** — Describe formatting, streaming pod logs

## Prerequisites

- [Go](https://go.dev/dl/) 1.26+
- [Node.js](https://nodejs.org/) 18+ and npm
- A working `~/.kube/config` and access to a cluster (minikube, kind, Docker Desktop, etc.)

Verify cluster access:

```bash
kubectl get nodes
```

## Quick start

**Fresh machine — install dependencies:**

```bash
make setup
```

**Run backend + frontend:**

```bash
make dev
```

Open the UI at **http://localhost:3310**.

Default ports (chosen to avoid common 3000/8080 conflicts):

| Service  | Port  |
|----------|-------|
| Frontend | 3310  |
| Backend  | 8787  |

Override ports:

```bash
make dev BACKEND_PORT=8888 FRONTEND_PORT=3400
```

## Makefile targets

| Target            | Description                          |
|-------------------|--------------------------------------|
| `make setup`      | `go mod download` + `npm install`    |
| `make dev`        | Start backend and frontend together  |
| `make backend`    | Go API only                          |
| `make frontend`   | Vite dev server only                 |

## How to use

1. Drag commands from the left palette onto the canvas.
2. Connect nodes (source → target) to define run order.
3. Click a node to edit parameters in the right panel.
4. Optional: set **Kube Context** (e.g. `test-prod`) on a node; downstream connected nodes inherit it at run time.
5. Optional: set **Namespace** to `default`, a namespace name, or `--all-namespaces` for list commands.
6. Click **Run Workflow** (full canvas) or **Run** on a single node / group.
7. Watch output in the bottom terminal.

### Workflow groups

1. Open **Group** in the header → enable selection mode.
2. Drag-select or Shift+click nodes.
3. Name the group and **Save Group**.
4. Run the group from the header menu or from the group box on the canvas.
5. Drag the bottom-right corner of a group box to resize the highlighted area.

### Workflow tools

- **Delay** — Pause before the next step; shows a live countdown on the card.
- **Schedule** — When placed as the workflow entry (no incoming edge), **Run Workflow** waits until the scheduled time.

## Architecture

```
┌─────────────────┐     /api proxy      ┌──────────────────┐
│  React + Vite   │ ──────────────────► │  Go API (:8787)  │
│  @xyflow/react  │                     │  client-go       │
│  (:3310)        │                     │  ~/.kube/config  │
└─────────────────┘                     └──────────────────┘
```

**Frontend** (`frontend/`)

- React, TypeScript, Vite, `@xyflow/react`
- Command catalog, canvas, config panel, execution terminal
- Proxies `/api` to the Go backend during dev

**Backend** (`backend/`)

- Go, gorilla/mux, `k8s.io/client-go`
- Reads local kubeconfig; supports per-request `--context` override
- Unified command executor + streaming pod logs

## API (dev)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/commands/execute` | Run a catalog command |
| `POST` | `/api/commands/stream-pod-logs` | Stream pod logs |
| `GET`  | `/api/pods` | List pods (legacy) |
| `POST` | `/api/pods/create` | Create pod (legacy) |

Execute payload example:

```json
{
  "command": "list-pods",
  "params": {
    "namespace": "--all-namespaces",
    "context": "minikube"
  }
}
```

## Project layout

```
project-genesis/
├── Makefile
├── backend/
│   ├── cmd/api/main.go
│   └── internal/
│       ├── handlers/     # HTTP handlers, command implementations
│       └── k8s/          # kubeconfig client helpers
└── frontend/
    ├── src/
    │   ├── components/   # Canvas, palette, terminal, config panel
    │   ├── data/         # Command catalog
    │   └── utils/        # Execution, YAML, workflow logic
    └── vite.config.ts
```

## Development notes

- Backend uses the **current kubeconfig context** by default; pass `context` in params to switch per command.
- `--all-namespaces` is supported on **list** commands only (pods, deployments, services, configmaps).
- Terminal tabs dedupe by workflow topology (node IDs + edges), not parameter values — re-running with different params reuses the same tab.
- Restart `make dev` after backend route or handler changes.

## License

Private / personal project — add a license if you plan to publish.
