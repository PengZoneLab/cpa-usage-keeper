package api

import (
	"context"
	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/quota"
	"cpa-usage-keeper/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type scheduleAPIStub struct{}

func (scheduleAPIStub) GetResetCredits(context.Context, quota.ResetCreditsRequest) (quota.ResetCreditsResponse, error) {
	return quota.ResetCreditsResponse{Credits: []quota.CodexRateLimitResetCredit{}}, nil
}
func (scheduleAPIStub) ConsumeScheduledCredit(context.Context, string, string, string, time.Time) (quota.ProviderResetOutput, error) {
	panic("unexpected consume")
}
func (scheduleAPIStub) PlanStop(context.Context, string, *time.Time) error { return nil }
func (scheduleAPIStub) WithStopped(context.Context, string, func() error) error {
	panic("unexpected stop")
}
func TestResetScheduleRoutesValidateAndRequireAdmin(t *testing.T) {
	db, e := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "test.db")), &gorm.Config{})
	if e != nil {
		t.Fatal(e)
	}
	conn, _ := db.DB()
	t.Cleanup(func() { conn.Close() })
	if e = db.AutoMigrate(&entities.UsageIdentity{}, &entities.ResetPolicy{}, &entities.ResetTask{}); e != nil {
		t.Fatal(e)
	}
	db.Create(&entities.UsageIdentity{AuthType: entities.UsageIdentityAuthTypeCredential, Identity: "test", Type: "codex"})
	stub := scheduleAPIStub{}
	s := service.NewResetScheduleService(db, stub, stub)
	r := gin.New()
	registerResetScheduleRoutes(r, s)
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{{"GET", "/credentials/test/reset-schedule", "", 200}, {"PUT", "/credentials/test/reset-schedule", `{}`, 400}, {"PUT", "/credentials/test/reset-schedule", `{"auto_before_expiry":null}`, 400}, {"PUT", "/credentials/test/reset-schedule", `{"auto_before_expiry":true}`, 200}, {"PUT", "/credentials/test/reset-schedule/cards/a", `{}`, 400}, {"PUT", "/credentials/test/reset-schedule/cards/a", `{"scheduled_at":"2026-12-01T12:00"}`, 400}, {"PUT", "/credentials/test/reset-schedule/cards/a", `{"scheduled_at":null}`, 200}, {"GET", "/credentials/missing/reset-schedule", "", 404}} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("%s %s => %d %s", tc.method, tc.body, w.Code, w.Body.String())
		}
	}
	protected := NewRouter(nil, nil, nil, nil, AuthConfig{Enabled: true}, nil, "", OptionalProviders{ResetSchedule: s})
	for _, method := range []string{"GET", "PUT"} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/api/v1/credentials/test/reset-schedule", strings.NewReader(`{"auto_before_expiry":true}`))
		req.Header.Set("X-CPA-Usage-Keeper-Request", "fetch")
		protected.ServeHTTP(w, req)
		if w.Code != 401 {
			t.Fatalf("unprotected %s: %d", method, w.Code)
		}
	}
}
