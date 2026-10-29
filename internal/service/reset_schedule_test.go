package service

import (
	"context"
	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/quota"
	"errors"
	"testing"
	"time"
)

type resetFake struct {
	cards    []quota.CodexRateLimitResetCredit
	consumed []string
	ids      []string
	err      error
	code     string
	stopped  bool
	plans    []time.Time
	guardErr error
}

func (f *resetFake) GetResetCredits(context.Context, quota.ResetCreditsRequest) (quota.ResetCreditsResponse, error) {
	return quota.ResetCreditsResponse{Credits: f.cards}, nil
}
func (f *resetFake) ConsumeScheduledCredit(_ context.Context, index, card, id string, _ time.Time) (quota.ProviderResetOutput, error) {
	if !f.stopped {
		panic("consume before stop")
	}
	f.consumed = append(f.consumed, index+":"+card)
	f.ids = append(f.ids, id)
	return quota.ProviderResetOutput{Code: f.code}, f.err
}
func (f *resetFake) PlanStop(_ context.Context, _ string, at *time.Time) error {
	if at != nil {
		f.plans = append(f.plans, *at)
	}
	return f.guardErr
}
func (f *resetFake) WithStopped(_ context.Context, _ string, fn func() error) error {
	if f.guardErr != nil {
		return f.guardErr
	}
	f.stopped = true
	return fn()
}
func resetSetup(t *testing.T) (*ResetScheduleService, *resetFake, *time.Time) {
	_, _, db := floorSetup(t)
	if e := db.AutoMigrate(&entities.ResetTask{}, &entities.ResetPolicy{}); e != nil {
		t.Fatal(e)
	}
	now := time.Now().UTC()
	f := &resetFake{code: "reset", cards: []quota.CodexRateLimitResetCredit{{ID: "a", Status: "available", ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano)}, {ID: "b", Status: "available", ExpiresAt: now.Add(2 * time.Hour).Format(time.RFC3339Nano)}}}
	s := NewResetScheduleService(db, f, f)
	s.now = func() time.Time { return now }
	return s, f, &now
}
func TestResetScheduleOffByDefault(t *testing.T) {
	s, f, _ := resetSetup(t)
	ctx := context.Background()
	v, e := s.Get(ctx, "one")
	if e != nil || v.AutoBeforeExpiry || len(v.Tasks) != 0 {
		t.Fatalf("%+v %v", v, e)
	}
	if e = s.Reconcile(ctx, "one"); e != nil || len(f.consumed) != 0 || len(f.plans) != 0 {
		t.Fatal("default performed action", e)
	}
}
func TestResetScheduleSelectedCardRestartAndDedup(t *testing.T) {
	s, f, now := resetSetup(t)
	ctx := context.Background()
	at := now.Add(4 * time.Minute)
	if _, e := s.SetCard(ctx, "one", "b", &at); e != nil {
		t.Fatal(e)
	}
	if !f.plans[0].Equal(at.Add(-3 * time.Minute)) {
		t.Fatal("stop deadline")
	}
	if e := s.Reconcile(ctx, "one"); e != nil || len(f.consumed) != 0 {
		t.Fatal(e)
	}
	// Disabled credentials still run timers.
	if e := s.db.Model(&entities.UsageIdentity{}).Where("identity = ?", "one").Update("disabled", true).Error; e != nil {
		t.Fatal(e)
	}
	*now = at
	s = NewResetScheduleService(s.db, f, f)
	s.now = func() time.Time { return *now }
	for i := 0; i < 2; i++ {
		if e := s.Reconcile(ctx, "one"); e != nil {
			t.Fatal(e)
		}
	}
	if len(f.consumed) != 1 || f.consumed[0] != "one:b" || len(f.ids[0]) != 36 {
		t.Fatal(f.consumed, f.ids)
	}
	v, _ := s.Get(ctx, "one")
	if v.Tasks[0].State != "succeeded" || v.Tasks[0].StoppedAt == nil {
		t.Fatal(v.Tasks)
	}
	other, _ := s.Get(ctx, "two")
	if other.AutoBeforeExpiry || len(other.Tasks) > 0 {
		t.Fatal("account leaked")
	}
}
func TestResetScheduleExpiryBoundaryAndOverlap(t *testing.T) {
	s, f, now := resetSetup(t)
	ctx := context.Background()
	at := now.Add(55 * time.Minute)
	if _, e := s.SetCard(ctx, "one", "a", &at); e != nil {
		t.Fatal(e)
	}
	if _, e := s.SetAuto(ctx, "one", true); e != nil {
		t.Fatal(e)
	}
	*now = now.Add(49*time.Minute - time.Nanosecond)
	_ = s.Reconcile(ctx, "one")
	if len(f.consumed) != 0 {
		t.Fatal("early")
	}
	*now = now.Add(time.Nanosecond)
	if e := s.Reconcile(ctx, "one"); e != nil {
		t.Fatal(e)
	}
	*now = at
	_ = s.Reconcile(ctx, "one")
	if len(f.consumed) != 1 || f.consumed[0] != "one:a" {
		t.Fatal(f.consumed)
	}
}
func TestResetScheduleCancelAndInvalidTimes(t *testing.T) {
	s, f, now := resetSetup(t)
	ctx := context.Background()
	for _, at := range []time.Time{now.Add(-time.Second), now.Add(time.Hour)} {
		if _, e := s.SetCard(ctx, "one", "a", &at); e == nil {
			t.Fatal("invalid accepted")
		}
	}
	at := now.Add(4 * time.Minute)
	_, e := s.SetCard(ctx, "one", "a", &at)
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.SetCard(ctx, "one", "a", nil)
	if e != nil {
		t.Fatal(e)
	}
	*now = at
	_ = s.Reconcile(ctx, "one")
	if len(f.consumed) != 0 {
		t.Fatal("cancel consumed")
	}
}
func TestResetScheduleStopFailureAndUnknownConsume(t *testing.T) {
	s, f, now := resetSetup(t)
	ctx := context.Background()
	at := now.Add(4 * time.Minute)
	_, e := s.SetCard(ctx, "one", "a", &at)
	if e != nil {
		t.Fatal(e)
	}
	*now = at
	f.guardErr = errors.New("not drained")
	if e = s.Reconcile(ctx, "one"); e == nil || len(f.consumed) != 0 {
		t.Fatal("unsafe consume")
	}
	f.guardErr = nil
	f.err = errors.New("timeout")
	if e = s.Reconcile(ctx, "one"); e != nil {
		t.Fatal(e)
	}
	s = NewResetScheduleService(s.db, f, f)
	s.now = func() time.Time { return *now }
	_ = s.Reconcile(ctx, "one")
	v, _ := s.Get(ctx, "one")
	if len(f.consumed) != 1 || v.Tasks[0].State != "uncertain" {
		t.Fatal(v.Tasks, f.consumed)
	}
}
func TestResetScheduleExpiredAndInterruptedNeverConsume(t *testing.T) {
	s, f, now := resetSetup(t)
	ctx := context.Background()
	at := now.Add(4 * time.Minute)
	_, e := s.SetCard(ctx, "one", "a", &at)
	if e != nil {
		t.Fatal(e)
	}
	*now = now.Add(2 * time.Hour)
	_ = s.Reconcile(ctx, "one")
	v, _ := s.Get(ctx, "one")
	if v.Tasks[0].State != "expired" || len(f.consumed) != 0 {
		t.Fatal(v.Tasks)
	}
	s.db.Model(&entities.ResetTask{}).Where("auth_index = ?", "one").Update("state", "running")
	_ = s.Reconcile(ctx, "one")
	v, _ = s.Get(ctx, "one")
	if v.Tasks[0].State != "uncertain" || len(f.consumed) != 0 {
		t.Fatal(v.Tasks)
	}
}

func TestResetScheduleMissedDeadlineNeverConsumes(t *testing.T) {
	s, f, now := resetSetup(t)
	ctx := context.Background()
	at := now.Add(4 * time.Minute)
	if _, e := s.SetCard(ctx, "one", "a", &at); e != nil {
		t.Fatal(e)
	}
	*now = at.Add(time.Second)
	if e := s.Reconcile(ctx, "one"); e != nil {
		t.Fatal(e)
	}
	v, _ := s.Get(ctx, "one")
	if len(f.consumed) != 0 || v.Tasks[0].ResultCode != "deadline_missed" {
		t.Fatal(v.Tasks, f.consumed)
	}
}
func TestResetScheduleCancelledUnknownCardDoesNotBreakExpiry(t *testing.T) {
	s, f, now := resetSetup(t)
	ctx := context.Background()
	if _, e := s.SetCard(ctx, "one", "a", nil); e != nil {
		t.Fatal(e)
	}
	if _, e := s.SetAuto(ctx, "one", true); e != nil {
		t.Fatal(e)
	}
	*now = now.Add(49 * time.Minute)
	if e := s.Reconcile(ctx, "one"); e != nil {
		t.Fatal(e)
	}
	if len(f.consumed) != 1 {
		t.Fatal(f.consumed)
	}
}
func TestResetSchedulePreSendFailureRetries(t *testing.T) {
	s, f, now := resetSetup(t)
	ctx := context.Background()
	at := now.Add(4 * time.Minute)
	_, _ = s.SetCard(ctx, "one", "a", &at)
	*now = at.Add(-time.Minute)
	f.err = quota.ErrScheduledNotSent
	if e := s.Reconcile(ctx, "one"); e != nil {
		t.Fatal(e)
	}
	v, _ := s.Get(ctx, "one")
	if v.Tasks[0].State != "pending" || v.Tasks[0].Attempts != 0 {
		t.Fatal(v.Tasks)
	}
	f.err = nil
	_ = s.Reconcile(ctx, "one")
	if len(f.ids) != 2 || f.ids[0] != f.ids[1] {
		t.Fatal(f.ids)
	}
}

func TestResetScheduleDisablingAutoCancelsOnlyExpiryTasks(t *testing.T) {
	s, _, now := resetSetup(t)
	ctx := context.Background()
	at := now.Add(4 * time.Minute)
	for _, task := range []entities.ResetTask{{AuthIndex: "one", CreditID: "a", State: "pending", Source: "expiry", ExpiresAt: now.Add(time.Hour)}, {AuthIndex: "one", CreditID: "b", State: "pending", Source: "expiry", ScheduledAt: &at, ExpiresAt: now.Add(time.Hour)}} {
		if e := s.db.Create(&task).Error; e != nil {
			t.Fatal(e)
		}
	}
	v, e := s.SetAuto(ctx, "one", false)
	if e != nil {
		t.Fatal(e)
	}
	for _, task := range v.Tasks {
		if task.CreditID == "a" && task.State != "cancelled" {
			t.Fatal(task)
		}
		if task.CreditID == "b" && (task.State != "pending" || task.Source != "scheduled") {
			t.Fatal(task)
		}
	}
	*now = at.Add(-time.Minute)
	if e = s.Reconcile(ctx, "one"); e != nil {
		t.Fatal(e)
	}
	v, _ = s.Get(ctx, "one")
	for _, task := range v.Tasks {
		if task.CreditID == "b" && task.State != "succeeded" {
			t.Fatal(task)
		}
	}
}
