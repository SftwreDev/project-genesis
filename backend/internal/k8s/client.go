package k8s

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

func kubeconfigPath() string {
	if path := strings.TrimSpace(os.Getenv("KUBECONFIG")); path != "" {
		return path
	}
	return filepath.Join(homedir.HomeDir(), ".kube", "config")
}

func loadClientConfig(contextName string) clientcmd.ClientConfig {
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	if path := strings.TrimSpace(os.Getenv("KUBECONFIG")); path != "" && !strings.Contains(path, string(os.PathListSeparator)) {
		loadingRules.ExplicitPath = path
	} else if path := kubeconfigPath(); path != "" && os.Getenv("KUBECONFIG") == "" {
		loadingRules.ExplicitPath = path
	}

	overrides := &clientcmd.ConfigOverrides{}
	if strings.TrimSpace(contextName) != "" {
		overrides.CurrentContext = strings.TrimSpace(contextName)
	}
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides)
}

// GetClient initializes a Kubernetes clientset using the default kubeconfig context.
func GetClient() (*kubernetes.Clientset, error) {
	return GetClientForContext("")
}

// GetClientForContext initializes a clientset for a specific kubeconfig context name.
func GetClientForContext(contextName string) (*kubernetes.Clientset, error) {
	clientConfig := loadClientConfig(contextName)

	config, err := clientConfig.ClientConfig()
	if err != nil {
		if strings.TrimSpace(contextName) != "" {
			return nil, fmt.Errorf("kube context %q: %w", contextName, err)
		}
		return nil, err
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	return clientset, nil
}
