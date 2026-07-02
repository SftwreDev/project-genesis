package main

import (
	"log"
	"net/http"
	"os"
	"project-genesis/internal/handlers"
	"project-genesis/internal/k8s"
	"project-genesis/internal/store"
	"strings"

	"github.com/gorilla/mux"
)

func serverPort() string {
	if port := strings.TrimSpace(os.Getenv("GENESIS_PORT")); port != "" {
		return port
	}
	return "8787"
}

func main() {
	if _, err := k8s.GetClient(); err != nil {
		log.Printf("Warning: Kubernetes unavailable at startup (%v). Workflow API still runs; fix kubeconfig or start cluster before kubectl commands.", err)
	} else {
		log.Println("Kubernetes client ready from local kubeconfig.")
	}

	db, err := store.Open()
	if err != nil {
		log.Fatalf("Failed to open workflow store: %v", err)
	}
	defer db.Close()
	log.Println("Workflow project store ready (PostgreSQL).")

	r := mux.NewRouter()
	k8sHandler := &handlers.K8sHandler{}
	workflowsHandler := &handlers.WorkflowsHandler{Store: db}

	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/pods", k8sHandler.GetPods).Methods("GET")
	api.HandleFunc("/pods/create", k8sHandler.CreatePod).Methods("POST")
	api.HandleFunc("/commands/execute", k8sHandler.ExecuteCommand).Methods("POST")
	api.HandleFunc("/commands/stream-pod-logs", k8sHandler.StreamPodLogs).Methods("POST")
	api.HandleFunc("/workflows", workflowsHandler.ListWorkflowProjects).Methods("GET")
	api.HandleFunc("/workflows", workflowsHandler.CreateWorkflowProject).Methods("POST")
	api.HandleFunc("/workflows/{id}", workflowsHandler.GetWorkflowProject).Methods("GET")
	api.HandleFunc("/workflows/{id}", workflowsHandler.UpdateWorkflowProject).Methods("PUT")
	api.HandleFunc("/workflows/{id}", workflowsHandler.DeleteWorkflowProject).Methods("DELETE")

	port := serverPort()
	log.Printf("Backend listening on http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
