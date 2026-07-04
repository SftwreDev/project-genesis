package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

type ContextHealthResponse struct {
	OK          bool   `json:"ok"`
	Context     string `json:"context"`
	NeedsReauth bool   `json:"needsReauth"`
	Message     string `json:"message,omitempty"`
	Error       string `json:"error,omitempty"`
}

func contextHealthLabel(contextName string) string {
	if strings.TrimSpace(contextName) == "" {
		return "default"
	}
	return strings.TrimSpace(contextName)
}

func isAuthError(err error) bool {
	if err == nil {
		return false
	}
	if apierrors.IsUnauthorized(err) || apierrors.IsForbidden(err) {
		return true
	}

	msg := strings.ToLower(err.Error())
	keywords := []string{
		"unauthorized",
		"401",
		"403",
		"token",
		"expired",
		"authentication",
		"authenticate",
		"credential",
		"oidc",
		"login",
		"auth",
		"forbidden",
	}
	for _, keyword := range keywords {
		if strings.Contains(msg, keyword) {
			return true
		}
	}
	return false
}

func isConfigError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	keywords := []string{
		"context",
		"kubeconfig",
		"no configuration",
		"not found",
		"invalid configuration",
	}
	for _, keyword := range keywords {
		if strings.Contains(msg, keyword) {
			return true
		}
	}
	return false
}

// ContextHealth checks whether a kubeconfig context can reach the API server.
func (h *K8sHandler) ContextHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	contextName := strings.TrimSpace(r.URL.Query().Get("context"))
	label := contextHealthLabel(contextName)

	client, err := h.clientForRequest(contextName)
	if err != nil {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(ContextHealthResponse{
			OK:          false,
			Context:     label,
			NeedsReauth: isAuthError(err) || isConfigError(err),
			Error:       err.Error(),
			Message:     "Could not load kubeconfig for this context.",
		})
		return
	}

	_, err = client.Discovery().ServerVersion()
	if err != nil {
		needsReauth := isAuthError(err)
		message := "Could not reach the Kubernetes API for this context."
		if needsReauth {
			message = "Context credentials expired or unauthorized. Re-login with kubectl before running workflows."
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(ContextHealthResponse{
			OK:          false,
			Context:     label,
			NeedsReauth: needsReauth,
			Error:       err.Error(),
			Message:     message,
		})
		return
	}

	json.NewEncoder(w).Encode(ContextHealthResponse{
		OK:      true,
		Context: label,
		Message: "Context is connected.",
	})
}
