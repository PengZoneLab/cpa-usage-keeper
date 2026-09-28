package main

import (
	"reflect"
	"testing"
)

func TestRoleMessagesProtocols(t *testing.T) {
	cases := []struct {
		name, body string
		want       []roleMessage
	}{
		{"legacy system prompt", `{"system":"rules","prompt":"question"}`, []roleMessage{{"system", "rules"}, {"user", "question"}}},
		{"legacy developer prompt", `{"messages":[{"role":"developer","content":"rules"}],"prompt":"question"}`, []roleMessage{{"developer", "rules"}, {"user", "question"}}},
		{"prefer messages over prompt", `{"messages":[{"role":"user","content":"question"}],"prompt":"duplicate"}`, []roleMessage{{"user", "question"}}},
		{"chat", `{"messages":[{"role":"system","content":"rules"},{"role":"developer","content":"developer rules"},{"role":"user","content":"question"},{"role":"assistant","content":"answer"},{"role":"tool","content":"result"}]}`, []roleMessage{{"system", "rules"}, {"developer", "developer rules"}, {"user", "question"}, {"assistant", "answer"}, {"tool", "result"}}},
		{"responses", `{"instructions":"rules","input":[{"role":"user","content":[{"type":"input_text","text":"question"}]}]}`, []roleMessage{{"system", "rules"}, {"user", "question"}}},
		{"responses implicit", `{"instructions":"rules","input":[{"type":"message","content":[{"type":"input_text","text":"question"}]}]}`, []roleMessage{{"system", "rules"}, {"user", "question"}}},
		{"responses text", `{"input":[{"type":"input_text","text":"question"}]}`, []roleMessage{{"user", "question"}}},
		{"responses string", `{"instructions":"rules","input":"question"}`, []roleMessage{{"system", "rules"}, {"user", "question"}}},
		{"anthropic", `{"system":[{"type":"text","text":"rules"}],"messages":[{"role":"user","content":"question"}]}`, []roleMessage{{"system", "rules"}, {"user", "question"}}},
		{"gemini", `{"systemInstruction":{"parts":[{"text":"rules"}]},"contents":[{"role":"user","parts":[{"text":"question"}]},{"role":"model","parts":[{"text":"answer"}]}]}`, []roleMessage{{"system", "rules"}, {"user", "question"}, {"assistant", "answer"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseRoleMessages(tc.body)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %#v want %#v", got, tc.want)
			}
			p := parseConversation([]logSection{{Title: "REQUEST BODY", Content: tc.body}})
			if p.Input != "question" {
				t.Fatalf("latest user is %q", p.Input)
			}
		})
	}
}

func TestSystemNeverFallsBackToUser(t *testing.T) {
	for _, body := range []string{`{"instructions":"secret rules"}`, `{"system":"secret rules"}`, `{"messages":[{"role":"system","content":"secret rules"}]}`, `{"messages":[{"role":"assistant","content":"answer"}]}`} {
		p := parseConversation([]logSection{{Title: "REQUEST BODY", Content: body}})
		if p.Input != "" || p.InputAvailable {
			t.Fatalf("non-user content became input: %q", p.Input)
		}
		if p.FullInput != body {
			t.Fatal("raw context lost")
		}
	}
}
