package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"sigs.k8s.io/yaml"
)

type ExecuteCommandRequest struct {
	Command string            `json:"command"`
	Params  map[string]string `json:"params"`
}

func param(params map[string]string, key string) string {
	return strings.TrimSpace(params[key])
}

func knownKeys(keys ...string) map[string]bool {
	known := make(map[string]bool, len(keys)+1)
	for _, key := range keys {
		known[key] = true
	}
	known["context"] = true
	return known
}

func customLabels(params map[string]string, known map[string]bool) map[string]string {
	labels := map[string]string{}
	for key, value := range params {
		if known[key] || strings.TrimSpace(value) == "" {
			continue
		}
		labels[key] = strings.TrimSpace(value)
	}
	return labels
}

func waitDurationFrom(params map[string]string, defaultSeconds int) time.Duration {
	raw := param(params, "waitSeconds")
	if raw == "" {
		return time.Duration(defaultSeconds) * time.Second
	}

	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return time.Duration(defaultSeconds) * time.Second
	}
	return time.Duration(seconds) * time.Second
}

func containerWaitingMessage(pod *corev1.Pod) string {
	for _, status := range pod.Status.ContainerStatuses {
		if status.State.Waiting == nil {
			continue
		}
		reason := status.State.Waiting.Reason
		switch reason {
		case "ErrImagePull", "ImagePullBackOff", "CrashLoopBackOff", "CreateContainerConfigError", "InvalidImageName":
			return fmt.Sprintf("pod %q failed to start: %s (%s)", pod.Name, reason, status.State.Waiting.Message)
		}
	}
	return ""
}

func (h *K8sHandler) waitForPodReady(ctx context.Context, ns, name string, maxWait time.Duration) (corev1.PodPhase, time.Duration, error) {
	deadline := time.Now().Add(maxWait)
	interval := 2 * time.Second

	for {
		pod, err := h.Client.CoreV1().Pods(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return "", 0, err
		}

		if message := containerWaitingMessage(pod); message != "" {
			return pod.Status.Phase, time.Duration(0), fmt.Errorf("%s", message)
		}

		switch pod.Status.Phase {
		case corev1.PodRunning, corev1.PodSucceeded:
			return pod.Status.Phase, maxWait - time.Until(deadline), nil
		case corev1.PodFailed:
			return pod.Status.Phase, 0, fmt.Errorf("pod %q is in Failed state", name)
		}

		if time.Now().After(deadline) {
			return pod.Status.Phase, maxWait, fmt.Errorf("timed out after %s waiting for pod %q (status: %s)", maxWait, name, pod.Status.Phase)
		}

		select {
		case <-ctx.Done():
			return pod.Status.Phase, 0, ctx.Err()
		case <-time.After(interval):
		}
	}
}

func (h *K8sHandler) ExecuteCommand(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req ExecuteCommandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Command == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "Invalid command payload"})
		return
	}

	if req.Params == nil {
		req.Params = map[string]string{}
	}

	active, err := h.HandlerForParams(req.Params)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}

	ctx := r.Context()
	var resp CommandResponse

	switch req.Command {
	case "create-pod":
		resp, err = active.createPod(ctx, req.Params)
	case "delete-pod":
		resp, err = active.deletePod(ctx, req.Params)
	case "list-pods":
		resp, err = active.listPods(ctx, req.Params)
	case "get-pod-logs":
		resp, err = active.getPodLogs(ctx, req.Params)
	case "describe-pod":
		resp, err = active.describePod(ctx, req.Params)
	case "list-deployments":
		resp, err = active.listDeployments(ctx, req.Params)
	case "describe-deployment":
		resp, err = active.describeDeployment(ctx, req.Params)
	case "create-deployment":
		resp, err = active.createDeployment(ctx, req.Params)
	case "delete-deployment":
		resp, err = active.deleteDeployment(ctx, req.Params)
	case "scale-deployment":
		resp, err = active.scaleDeployment(ctx, req.Params)
	case "add-node-taint":
		resp, err = active.addNodeTaint(ctx, req.Params)
	case "remove-node-taint":
		resp, err = active.removeNodeTaint(ctx, req.Params)
	case "add-pod-toleration":
		resp, err = active.addPodToleration(ctx, req.Params)
	case "describe-node":
		resp, err = active.describeNode(ctx, req.Params)
	case "create-service":
		resp, err = active.createService(ctx, req.Params)
	case "list-services":
		resp, err = active.listServices(ctx, req.Params)
	case "delete-service":
		resp, err = active.deleteService(ctx, req.Params)
	case "create-configmap":
		resp, err = active.createConfigMap(ctx, req.Params)
	case "list-configmaps":
		resp, err = active.listConfigMaps(ctx, req.Params)
	case "delete-configmap":
		resp, err = active.deleteConfigMap(ctx, req.Params)
	case "list-nodes":
		resp, err = active.listNodes(ctx)
	case "list-namespaces":
		resp, err = active.listNamespaces(ctx)
	case "create-namespace":
		resp, err = active.createNamespace(ctx, req.Params)
	case "delete-namespace":
		resp, err = active.deleteNamespace(ctx, req.Params)
	default:
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: fmt.Sprintf("Unknown command: %s", req.Command)})
		return
	}

	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		if resp.Error == "" {
			resp.Error = err.Error()
		}
		json.NewEncoder(w).Encode(resp)
		return
	}

	json.NewEncoder(w).Encode(resp)
}

func (h *K8sHandler) createPod(ctx context.Context, params map[string]string) (CommandResponse, error) {
	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}

	if manifest := param(params, "manifestYaml"); manifest != "" && !strings.HasPrefix(strings.TrimSpace(manifest), "#") {
		var pod corev1.Pod
		if err := yaml.Unmarshal([]byte(manifest), &pod); err != nil {
			return CommandResponse{}, fmt.Errorf("invalid manifestYaml: %w", err)
		}
		if pod.Namespace == "" {
			pod.Namespace = ns
		}
		if pod.Name == "" {
			pod.Name = param(params, "podName")
		}
		if pod.Name == "" {
			return CommandResponse{}, fmt.Errorf("pod name is required in manifestYaml or podName param")
		}

		created, err := h.Client.CoreV1().Pods(pod.Namespace).Create(ctx, &pod, metav1.CreateOptions{})
		if err != nil {
			return CommandResponse{}, err
		}

		return CommandResponse{
			Name:    created.Name,
			Status:  string(created.Status.Phase),
			Message: fmt.Sprintf("Pod %q created from YAML in namespace %q", created.Name, created.Namespace),
		}, nil
	}

	name := param(params, "podName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("podName is required")
	}

	image := param(params, "image")
	if image == "" {
		image = "nginx"
	}

	labels := customLabels(params, knownKeys("podName", "namespace", "image", "waitSeconds", "manifestYaml", "tolerationKey", "tolerationValue", "tolerationEffect", "tolerationOperator"))
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:   name,
			Labels: labels,
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "main", Image: image}},
		},
	}

	if tolerationKey := param(params, "tolerationKey"); tolerationKey != "" {
		operator := corev1.TolerationOperator(param(params, "tolerationOperator"))
		if operator == "" {
			operator = corev1.TolerationOpEqual
		}
		effect := corev1.TaintEffect(param(params, "tolerationEffect"))
		if effect == "" {
			effect = corev1.TaintEffectNoSchedule
		}
		pod.Spec.Tolerations = []corev1.Toleration{{
			Key:      tolerationKey,
			Operator: operator,
			Value:    param(params, "tolerationValue"),
			Effect:   effect,
		}}
	}

	created, err := h.Client.CoreV1().Pods(ns).Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Name:    created.Name,
		Status:  string(created.Status.Phase),
		Message: fmt.Sprintf("Pod %q created in namespace %q", created.Name, ns),
	}, nil
}

func (h *K8sHandler) deletePod(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "podName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("podName is required")
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	if err := h.Client.CoreV1().Pods(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{Message: fmt.Sprintf("Pod %q deleted from namespace %q", name, ns)}, nil
}

func (h *K8sHandler) listPods(ctx context.Context, params map[string]string) (CommandResponse, error) {
	ns, err := resolveNamespace(params, true)
	if err != nil {
		return CommandResponse{}, err
	}
	pods, err := h.Client.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	all := isAllNamespaces(param(params, "namespace"))
	names := make([]string, 0, len(pods.Items))
	for _, pod := range pods.Items {
		if all {
			names = append(names, fmt.Sprintf("%s/%s (%s)", pod.Namespace, pod.Name, pod.Status.Phase))
		} else {
			names = append(names, fmt.Sprintf("%s (%s)", pod.Name, pod.Status.Phase))
		}
	}
	sort.Strings(names)

	message := fmt.Sprintf("Found %d pod(s) in namespace %q", len(names), ns)
	if all {
		message = fmt.Sprintf("Found %d pod(s) across all namespaces", len(names))
	}

	return CommandResponse{
		Message: message,
		Output:  names,
	}, nil
}

func (h *K8sHandler) getPodLogs(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "podName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("podName is required")
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	maxWait := waitDurationFrom(params, 60)
	phase, _, err := h.waitForPodReady(ctx, ns, name, maxWait)
	if err != nil {
		return CommandResponse{Status: string(phase)}, err
	}

	opts := &corev1.PodLogOptions{}
	if container := param(params, "container"); container != "" {
		opts.Container = container
	}

	req := h.Client.CoreV1().Pods(ns).GetLogs(name, opts)
	stream, err := req.Stream(ctx)
	if err != nil {
		return CommandResponse{Status: string(phase)}, err
	}
	defer stream.Close()

	body, err := io.ReadAll(stream)
	if err != nil {
		return CommandResponse{Status: string(phase)}, err
	}

	logs := strings.TrimSpace(string(body))
	if logs == "" {
		logs = "(no logs)"
	}

	return CommandResponse{
		Status:  string(phase),
		Message: fmt.Sprintf("Pod %q reached %s, logs fetched from namespace %q", name, phase, ns),
		Output:  logs,
	}, nil
}

func (h *K8sHandler) createService(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "serviceName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("serviceName is required")
	}

	portStr := param(params, "port")
	if portStr == "" {
		portStr = "80"
	}

	var port int32
	if _, err := fmt.Sscan(portStr, &port); err != nil || port <= 0 {
		return CommandResponse{}, fmt.Errorf("invalid port: %s", portStr)
	}

	targetPortStr := param(params, "targetPort")
	if targetPortStr == "" {
		targetPortStr = portStr
	}

	selectorKey := param(params, "selectorKey")
	if selectorKey == "" {
		selectorKey = "app"
	}
	selectorValue := param(params, "selectorValue")
	if selectorValue == "" {
		selectorValue = name
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:   name,
			Labels: customLabels(params, knownKeys("serviceName", "namespace", "port", "targetPort", "selectorKey", "selectorValue", "waitSeconds")),
		},
		Spec: corev1.ServiceSpec{
			Selector: map[string]string{selectorKey: selectorValue},
			Ports: []corev1.ServicePort{{
				Port:       port,
				TargetPort: intstr.FromString(targetPortStr),
			}},
		},
	}

	created, err := h.Client.CoreV1().Services(ns).Create(ctx, svc, metav1.CreateOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Name:    created.Name,
		Message: fmt.Sprintf("Service %q created in namespace %q", created.Name, ns),
	}, nil
}

func (h *K8sHandler) listServices(ctx context.Context, params map[string]string) (CommandResponse, error) {
	ns, err := resolveNamespace(params, true)
	if err != nil {
		return CommandResponse{}, err
	}
	services, err := h.Client.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	all := isAllNamespaces(param(params, "namespace"))
	names := make([]string, 0, len(services.Items))
	for _, svc := range services.Items {
		if all {
			names = append(names, fmt.Sprintf("%s/%s", svc.Namespace, svc.Name))
		} else {
			names = append(names, svc.Name)
		}
	}
	sort.Strings(names)

	message := fmt.Sprintf("Found %d service(s) in namespace %q", len(names), ns)
	if all {
		message = fmt.Sprintf("Found %d service(s) across all namespaces", len(names))
	}

	return CommandResponse{
		Message: message,
		Output:  names,
	}, nil
}

func (h *K8sHandler) deleteService(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "serviceName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("serviceName is required")
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	if err := h.Client.CoreV1().Services(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{Message: fmt.Sprintf("Service %q deleted from namespace %q", name, ns)}, nil
}

func (h *K8sHandler) createConfigMap(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "configMapName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("configMapName is required")
	}

	key := param(params, "key")
	if key == "" {
		key = "config"
	}
	value := param(params, "value")

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:   name,
			Labels: customLabels(params, knownKeys("configMapName", "namespace", "key", "value", "waitSeconds")),
		},
		Data:       map[string]string{key: value},
	}

	created, err := h.Client.CoreV1().ConfigMaps(ns).Create(ctx, cm, metav1.CreateOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Name:    created.Name,
		Message: fmt.Sprintf("ConfigMap %q created in namespace %q", created.Name, ns),
	}, nil
}

func (h *K8sHandler) listConfigMaps(ctx context.Context, params map[string]string) (CommandResponse, error) {
	ns, err := resolveNamespace(params, true)
	if err != nil {
		return CommandResponse{}, err
	}
	cms, err := h.Client.CoreV1().ConfigMaps(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	all := isAllNamespaces(param(params, "namespace"))
	names := make([]string, 0, len(cms.Items))
	for _, cm := range cms.Items {
		if all {
			names = append(names, fmt.Sprintf("%s/%s", cm.Namespace, cm.Name))
		} else {
			names = append(names, cm.Name)
		}
	}
	sort.Strings(names)

	message := fmt.Sprintf("Found %d configmap(s) in namespace %q", len(names), ns)
	if all {
		message = fmt.Sprintf("Found %d configmap(s) across all namespaces", len(names))
	}

	return CommandResponse{
		Message: message,
		Output:  names,
	}, nil
}

func (h *K8sHandler) deleteConfigMap(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "configMapName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("configMapName is required")
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	if err := h.Client.CoreV1().ConfigMaps(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{Message: fmt.Sprintf("ConfigMap %q deleted from namespace %q", name, ns)}, nil
}

func (h *K8sHandler) listNodes(ctx context.Context) (CommandResponse, error) {
	nodes, err := h.Client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	names := make([]string, 0, len(nodes.Items))
	for _, node := range nodes.Items {
		names = append(names, fmt.Sprintf("%s (%s)", node.Name, node.Status.Phase))
	}
	sort.Strings(names)

	return CommandResponse{
		Message: fmt.Sprintf("Found %d node(s)", len(names)),
		Output:  names,
	}, nil
}

func (h *K8sHandler) listNamespaces(ctx context.Context) (CommandResponse, error) {
	nss, err := h.Client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	names := make([]string, 0, len(nss.Items))
	for _, ns := range nss.Items {
		names = append(names, ns.Name)
	}
	sort.Strings(names)

	return CommandResponse{
		Message: fmt.Sprintf("Found %d namespace(s)", len(names)),
		Output:  names,
	}, nil
}

func (h *K8sHandler) createNamespace(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "namespace")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("namespace is required")
	}

	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: name}}
	created, err := h.Client.CoreV1().Namespaces().Create(ctx, ns, metav1.CreateOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Name:    created.Name,
		Message: fmt.Sprintf("Namespace %q created", created.Name),
	}, nil
}

func (h *K8sHandler) deleteNamespace(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "namespace")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("namespace is required")
	}
	if name == "default" || name == "kube-system" || name == "kube-public" {
		return CommandResponse{}, fmt.Errorf("refusing to delete protected namespace %q", name)
	}

	if err := h.Client.CoreV1().Namespaces().Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{Message: fmt.Sprintf("Namespace %q deleted", name)}, nil
}
