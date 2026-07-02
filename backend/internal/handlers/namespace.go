package handlers

import (
	"fmt"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func isAllNamespaces(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "*", "all", "-a", "--all-namespaces", "--all-namespace":
		return true
	default:
		return false
	}
}

func resolveNamespace(params map[string]string, allowAll bool) (string, error) {
	raw := strings.TrimSpace(params["namespace"])
	if isAllNamespaces(raw) {
		if allowAll {
			return metav1.NamespaceAll, nil
		}
		return "", fmt.Errorf("--all-namespaces is only supported for list commands")
	}
	if raw == "" {
		return "default", nil
	}
	return raw, nil
}

func namespaceFrom(params map[string]string) string {
	ns, err := resolveNamespace(params, false)
	if err != nil {
		return "default"
	}
	return ns
}
