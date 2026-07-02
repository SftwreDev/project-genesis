package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"project-genesis/internal/k8s"
)

type K8sHandler struct {
	Client *kubernetes.Clientset
}

func (h *K8sHandler) clientForRequest(contextName string) (*kubernetes.Clientset, error) {
	if h != nil && h.Client != nil && strings.TrimSpace(contextName) == "" {
		return h.Client, nil
	}
	return k8s.GetClientForContext(contextName)
}

func (h *K8sHandler) HandlerForParams(params map[string]string) (*K8sHandler, error) {
	ctxName := strings.TrimSpace(params["context"])
	client, err := h.clientForRequest(ctxName)
	if err != nil {
		return nil, err
	}

	return &K8sHandler{Client: client}, nil
}

// Request structure received from React Flow layout
type CreatePodRequest struct {
	PodName string `json:"podName"`
	Image   string `json:"image"`
}

// Response structure to print back into the UI Terminal
type CommandResponse struct {
	Name    string      `json:"name,omitempty"`
	Status  string      `json:"status,omitempty"`
	Message string      `json:"message,omitempty"`
	Error   string      `json:"error,omitempty"`
	Output  interface{} `json:"output,omitempty"`
}

func (h *K8sHandler) GetPods(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	client, err := h.clientForRequest("")
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}

	pods, err := client.CoreV1().Pods("default").List(r.Context(), metav1.ListOptions{})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(pods.Items)
}

// CreatePod handles the explicit creation command sent from the web canvas
func (h *K8sHandler) CreatePod(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	client, err := h.clientForRequest("")
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}

	var req CreatePodRequest
	err = json.NewDecoder(r.Body).Decode(&req)
	if err != nil || req.PodName == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "Invalid configuration specifications payload"})
		return
	}

	image := req.Image
	if image == "" {
		image = "nginx"
	}

	// Define the declarative layout for the pod using the name passed from UI (e.g., "genesis")
	podManifest := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: req.PodName,
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name:  "web-container",
					Image: image,
				},
			},
		},
	}

	// Commit directly to your active local context kube-api server
	createdPod, err := client.CoreV1().Pods("default").Create(context.TODO(), podManifest, metav1.CreateOptions{})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}

	// Send execution confirmation payload right back to the custom UI stream component
	response := CommandResponse{
		Name:    createdPod.Name,
		Status:  string(createdPod.Status.Phase),
		Message: "Pod orchestration resource processed and provisioned successfully.",
	}
	json.NewEncoder(w).Encode(response)
}
