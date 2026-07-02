package k8s

import (
	"fmt"
	"path/filepath"
	"strings"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

func kubeconfigPath() string {
	return filepath.Join(homedir.HomeDir(), ".kube", "config")
}

func loadClientConfig(contextName string) (clientcmd.ClientConfig, error) {
	loadingRules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath()}
	overrides := &clientcmd.ConfigOverrides{}
	if strings.TrimSpace(contextName) != "" {
		overrides.CurrentContext = strings.TrimSpace(contextName)
	}
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides), nil
}

// GetClient initializes a Kubernetes clientset using the default kubeconfig context.
func GetClient() (*kubernetes.Clientset, error) {
	return GetClientForContext("")
}

// GetClientForContext initializes a clientset for a specific kubeconfig context name.
func GetClientForContext(contextName string) (*kubernetes.Clientset, error) {
	clientConfig, err := loadClientConfig(contextName)
	if err != nil {
		return nil, err
	}

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
