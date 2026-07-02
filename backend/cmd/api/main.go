package main

import (
	"log"
	"net/http"
	"os"
	"project-genesis/internal/handlers"
	"project-genesis/internal/k8s"
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
	// 1. Initialize K8s Client
	client, err := k8s.GetClient()
	if err != nil {
		log.Fatalf("Failed to connect to Kubernetes cluster: %v", err)
	}
	log.Println("Successfully connected to local Kubernetes cluster context.")

	// 2. Setup Router
	r := mux.NewRouter()
	k8sHandler := &handlers.K8sHandler{Client: client}

	// 3. API Routes
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/pods", k8sHandler.GetPods).Methods("GET")
	api.HandleFunc("/pods/create", k8sHandler.CreatePod).Methods("POST")
	api.HandleFunc("/commands/execute", k8sHandler.ExecuteCommand).Methods("POST")
	api.HandleFunc("/commands/stream-pod-logs", k8sHandler.StreamPodLogs).Methods("POST")

	// 4. Start Server
	port := serverPort()
	log.Printf("Local UI Backend listening on :%s...", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}