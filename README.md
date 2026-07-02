# Project:Genesis

Visual kubectl workflow builder for Kubernetes. Drag commands onto a canvas, connect steps, configure parameters, and run them against your kubeconfig — with flow control, a live IDE-style terminal, workflow groups, saved projects, and optional kube context switching.

## Features

### Command library

Workloads, networking, config, cluster ops, and workflow tools:

| Category | Examples |
|----------|----------|
| **Workloads** | Pods (create, delete, list, logs, describe), Deployments (create, scale, describe), tolerations |
| **Nodes** | List/describe nodes, add/remove taints |
| **Networking** | Services (create, list, delete) |
| **Config & Storage** | ConfigMaps (create, list, delete) |
| **Cluster** | Namespaces (create, list, delete) |
| **Workflow Tools** | Delay, Schedule, If / Else, Start, End |

### Visual canvas

- Drag commands from the **Workloads** palette (toggle hide/show like the config panel)
- Connect nodes top-to-bottom; execution follows graph order (topological sort)
- Per-node **Run** button, or **Run Workflow** for the full canvas
- Multi-select nodes to run a subset (when no **Start** node is on the canvas)
- YAML editor with Tab / Shift+Tab indent; params sync both ways

### Flow control

| Tool | Purpose |
|------|---------|
| **Delay** | Pause N seconds before the next step |
| **Schedule** | Wait until a date/time before the workflow runs (entry node) |
| **If / Else** | Route to **success** or **failure** branch based on upstream step result |
| **Start** | Named workflow segment entry — when present, only downstream steps run |
| **End** | Named workflow segment exit — steps after End are skipped |

**If / Else wiring:** connect the step to check into the top handle. Drag from the green **success** handle for the happy path, red **failure** handle for recovery/alternate steps. Failed upstream steps no longer abort the whole run when an If / Else node handles them.

**Start / End wiring:** set **Workflow Name** in the config panel. Place **Start** at the segment entry and **End** where it should stop. Unconnected nodes outside the Start scope are marked **Skipped** when you run.

### Workflow execution

- Concurrent runs — each run opens its own terminal tab with live logs
- Pause, resume, and stop per session
- Pod log streaming with configurable wait (default 3600s), follow, and tail
- Workflow groups — multi-select, save named groups, resize frame, highlight, run group, ungroup, delete
- Global and per-node kube `--context`; namespace and context inherit downstream

### Terminal (IDE-style)

- **Tabs** — one per run/session; double-click tab name to rename
- **Split view** — drag a tab into the terminal area to pin left/right panes; click tabs to load the focused pane (VS Code–style)
- **Session rail** — pinned split sessions + list of other tabs; close on hover
- **Search** — per-tab find in logs (`Cmd/Ctrl+F`), instant match, auto-scroll to hits, Enter / Shift+Enter for next/prev
- **Maximize** terminal (Esc to restore); resizable panel height
- Colored log levels (system, run, success, error, output, warn)

### Saved projects

Persist canvas workflows in SQLite: nodes, edges, groups, and saved kube contexts.

Data path: `~/.genesis/genesis.db`

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

Workflow tools (Delay, Schedule, If / Else, Start, End) run entirely in the browser. Kubectl commands are executed by the Go backend against your local kubeconfig.

## Example flow

```
[Start: Deploy] → create deployment → wait for pod → [If / Else]
                                                    ├─ success → verify logs → [End: Deploy]
                                                    └─ failure → cleanup rollback
```

## License

Private / personal project — add a license if you plan to publish.
