package api

import (
	"context"
	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestQuotaFloorRoutesPersistValidateAndIsolate(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "test.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&entities.UsageIdentity{}, &entities.CredentialQuotaFloor{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	filename := "test.json"
	db.Create(&entities.UsageIdentity{Identity: "test", AuthType: entities.UsageIdentityAuthTypeCredential, FileName: &filename})
	floor := service.NewQuotaFloorService(db, nil, nil, &service.CredentialMutationLocks{}, nil, nil)
	router := gin.New()
	registerQuotaFloorRoutes(router, floor)
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/credentials/test/quota-floor", "", 200},
		{"PUT", "/credentials/test/quota-floor", `{"minimum_percent":null,"dispatch_until":"2026-10-30T12:00:00+08:00"}`, 200},
		{"PUT", "/credentials/test/quota-floor", `{"minimum_percent":null,"dispatch_until":"2026-10-30T12:00"}`, 400},
		{"PUT", "/credentials/test/quota-floor", `{"minimum_percent":null,"dispatch_until":123}`, 400},
		{"PUT", "/credentials/test/quota-floor", `{}`, 400},
		{"PUT", "/credentials/test/quota-floor", `{"minimum_percent":"10"}`, 400},
		{"PUT", "/credentials/test/quota-floor", `{"minimum_percent":101}`, 400},
		{"PUT", "/credentials/test/quota-floor", `{"minimum_percent":10}`, 200},
		{"PUT", "/credentials/missing/quota-floor", `{"minimum_percent":10}`, 404},
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d %s", tc.method, tc.body, w.Code, w.Body.String())
		}
	}
	p, err := floor.Get(context.Background(), "test")
	if err != nil || p.MinimumPercent == nil || *p.MinimumPercent != 10 || p.DispatchUntil == nil {
		t.Fatal("not persisted")
	}
	// The production router must put this route behind the existing admin guard.
	protected := NewRouter(nil, nil, nil, nil, AuthConfig{Enabled: true}, nil, "", OptionalProviders{QuotaFloor: floor})
	w := httptest.NewRecorder()
	protected.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/credentials/test/quota-floor", nil))
	if w.Code != 401 {
		t.Fatalf("unprotected route: %d", w.Code)
	}
}
