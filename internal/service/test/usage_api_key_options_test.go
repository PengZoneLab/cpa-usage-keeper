package test

import (
	"context"
	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/repository"
	"cpa-usage-keeper/internal/service"
	servicedto "cpa-usage-keeper/internal/service/dto"
	"testing"
	"time"
)

func TestUsageServiceScopedAPIKeyOptions(t *testing.T) {
	db := openUsageServiceTestDatabase(t)
	now := time.Now()
	if err := repository.SyncCPAAPIKeys(db, []string{"used", "unused"}, now); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&entities.UsageEvent{EventKey: "candidate", APIGroupKey: "used", Timestamp: now.Add(-time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}
	p := service.NewUsageService(db, emptyPricingCatalogForTest()).(service.UsageAPIKeyOptionsProvider)
	start := now.Add(-time.Hour)
	rows, err := p.ListUsageAPIKeyOptions(context.Background(), "request-events", servicedto.UsageFilter{StartTime: &start, EndTime: &now, EndExclusive: true, APIKeyID: "invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].APIKey != "used" {
		t.Fatal(rows)
	}
}
