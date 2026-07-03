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

// serverPort returns the port the server will listen on.
// It first checks the GENESIS_PORT environment variable,
// and then returns the default port "8787".
func serverPort() string {
	if port := strings.TrimSpace(os.Getenv("GENESIS_PORT")); port != "" {
		return port
	}
	return "8787"
}

// main is the entry point for the application.
// It first checks if the Kubernetes client is available,
// then opens the workflow project store,
// and then starts the HTTP server.
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
	log.Println("Workflow project store ready (SQLite).")

	r := mux.NewRouter()
	k8sHandler := &handlers.K8sHandler{}
	workflowsHandler := &handlers.WorkflowsHandler{Store: db}

	// Define the API routes.
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

	logsHandler := &handlers.LogsHandler{}
	api.HandleFunc("/logs/save", logsHandler.SaveRunLogs).Methods("POST")
	api.HandleFunc("/logs/rename", logsHandler.RenameRunLog).Methods("POST")
	api.HandleFunc("/logs", logsHandler.ListRunLogs).Methods("GET")
	api.HandleFunc("/logs/browser", logsHandler.BrowseRunLogs).Methods("GET")
	api.HandleFunc("/logs/download/{file:.+}", logsHandler.DownloadRunLog).Methods("GET")
	api.HandleFunc("/logs/view/{file:.+}", logsHandler.ViewRunLog).Methods("GET")
	api.HandleFunc("/logs/file/{file:.+}", logsHandler.DeleteRunLog).Methods("DELETE")

	// Start the HTTP server.
	port := serverPort()
	log.Printf("Backend listening on http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
