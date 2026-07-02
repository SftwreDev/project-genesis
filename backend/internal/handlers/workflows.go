package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	"project-genesis/internal/store"
)

type WorkflowsHandler struct {
	Store *store.Store
}

type saveWorkflowRequest struct {
	Name    string          `json:"name"`
	Payload json.RawMessage `json:"payload"`
}

func (h *WorkflowsHandler) ListWorkflowProjects(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	projects, err := h.Store.ListWorkflowProjects()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(projects)
}

func (h *WorkflowsHandler) GetWorkflowProject(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	id := mux.Vars(r)["id"]
	project, err := h.Store.GetWorkflowProject(id)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}
	if project == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(CommandResponse{Error: "Workflow project not found"})
		return
	}

	json.NewEncoder(w).Encode(project)
}

func (h *WorkflowsHandler) CreateWorkflowProject(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req saveWorkflowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "Invalid workflow project payload"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "Project name is required"})
		return
	}
	if len(req.Payload) == 0 || !json.Valid(req.Payload) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "Workflow canvas payload is required"})
		return
	}

	project, err := h.Store.CreateWorkflowProject(name, req.Payload)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(project)
}

func (h *WorkflowsHandler) UpdateWorkflowProject(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	id := mux.Vars(r)["id"]
	var req saveWorkflowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "Invalid workflow project payload"})
		return
	}

	if len(req.Payload) > 0 && !json.Valid(req.Payload) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "Workflow canvas payload is invalid JSON"})
		return
	}

	project, err := h.Store.UpdateWorkflowProject(id, strings.TrimSpace(req.Name), req.Payload)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}
	if project == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(CommandResponse{Error: "Workflow project not found"})
		return
	}

	json.NewEncoder(w).Encode(project)
}

func (h *WorkflowsHandler) DeleteWorkflowProject(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	id := mux.Vars(r)["id"]
	deleted, err := h.Store.DeleteWorkflowProject(id)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}
	if !deleted {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(CommandResponse{Error: "Workflow project not found"})
		return
	}

	json.NewEncoder(w).Encode(CommandResponse{Message: "Workflow project deleted"})
}
