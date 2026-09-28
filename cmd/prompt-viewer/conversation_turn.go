package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

// A history key is evidence of identical supplied user history, not a claim that
// a provider session is complete. Consumers must scope it to an exact Session.
func conversationTurn(raw string) (string, string, bool) {
	var body map[string]any
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&body) != nil {
		return "", "unknown", false
	}
	for _, field := range []string{"previous_response_id", "conversation"} {
		if body[field] != nil && body[field] != "" {
			return "", "unknown", false
		}
	}
	var messages []any
	protocol := ""
	for _, field := range []string{"messages", "input", "contents"} {
		if value, exists := body[field]; exists {
			var ok bool
			messages, ok = value.([]any)
			if !ok || protocol != "" {
				return "", "unknown", false
			}
			protocol = field
		}
	}
	if protocol == "" {
		return "", "unknown", false
	}
	var history []any
	continuation := false
	for _, item := range messages {
		message, ok := item.(map[string]any)
		if !ok {
			return "", "unknown", false
		}
		role, _ := message["role"].(string)
		if role == "" && protocol == "input" && message["type"] == "message" {
			role = "user"
		}
		if role != "user" {
			switch role {
			case "system", "developer":
				continue
			case "assistant", "model", "tool", "function":
				continuation = len(history) > 0
				continue
			case "":
				switch message["type"] {
				case "function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output", "reasoning", "agent_message":
					continuation = len(history) > 0
					continue
				}
			}
			return "", "unknown", false
		}
		content, exists := message["content"]
		if protocol == "contents" {
			content, exists = message["parts"]
		}
		if !exists {
			return "", "unknown", false
		}
		if blocks, ok := content.([]any); ok {
			clean := make([]any, 0, len(blocks))
			hasToolResult := false
			for _, block := range blocks {
				b, ok := block.(map[string]any)
				if !ok {
					return "", "unknown", false
				}
				// Anthropic and Gemini put tool results inside user-role envelopes.
				if b["type"] == "tool_result" || b["functionResponse"] != nil || b["function_response"] != nil {
					hasToolResult = true
					continue
				}
				clean = append(clean, block)
			}
			if len(clean) == 0 {
				if !hasToolResult {
					return "", "unknown", false
				}
				continuation = len(history) > 0
				continue
			}
			content = clean
		} else if _, ok := content.(string); !ok {
			return "", "unknown", false
		}
		history = append(history, content)
		continuation = false
	}
	if len(history) == 0 {
		return "", "unknown", false
	}
	canonical, err := json.Marshal(history)
	if err != nil {
		return "", "unknown", false
	}
	digest := sha256.Sum256(append([]byte(protocol+"\n"), canonical...))
	return "uh1:" + hex.EncodeToString(digest[:]), "user_history", continuation
}
