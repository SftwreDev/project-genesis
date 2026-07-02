package handlers

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (h *K8sHandler) describePod(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "podName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("podName is required")
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	pod, err := h.Client.CoreV1().Pods(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Message: fmt.Sprintf("Described pod %q in namespace %q", name, ns),
		Output:  h.formatPodDescribe(ctx, pod),
	}, nil
}

func (h *K8sHandler) listDeployments(ctx context.Context, params map[string]string) (CommandResponse, error) {
	ns, err := resolveNamespace(params, true)
	if err != nil {
		return CommandResponse{}, err
	}
	deployments, err := h.Client.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	all := isAllNamespaces(param(params, "namespace"))
	names := make([]string, 0, len(deployments.Items))
	for _, deploy := range deployments.Items {
		replicas := int32(0)
		if deploy.Spec.Replicas != nil {
			replicas = *deploy.Spec.Replicas
		}
		if all {
			names = append(names, fmt.Sprintf("%s/%s (replicas: %d)", deploy.Namespace, deploy.Name, replicas))
		} else {
			names = append(names, fmt.Sprintf("%s (replicas: %d)", deploy.Name, replicas))
		}
	}

	message := fmt.Sprintf("Found %d deployment(s) in namespace %q", len(names), ns)
	if all {
		message = fmt.Sprintf("Found %d deployment(s) across all namespaces", len(names))
	}

	return CommandResponse{
		Message: message,
		Output:  names,
	}, nil
}

func (h *K8sHandler) describeDeployment(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "deploymentName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("deploymentName is required")
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	deploy, err := h.Client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Message: fmt.Sprintf("Described deployment %q in namespace %q", name, ns),
		Output:  h.formatDeploymentDescribe(ctx, deploy),
	}, nil
}

func (h *K8sHandler) createDeployment(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "deploymentName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("deploymentName is required")
	}

	image := param(params, "image")
	if image == "" {
		image = "nginx"
	}

	replicas := int32(1)
	if raw := param(params, "replicas"); raw != "" {
		var parsed int
		if _, err := fmt.Sscan(raw, &parsed); err == nil && parsed > 0 {
			replicas = int32(parsed)
		}
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	labels := customLabels(params, knownKeys("deploymentName", "namespace", "image", "replicas", "waitSeconds", "manifestYaml"))
	if len(labels) == 0 {
		labels = map[string]string{"app": name}
	}

	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
			Labels:    labels,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": name}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": name}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "main", Image: image}}},
			},
		},
	}

	created, err := h.Client.AppsV1().Deployments(ns).Create(ctx, deploy, metav1.CreateOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Name:    created.Name,
		Message: fmt.Sprintf("Deployment %q created in namespace %q", created.Name, ns),
	}, nil
}

func (h *K8sHandler) deleteDeployment(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "deploymentName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("deploymentName is required")
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	if err := h.Client.AppsV1().Deployments(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{Message: fmt.Sprintf("Deployment %q deleted from namespace %q", name, ns)}, nil
}

func (h *K8sHandler) scaleDeployment(ctx context.Context, params map[string]string) (CommandResponse, error) {
	name := param(params, "deploymentName")
	if name == "" {
		return CommandResponse{}, fmt.Errorf("deploymentName is required")
	}

	raw := param(params, "replicas")
	if raw == "" {
		return CommandResponse{}, fmt.Errorf("replicas is required")
	}

	var replicas int32
	if _, err := fmt.Sscan(raw, &replicas); err != nil || replicas < 0 {
		return CommandResponse{}, fmt.Errorf("invalid replicas: %s", raw)
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	deploy, err := h.Client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	deploy.Spec.Replicas = &replicas
	updated, err := h.Client.AppsV1().Deployments(ns).Update(ctx, deploy, metav1.UpdateOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Name:    updated.Name,
		Message: fmt.Sprintf("Deployment %q scaled to %d replicas in namespace %q", updated.Name, replicas, ns),
	}, nil
}

func (h *K8sHandler) addNodeTaint(ctx context.Context, params map[string]string) (CommandResponse, error) {
	nodeName := param(params, "nodeName")
	taintKey := param(params, "taintKey")
	if nodeName == "" || taintKey == "" {
		return CommandResponse{}, fmt.Errorf("nodeName and taintKey are required")
	}

	effect := corev1.TaintEffect(param(params, "taintEffect"))
	if effect == "" {
		effect = corev1.TaintEffectNoSchedule
	}

	node, err := h.Client.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	newTaint := corev1.Taint{
		Key:    taintKey,
		Value:  param(params, "taintValue"),
		Effect: effect,
	}
	for _, existing := range node.Spec.Taints {
		if existing.Key == newTaint.Key && existing.Effect == newTaint.Effect {
			return CommandResponse{}, fmt.Errorf("taint %q already exists on node %q", taintKey, nodeName)
		}
	}

	node.Spec.Taints = append(node.Spec.Taints, newTaint)
	if _, err := h.Client.CoreV1().Nodes().Update(ctx, node, metav1.UpdateOptions{}); err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Message: fmt.Sprintf("Taint %q added to node %q", taintKey, nodeName),
	}, nil
}

func (h *K8sHandler) removeNodeTaint(ctx context.Context, params map[string]string) (CommandResponse, error) {
	nodeName := param(params, "nodeName")
	taintKey := param(params, "taintKey")
	if nodeName == "" || taintKey == "" {
		return CommandResponse{}, fmt.Errorf("nodeName and taintKey are required")
	}

	node, err := h.Client.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	next := make([]corev1.Taint, 0, len(node.Spec.Taints))
	removed := false
	for _, taint := range node.Spec.Taints {
		if taint.Key == taintKey {
			removed = true
			continue
		}
		next = append(next, taint)
	}
	if !removed {
		return CommandResponse{}, fmt.Errorf("taint %q not found on node %q", taintKey, nodeName)
	}

	node.Spec.Taints = next
	if _, err := h.Client.CoreV1().Nodes().Update(ctx, node, metav1.UpdateOptions{}); err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Message: fmt.Sprintf("Taint %q removed from node %q", taintKey, nodeName),
	}, nil
}

func (h *K8sHandler) addPodToleration(ctx context.Context, params map[string]string) (CommandResponse, error) {
	podName := param(params, "podName")
	tolerationKey := param(params, "tolerationKey")
	if podName == "" || tolerationKey == "" {
		return CommandResponse{}, fmt.Errorf("podName and tolerationKey are required")
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		return CommandResponse{}, err
	}
	pod, err := h.Client.CoreV1().Pods(ns).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	operator := corev1.TolerationOperator(param(params, "tolerationOperator"))
	if operator == "" {
		operator = corev1.TolerationOpEqual
	}
	effect := corev1.TaintEffect(param(params, "tolerationEffect"))
	if effect == "" {
		effect = corev1.TaintEffectNoSchedule
	}

	toleration := corev1.Toleration{
		Key:      tolerationKey,
		Operator: operator,
		Value:    param(params, "tolerationValue"),
		Effect:   effect,
	}

	pod.Spec.Tolerations = append(pod.Spec.Tolerations, toleration)
	updated, err := h.Client.CoreV1().Pods(ns).Update(ctx, pod, metav1.UpdateOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Name:    updated.Name,
		Message: fmt.Sprintf("Toleration %q added to pod %q in namespace %q", tolerationKey, updated.Name, ns),
	}, nil
}

func (h *K8sHandler) describeNode(ctx context.Context, params map[string]string) (CommandResponse, error) {
	nodeName := param(params, "nodeName")
	if nodeName == "" {
		return CommandResponse{}, fmt.Errorf("nodeName is required")
	}

	node, err := h.Client.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return CommandResponse{}, err
	}

	return CommandResponse{
		Message: fmt.Sprintf("Described node %q", nodeName),
		Output:  h.formatNodeDescribe(ctx, node),
	}, nil
}
