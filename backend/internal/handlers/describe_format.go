package handlers

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
)

func appendLine(lines *[]string, format string, args ...any) {
	*lines = append(*lines, fmt.Sprintf(format, args...))
}

func appendSection(lines *[]string, title string) {
	*lines = append(*lines, "", title+":")
}

func appendKeyValueMap(lines *[]string, indent string, data map[string]string) {
	if len(data) == 0 {
		appendLine(lines, "%s<none>", indent)
		return
	}
	keys := make([]string, 0, len(data))
	for key := range data {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		appendLine(lines, "%s%s=%s", indent, key, data[key])
	}
}

func containerStateString(state corev1.ContainerState) string {
	switch {
	case state.Running != nil:
		return fmt.Sprintf("Running (started %s)", state.Running.StartedAt.Time.Format(time.RFC3339))
	case state.Waiting != nil:
		return fmt.Sprintf("Waiting (%s: %s)", state.Waiting.Reason, state.Waiting.Message)
	case state.Terminated != nil:
		return fmt.Sprintf("Terminated (%s: exit %d)", state.Terminated.Reason, state.Terminated.ExitCode)
	default:
		return "Unknown"
	}
}

func (h *K8sHandler) fetchEvents(ctx context.Context, namespace, kind, name string) ([]corev1.Event, error) {
	fieldSelector := fields.AndSelectors(
		fields.OneTermEqualSelector("involvedObject.kind", kind),
		fields.OneTermEqualSelector("involvedObject.name", name),
	).String()

	list, err := h.Client.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{FieldSelector: fieldSelector})
	if err != nil {
		return nil, err
	}

	events := append([]corev1.Event(nil), list.Items...)
	sort.Slice(events, func(i, j int) bool {
		return events[i].LastTimestamp.Time.Before(events[j].LastTimestamp.Time)
	})
	return events, nil
}

func appendEvents(lines *[]string, events []corev1.Event) {
	appendSection(lines, "Events")
	if len(events) == 0 {
		appendLine(lines, "  <none>")
		return
	}
	appendLine(lines, "  Type    Reason     Age   From               Message")
	appendLine(lines, "  ----    ------     ---   ----               -------")
	for _, event := range events {
		age := "<unknown>"
		if !event.LastTimestamp.IsZero() {
			age = formatAge(time.Since(event.LastTimestamp.Time))
		}
		appendLine(lines, "  %-7s %-10s %-5s %-18s %s",
			event.Type,
			event.Reason,
			age,
			event.Source.Component,
			strings.TrimSpace(event.Message),
		)
	}
}

func (h *K8sHandler) formatPodDescribe(ctx context.Context, pod *corev1.Pod) string {
	lines := make([]string, 0, 64)

	appendLine(&lines, "Name:             %s", pod.Name)
	appendLine(&lines, "Namespace:        %s", pod.Namespace)
	if pod.Spec.Priority != nil {
		appendLine(&lines, "Priority:         %d", *pod.Spec.Priority)
	} else {
		appendLine(&lines, "Priority:         <none>")
	}
	appendLine(&lines, "Node:             %s", valueOrNone(pod.Spec.NodeName))
	appendLine(&lines, "Start Time:       %s", formatTime(pod.Status.StartTime))
	appendLine(&lines, "Phase:            %s", pod.Status.Phase)
	appendLine(&lines, "Pod IP:           %s", valueOrNone(pod.Status.PodIP))
	appendLine(&lines, "Service Account:  %s", valueOrNone(pod.Spec.ServiceAccountName))
	appendLine(&lines, "QoS Class:        %s", pod.Status.QOSClass)

	appendSection(&lines, "Labels")
	appendKeyValueMap(&lines, "  ", pod.Labels)

	appendSection(&lines, "Annotations")
	appendKeyValueMap(&lines, "  ", pod.Annotations)

	statusByName := map[string]corev1.ContainerStatus{}
	for _, status := range pod.Status.ContainerStatuses {
		statusByName[status.Name] = status
	}

	for _, container := range pod.Spec.Containers {
		appendSection(&lines, fmt.Sprintf("Container %s", container.Name))
		appendLine(&lines, "  Image:          %s", container.Image)
		if len(container.Ports) > 0 {
			parts := make([]string, 0, len(container.Ports))
			for _, port := range container.Ports {
				parts = append(parts, fmt.Sprintf("%d/%s", port.ContainerPort, port.Protocol))
			}
			appendLine(&lines, "  Ports:          %s", strings.Join(parts, ", "))
		}
		if status, ok := statusByName[container.Name]; ok {
			appendLine(&lines, "  Ready:          %t", status.Ready)
			appendLine(&lines, "  Restart Count:  %d", status.RestartCount)
			appendLine(&lines, "  State:          %s", containerStateString(status.State))
			if status.LastTerminationState.Terminated != nil {
				appendLine(&lines, "  Last Terminated:%s", containerStateString(status.LastTerminationState))
			}
		}
	}

	appendSection(&lines, "Conditions")
	if len(pod.Status.Conditions) == 0 {
		appendLine(&lines, "  <none>")
	} else {
		appendLine(&lines, "  Type                 Status")
		appendLine(&lines, "  ----                 ------")
		for _, condition := range pod.Status.Conditions {
			appendLine(&lines, "  %-20s %s", condition.Type, condition.Status)
			if condition.Message != "" {
				appendLine(&lines, "    Message: %s", condition.Message)
			}
			if condition.Reason != "" {
				appendLine(&lines, "    Reason:  %s", condition.Reason)
			}
		}
	}

	if len(pod.Spec.Tolerations) > 0 {
		appendSection(&lines, "Tolerations")
		for _, toleration := range pod.Spec.Tolerations {
			appendLine(&lines, "  - key=%s operator=%s value=%s effect=%s tolerationSeconds=%v",
				toleration.Key, toleration.Operator, toleration.Value, toleration.Effect, toleration.TolerationSeconds)
		}
	}

	events, _ := h.fetchEvents(ctx, pod.Namespace, "Pod", pod.Name)
	appendEvents(&lines, events)

	return strings.Join(lines, "\n")
}

func (h *K8sHandler) formatDeploymentDescribe(ctx context.Context, deploy *appsv1.Deployment) string {
	lines := make([]string, 0, 64)
	replicas := int32(0)
	if deploy.Spec.Replicas != nil {
		replicas = *deploy.Spec.Replicas
	}

	appendLine(&lines, "Name:             %s", deploy.Name)
	appendLine(&lines, "Namespace:        %s", deploy.Namespace)
	appendLine(&lines, "Replicas:         %d desired | %d updated | %d total | %d available | %d unavailable",
		replicas,
		deploy.Status.UpdatedReplicas,
		deploy.Status.Replicas,
		deploy.Status.AvailableReplicas,
		deploy.Status.UnavailableReplicas,
	)
	appendLine(&lines, "Strategy:         %s", deploy.Spec.Strategy.Type)

	appendSection(&lines, "Labels")
	appendKeyValueMap(&lines, "  ", deploy.Labels)

	appendSection(&lines, "Selector")
	appendKeyValueMap(&lines, "  ", deploy.Spec.Selector.MatchLabels)

	appendSection(&lines, "Pod Template Labels")
	appendKeyValueMap(&lines, "  ", deploy.Spec.Template.Labels)

	appendSection(&lines, "Containers")
	for _, container := range deploy.Spec.Template.Spec.Containers {
		appendLine(&lines, "  %s:", container.Name)
		appendLine(&lines, "    Image:      %s", container.Image)
		if len(container.Ports) > 0 {
			parts := make([]string, 0, len(container.Ports))
			for _, port := range container.Ports {
				parts = append(parts, fmt.Sprintf("%d/%s", port.ContainerPort, port.Protocol))
			}
			appendLine(&lines, "    Ports:      %s", strings.Join(parts, ", "))
		}
	}

	appendSection(&lines, "Conditions")
	if len(deploy.Status.Conditions) == 0 {
		appendLine(&lines, "  <none>")
	} else {
		for _, condition := range deploy.Status.Conditions {
			appendLine(&lines, "  %s=%s reason=%s message=%s",
				condition.Type, condition.Status, condition.Reason, condition.Message)
		}
	}

	events, _ := h.fetchEvents(ctx, deploy.Namespace, "Deployment", deploy.Name)
	appendEvents(&lines, events)

	return strings.Join(lines, "\n")
}

func (h *K8sHandler) formatNodeDescribe(ctx context.Context, node *corev1.Node) string {
	lines := make([]string, 0, 64)

	appendLine(&lines, "Name:             %s", node.Name)
	appendLine(&lines, "Roles:            %s", nodeRoles(node))
	appendLine(&lines, "Labels:")
	appendKeyValueMap(&lines, "  ", node.Labels)

	appendSection(&lines, "Annotations")
	appendKeyValueMap(&lines, "  ", node.Annotations)

	appendSection(&lines, "Addresses")
	for _, address := range node.Status.Addresses {
		appendLine(&lines, "  %s:  %s", address.Type, address.Address)
	}

	appendSection(&lines, "Capacity")
	appendLine(&lines, "  cpu:                %s", node.Status.Capacity.Cpu().String())
	appendLine(&lines, "  memory:             %s", node.Status.Capacity.Memory().String())
	appendLine(&lines, "  pods:               %s", node.Status.Capacity.Pods().String())

	appendSection(&lines, "Allocatable")
	appendLine(&lines, "  cpu:                %s", node.Status.Allocatable.Cpu().String())
	appendLine(&lines, "  memory:             %s", node.Status.Allocatable.Memory().String())
	appendLine(&lines, "  pods:               %s", node.Status.Allocatable.Pods().String())

	appendSection(&lines, "Conditions")
	for _, condition := range node.Status.Conditions {
		appendLine(&lines, "  %s=%s reason=%s message=%s",
			condition.Type, condition.Status, condition.Reason, condition.Message)
	}

	appendSection(&lines, "Taints")
	if len(node.Spec.Taints) == 0 {
		appendLine(&lines, "  <none>")
	} else {
		for _, taint := range node.Spec.Taints {
			appendLine(&lines, "  %s=%s:%s", taint.Key, taint.Value, taint.Effect)
		}
	}

	events, _ := h.fetchEvents(ctx, metav1.NamespaceAll, "Node", node.Name)
	appendEvents(&lines, events)

	return strings.Join(lines, "\n")
}

func valueOrNone(value string) string {
	if strings.TrimSpace(value) == "" {
		return "<none>"
	}
	return value
}

func formatAge(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}

func formatTime(value *metav1.Time) string {
	if value == nil || value.IsZero() {
		return "<none>"
	}
	return value.Time.Format(time.RFC3339)
}

func nodeRoles(node *corev1.Node) string {
	roles := make([]string, 0)
	for label := range node.Labels {
		if strings.HasPrefix(label, "node-role.kubernetes.io/") {
			roles = append(roles, strings.TrimPrefix(label, "node-role.kubernetes.io/"))
		}
	}
	sort.Strings(roles)
	if len(roles) == 0 {
		return "<none>"
	}
	return strings.Join(roles, ",")
}
