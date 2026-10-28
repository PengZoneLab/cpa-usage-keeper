package service

import (
	"context"
	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/quota"
	"errors"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"path/filepath"
	"testing"
)

type floorFake struct {
	rows               []quota.QuotaRow
	checkErr, applyErr error
	calls              []bool
}

func (f *floorFake) Check(context.Context, quota.CheckRequest) (quota.CheckResponse, error) {
	return quota.CheckResponse{Quota: f.rows}, f.checkErr
}
func (f *floorFake) UpdateCredentialStatus(_ context.Context, _, _ string, disabled bool) (int, error) {
	if f.applyErr != nil {
		return 500, f.applyErr
	}
	f.calls = append(f.calls, disabled)
	return 200, nil
}
func floorPtr(v float64) *float64 { return &v }
func floorSetup(t *testing.T) (*QuotaFloorService, *floorFake, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "test.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&entities.UsageIdentity{}, &entities.CredentialQuotaFloor{}); err != nil {
		t.Fatal(err)
	}
	conn, _ := db.DB()
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = conn.Close() })
	disabled := false
	name := "test.json"
	for _, index := range []string{"one", "two"} {
		n := name + index
		if err = db.Create(&entities.UsageIdentity{Identity: index, AuthType: entities.UsageIdentityAuthTypeCredential, Type: "codex", FileName: &n, Disabled: &disabled}).Error; err != nil {
			t.Fatal(err)
		}
	}
	fake := &floorFake{rows: []quota.QuotaRow{{Key: "5h", UsedPercent: floorPtr(90)}, {Key: "weekly", UsedPercent: floorPtr(20)}}}
	return NewQuotaFloorService(db, fake, fake, &CredentialMutationLocks{}, &CredentialMetadataCoordinator{}, nil), fake, db
}
func TestQuotaFloorPauseRestartRecoveryAndIsolation(t *testing.T) {
	s, f, db := floorSetup(t)
	ctx := context.Background()
	if _, err := s.Set(ctx, " one ", floorPtr(10)); err != nil {
		t.Fatal(err)
	}
	if err := s.Reconcile(ctx, "one"); err != nil {
		t.Fatal(err)
	}
	p, _ := s.Get(ctx, "one")
	if !p.Paused || p.State != "paused" || len(f.calls) != 1 || !f.calls[0] {
		t.Fatalf("pause: %+v calls %v", p, f.calls)
	}
	var other entities.UsageIdentity
	db.First(&other, "identity = ?", "two")
	if other.Disabled == nil || *other.Disabled {
		t.Fatal("other account modified")
	}
	s = NewQuotaFloorService(db, f, f, &CredentialMutationLocks{}, nil, nil)
	f.checkErr = errors.New("timeout")
	if err := s.Reconcile(ctx, "one"); err != nil {
		t.Fatal(err)
	}
	p, _ = s.Get(ctx, "one")
	if !p.Paused || p.State != "unavailable" || len(f.calls) != 1 {
		t.Fatal("failed check resumed account")
	}
	f.checkErr = nil
	f.rows = []quota.QuotaRow{{UsedPercent: floorPtr(50)}, {}}
	_ = s.Reconcile(ctx, "one")
	if len(f.calls) != 1 {
		t.Fatal("incomplete quota resumed account")
	}
	f.rows = []quota.QuotaRow{{Key: "5h", UsedPercent: floorPtr(89.9)}, {Key: "weekly", UsedPercent: floorPtr(10)}, {Key: "", UsedPercent: floorPtr(0)}}
	if err := s.Reconcile(ctx, "one"); err != nil {
		t.Fatal(err)
	}
	p, _ = s.Get(ctx, "one")
	if p.Paused || len(f.calls) != 2 || f.calls[1] {
		t.Fatalf("recovery: %+v %v", p, f.calls)
	}
}
func TestQuotaFloorManualHoldAndClear(t *testing.T) {
	s, f, _ := floorSetup(t)
	ctx := context.Background()
	_, _ = s.Set(ctx, "one", floorPtr(10))
	_ = s.Reconcile(ctx, "one")
	if err := s.prepareManual(ctx, "test.jsonone", "", true); err != nil {
		t.Fatal(err)
	}
	f.rows = []quota.QuotaRow{{UsedPercent: floorPtr(0)}}
	_ = s.Reconcile(ctx, "one")
	p, _ := s.Get(ctx, "one")
	if !p.ManualHold || p.Paused || len(f.calls) != 1 {
		t.Fatal("manual stop was released")
	}
	_, err := s.Set(ctx, "one", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(f.calls) != 1 {
		t.Fatal("clearing policy released manual hold")
	}
}
func TestQuotaFloorFailedApplyRetryAndManualEnable(t *testing.T) {
	s, f, _ := floorSetup(t)
	ctx := context.Background()
	_, _ = s.Set(ctx, "one", floorPtr(10))
	f.applyErr = errors.New("CPA offline")
	if s.Reconcile(ctx, "one") == nil {
		t.Fatal("expected apply error")
	}
	p, _ := s.Get(ctx, "one")
	if !p.Paused || p.State != "apply_failed" {
		t.Fatalf("lost retry intent: %+v", p)
	}
	f.applyErr = nil
	_ = s.Reconcile(ctx, "one")
	if len(f.calls) != 1 {
		t.Fatal("did not retry")
	}
	if !errors.Is(s.prepareManual(ctx, "test.jsonone", "one", false), ErrQuotaFloorBlocked) {
		t.Fatal("enabled low quota")
	}
	if _, err := s.Set(ctx, "one", nil); err != nil {
		t.Fatal(err)
	}
	if len(f.calls) != 2 || f.calls[1] {
		t.Fatal("clearing owned pause did not resume")
	}
}
func TestQuotaFloorInitiallyDisabledAndValidation(t *testing.T) {
	s, f, db := floorSetup(t)
	ctx := context.Background()
	db.Model(&entities.UsageIdentity{}).Where("identity = ?", "one").Update("disabled", true)
	_, _ = s.Set(ctx, "one", floorPtr(10))
	_ = s.Reconcile(ctx, "one")
	p, _ := s.Get(ctx, "one")
	if !p.ManualHold || len(f.calls) != 0 {
		t.Fatal("adopted manual disable")
	}
	for _, value := range []float64{-1, 101} {
		if _, err := s.Set(ctx, "two", &value); !errors.Is(err, ErrCredentialStatusValidation) {
			t.Fatal("accepted invalid floor")
		}
	}
	if _, err := s.Set(ctx, "missing", floorPtr(10)); !errors.Is(err, ErrCredentialStatusNotFound) {
		t.Fatal("accepted missing account")
	}
}
func TestQuotaFloorDecision(t *testing.T) {
	for _, test := range []struct {
		name          string
		rows          []quota.QuotaRow
		floor         float64
		low, complete bool
	}{
		{"exact", []quota.QuotaRow{{UsedPercent: floorPtr(90)}}, 10, true, true},
		{"above", []quota.QuotaRow{{UsedPercent: floorPtr(89.99)}}, 10, false, true},
		{"fraction", []quota.QuotaRow{{RemainingFraction: floorPtr(.1)}}, 10, true, true},
		{"absolute", []quota.QuotaRow{{Remaining: floorPtr(1), Limit: floorPtr(10)}}, 10, true, true},
		{"empty", nil, 10, false, false},
		{"unknown", []quota.QuotaRow{{}}, 10, false, false},
		{"low plus unknown", []quota.QuotaRow{{UsedPercent: floorPtr(90)}, {}}, 10, true, false},
		{"zero", []quota.QuotaRow{{UsedPercent: floorPtr(100)}}, 0, true, true},
		{"hundred", []quota.QuotaRow{{UsedPercent: floorPtr(0)}}, 100, true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			low, complete, _ := quotaFloorDecision(test.rows, test.floor)
			if low != test.low || complete != test.complete {
				t.Fatalf("got %v %v", low, complete)
			}
		})
	}
}
