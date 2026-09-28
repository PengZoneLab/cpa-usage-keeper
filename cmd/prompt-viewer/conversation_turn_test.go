package main

import "testing"

func TestConversationTurnHistory(t *testing.T) {
	pairs := [][2]string{
		{`{"input":[{"role":"developer","type":"additional_tools"},{"role":"user","type":"message","content":"q"}]}`, `{"input":[{"role":"developer","type":"additional_tools"},{"role":"user","type":"message","content":"q"},{"type":"agent_message","id":"a","author":"agent-a","recipient":"agent-b","content":[{"type":"text","text":"status"}]},{"type":"function_call_output","output":"result"}]}`},
		{`{"messages":[{"role":"user","content":"q"}]}`, `{"messages":[{"role":"user","content":"q"},{"role":"assistant","tool_calls":[{}]},{"role":"tool","content":"result"}]}`},
		{`{"messages":[{"role":"user","content":[{"type":"text","text":"q"}]}]}`, `{"messages":[{"role":"user","content":[{"type":"text","text":"q"}]},{"role":"assistant","content":[{"type":"tool_use"}]},{"role":"user","content":[{"type":"tool_result","content":"result"}]}]}`},
		{`{"contents":[{"role":"user","parts":[{"text":"q"}]}]}`, `{"contents":[{"role":"user","parts":[{"text":"q"}]},{"role":"model","parts":[{"functionCall":{}}]},{"role":"user","parts":[{"functionResponse":{}}]}]}`},
		{`{"input":[{"role":"user","content":"q"}]}`, `{"input":[{"role":"user","content":"q"},{"type":"function_call_output","output":"result"}]}`},
	}
	for _, pair := range pairs {
		first, confidence, initialContinuation := conversationTurn(pair[0])
		next, _, continuation := conversationTurn(pair[1])
		if first == "" || confidence != "user_history" || first != next || initialContinuation || !continuation {
			t.Fatalf("tool continuation differs: %s %s", first, next)
		}
	}
	first, _, _ := conversationTurn(`{"messages":[{"role":"user","content":"q"}]}`)
	repeated, _, repeatedContinuation := conversationTurn(`{"messages":[{"role":"user","content":"q"},{"role":"assistant","content":"a"},{"role":"user","content":"q"}]}`)
	if first == repeated || repeatedContinuation {
		t.Fatal("repeated real question merged")
	}
}

func TestConversationTurnUnknown(t *testing.T) {
	for _, raw := range []string{
		`{"messages":[{"role":"user","content":"q"},{"role":"user","content":[]}]}`,
		`{"input":"q"}`, `{"prompt":"q"}`, `{"previous_response_id":"r","input":[{"role":"user","content":"q"}]}`,
		`{"conversation":"c","input":[{"role":"user","content":"q"}]}`, `{"messages":[{"role":"system","content":"s"}]}`,
		`{"input":[{"type":"function_call_output","output":"r"}]}`, `{"messages":[{"role":"user","content":[{"type":"tool_result","content":"r"}]}]}`,
		`{"input":[{"type":"input_text","text":"q"}]}`, `{"messages":[{"role":"mystery","content":"q"}]}`,
	} {
		key, confidence, continuation := conversationTurn(raw)
		if key != "" || confidence != "unknown" || continuation {
			t.Fatalf("uncertain history grouped: %s", raw)
		}
	}
}
