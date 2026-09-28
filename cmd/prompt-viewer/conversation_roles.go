package main

import "encoding/json"

// Role information is derived only when full context is requested. Keep the
// original request alongside this readable projection for non-text content.
func parseRoleMessages(raw string) []roleMessage {
	var body map[string]any
	if json.Unmarshal([]byte(raw), &body) != nil {
		return nil
	}
	var result []roleMessage
	add := func(role string, content any) {
		text := textContent(content)
		if text == "" && content != nil {
			text = pretty(content)
		}
		if text != "" {
			result = append(result, roleMessage{Role: role, Content: text})
		}
	}
	for _, key := range []string{"system", "instructions", "systemInstruction", "system_instruction"} {
		if value := body[key]; value != nil {
			add("system", value)
		}
	}
	for _, key := range []string{"messages", "input", "contents"} {
		switch value := body[key].(type) {
		case string:
			add("user", value)
		case []any:
			for _, item := range value {
				message, ok := item.(map[string]any)
				if !ok {
					add("unknown", item)
					continue
				}
				role, _ := message["role"].(string)
				if role == "model" {
					role = "assistant"
				}
				if role == "" {
					switch message["type"] {
					case "function_call", "custom_tool_call", "reasoning":
						role = "assistant"
					case "function_call_output", "custom_tool_call_output":
						role = "tool"
					case "message", "input_text", "input_image", "input_file":
						role = "user"
					default:
						role = "unknown"
					}
				}
				content := any(message)
				if value, ok := message["content"]; ok {
					content = value
				}
				if value, ok := message["parts"]; ok {
					content = value
				}
				// Preserve tool invocations in assistant messages even with empty text.
				if message["tool_calls"] != nil {
					content = pretty(message)
				}
				add(role, content)
			}
		}
	}
	hasUser := false
	for _, message := range result {
		if message.Role == "user" {
			hasUser = true
			break
		}
	}
	if !hasUser && body["prompt"] != nil {
		add("user", body["prompt"])
	}
	return result
}
