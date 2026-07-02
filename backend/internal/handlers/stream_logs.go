package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	corev1 "k8s.io/api/core/v1"
)

type streamPodLogsRequest struct {
	Params map[string]string `json:"params"`
}

func (h *K8sHandler) StreamPodLogs(w http.ResponseWriter, r *http.Request) {
	var req streamPodLogsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	params := req.Params
	if params == nil {
		params = map[string]string{}
	}

	active, err := h.HandlerForParams(params)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	name := param(params, "podName")
	if name == "" {
		http.Error(w, "podName is required", http.StatusBadRequest)
		return
	}

	ns, err := resolveNamespace(params, false)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	maxWait := waitDurationFrom(params, 60)
	followSeconds := waitDurationFrom(params, 30)
	tailLines := int64(200)
	if raw := param(params, "tailLines"); raw != "" {
		var parsed int64
		if _, err := fmt.Sscan(raw, &parsed); err == nil && parsed > 0 {
			tailLines = parsed
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(maxWait+followSeconds+5)*time.Second)
	defer cancel()

	phase, _, err := active.waitForPodReady(ctx, ns, name, maxWait)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	opts := &corev1.PodLogOptions{
		Follow:    true,
		TailLines: &tailLines,
	}
	if container := param(params, "container"); container != "" {
		opts.Container = container
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	fmt.Fprintf(w, "# pod %q phase %s namespace %q\n", name, phase, ns)
	flusher.Flush()

	followCtx, followCancel := context.WithTimeout(ctx, time.Duration(followSeconds)*time.Second)
	defer followCancel()

	logReq := active.Client.CoreV1().Pods(ns).GetLogs(name, opts)
	stream, err := logReq.Stream(followCtx)
	if err != nil {
		fmt.Fprintf(w, "error: %v\n", err)
		flusher.Flush()
		return
	}
	defer stream.Close()

	buf := make([]byte, 4096)
	for {
		n, readErr := stream.Read(buf)
		if n > 0 {
			if _, writeErr := w.Write(buf[:n]); writeErr != nil {
				return
			}
			flusher.Flush()
		}
		if readErr != nil {
			if readErr != io.EOF {
				fmt.Fprintf(w, "\n# stream ended: %v\n", readErr)
				flusher.Flush()
			}
			break
		}
	}

	fmt.Fprintf(w, "\n# follow window complete (%ds)\n", followSeconds)
	flusher.Flush()
}
