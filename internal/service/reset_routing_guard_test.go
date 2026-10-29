package service

import (
	"context"
	"cpa-usage-keeper/internal/cpa/dto/credentials"
	"cpa-usage-keeper/internal/cpa/dto/response"
	"errors"
	"testing"
	"time"
)

type guardReader struct {
	disabled   bool
	err        error
	drainCalls int
}

func (r *guardReader) FetchCredentials(context.Context) (*response.CredentialsResult, error) {
	return &response.CredentialsResult{Payload: credentials.CredentialsResponse{Files: []credentials.Credential{{AuthIndex: "one", Disabled: &r.disabled}}}}, r.err
}
func (r *guardReader) WithDrained(_ context.Context, _ string, fn func() error) error {
	r.drainCalls++
	return fn()
}
func TestResetGuardReplansWithoutOverwritingManualDeadline(t *testing.T) {
	floor, _, _ := floorSetup(t)
	ctx := context.Background()
	manual := time.Now().Add(time.Hour)
	if _, e := floor.Set(ctx, "one", nil, &manual); e != nil {
		t.Fatal(e)
	}
	g := NewResetRoutingGuard(floor, nil, nil)
	first := manual.Add(-30 * time.Minute)
	second := manual.Add(-10 * time.Minute)
	for _, at := range []*time.Time{&first, &second, nil} {
		if e := g.PlanStop(ctx, "one", at); e != nil {
			t.Fatal(e)
		}
		p, e := floor.Get(ctx, "one")
		if e != nil || !p.DispatchUntil.Equal(manual) {
			t.Fatal(p, e)
		}
		if (at == nil) != (p.ResetDispatchUntil == nil) || (at != nil && !at.Equal(*p.ResetDispatchUntil)) {
			t.Fatal(p)
		}
	}
}
func TestResetGuardConfirmsStopAndLeavesStopped(t *testing.T) {
	floor, f, _ := floorSetup(t)
	r := &guardReader{disabled: true}
	g := NewResetRoutingGuard(floor, r, r)
	called := false
	if e := g.WithStopped(context.Background(), "one", func() error { called = true; return nil }); e != nil {
		t.Fatal(e)
	}
	if !called || r.drainCalls != 1 || len(f.calls) != 1 || !f.calls[0] {
		t.Fatal(called, r.drainCalls, f.calls)
	}
	p, _ := floor.Get(context.Background(), "one")
	if !p.ManualHold || p.ResetDispatchUntil == nil || !p.Paused {
		t.Fatal(p)
	}
	if e := floor.prepareManual(context.Background(), "test.jsonone", "one", false); !errors.Is(e, ErrQuotaFloorBlocked) {
		t.Fatal("unexpected resume", e)
	}
}
func TestResetGuardFailsClosedWithoutReadbackOrDrain(t *testing.T) {
	for _, confirmed := range []bool{false, true} {
		floor, _, _ := floorSetup(t)
		r := &guardReader{disabled: confirmed}
		g := NewResetRoutingGuard(floor, r, nil)
		called := false
		e := g.WithStopped(context.Background(), "one", func() error { called = true; return nil })
		if e == nil || called {
			t.Fatal("unsafe consume")
		}
	}
}
