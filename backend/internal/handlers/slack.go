package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type slackWebhookPayload struct {
	Text     string `json:"text"`
	Channel  string `json:"channel,omitempty"`
	ThreadTS string `json:"thread_ts,omitempty"`
}

type slackBotPayload struct {
	Channel  string `json:"channel"`
	Text     string `json:"text"`
	ThreadTS string `json:"thread_ts,omitempty"`
}

type slackAPIResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	TS    string `json:"ts,omitempty"`
}

func executeSlackNotify(ctx context.Context, params map[string]string) (CommandResponse, error) {
	authMode := param(params, "authMode")
	if authMode == "" {
		authMode = "webhook"
	}

	message := param(params, "message")
	if message == "" {
		return CommandResponse{}, fmt.Errorf("message is required")
	}

	channel := param(params, "channel")
	threadTs := param(params, "threadTs")

	switch authMode {
	case "webhook":
		webhookURL := param(params, "webhookUrl")
		if webhookURL == "" {
			return CommandResponse{}, fmt.Errorf("webhook URL is required for webhook auth mode")
		}
		return postSlackWebhook(ctx, webhookURL, message, channel, threadTs)
	case "bot":
		token := param(params, "botToken")
		if token == "" {
			return CommandResponse{}, fmt.Errorf("bot token is required for bot auth mode")
		}
		if channel == "" {
			return CommandResponse{}, fmt.Errorf("channel is required for bot auth mode")
		}
		return postSlackBot(ctx, token, channel, message, threadTs)
	default:
		return CommandResponse{}, fmt.Errorf("unknown auth mode %q (use webhook or bot)", authMode)
	}
}

func postSlackWebhook(ctx context.Context, webhookURL, message, channel, threadTs string) (CommandResponse, error) {
	payload := slackWebhookPayload{Text: message}
	if channel != "" {
		payload.Channel = channel
	}
	if threadTs != "" {
		payload.ThreadTS = threadTs
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return CommandResponse{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return CommandResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return CommandResponse{}, fmt.Errorf("slack webhook request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail := strings.TrimSpace(string(respBody))
		if detail == "" {
			detail = resp.Status
		}
		return CommandResponse{}, fmt.Errorf("slack webhook returned %s: %s", resp.Status, detail)
	}

	return CommandResponse{
		Status:  "sent",
		Message: "Slack message sent via webhook.",
		Output:  strings.TrimSpace(string(respBody)),
	}, nil
}

func postSlackBot(ctx context.Context, token, channel, message, threadTs string) (CommandResponse, error) {
	payload := slackBotPayload{
		Channel: channel,
		Text:    message,
	}
	if threadTs != "" {
		payload.ThreadTS = threadTs
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return CommandResponse{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://slack.com/api/chat.postMessage", bytes.NewReader(body))
	if err != nil {
		return CommandResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return CommandResponse{}, fmt.Errorf("slack bot request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))

	var slackResp slackAPIResponse
	if err := json.Unmarshal(respBody, &slackResp); err != nil {
		return CommandResponse{}, fmt.Errorf("slack bot response parse failed: %w", err)
	}

	if !slackResp.OK {
		errMsg := slackResp.Error
		if errMsg == "" {
			errMsg = strings.TrimSpace(string(respBody))
		}
		if errMsg == "" {
			errMsg = resp.Status
		}
		return CommandResponse{}, fmt.Errorf("slack API error: %s", errMsg)
	}

	return CommandResponse{
		Status:  "sent",
		Message: fmt.Sprintf("Slack message posted to %s.", channel),
		Output:  slackResp.TS,
	}, nil
}
