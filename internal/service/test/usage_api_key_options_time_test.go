package test

import (
	"context"
	"testing"
	"time"

	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/repository"
	"cpa-usage-keeper/internal/service"
	servicedto "cpa-usage-keeper/internal/service/dto"
)

func TestUsageServiceScopedAPIKeyOptionsPreserveQueryClock(t *testing.T) {
	for _, cached := range []bool{false, true} {
		name := "database"
		if cached {
			name = "cache"
		}
		t.Run(name, func(t *testing.T) {
			db := openUsageServiceTestDatabase(t)
			end := time.Date(2024, 1, 15, 12, 0, 0, 500000000, time.Local)
			if err := repository.SyncCPAAPIKeys(db, []string{"used", "expired", "at-end", "future"}, end); err != nil {
				t.Fatal(err)
			}
			cost, available := 0.0, true
			for key, at := range map[string]time.Time{"used": end.Add(-time.Minute), "expired": end.Add(-16 * time.Minute), "at-end": end, "future": end.Add(time.Minute)} {
				if err := db.Create(&entities.UsageEvent{EventKey: key, APIGroupKey: key, Timestamp: at, CostUSD: &cost, CostAvailable: &available}).Error; err != nil {
					t.Fatal(err)
				}
			}
			var cache *repository.UsageRecentEventCache
			if cached {
				var err error
				cache, err = repository.NewUsageRecentEventCache(db, repository.UsageRecentEventCacheOptions{Now: func() time.Time { return end }})
				if err != nil {
					t.Fatal(err)
				}
				defer cache.Close()
			}
			provider := service.NewUsageServiceWithRecentCache(db, cache, emptyPricingCatalogForTest()).(service.UsageAPIKeyOptionsProvider)
			later := end.Add(2 * time.Hour)
			for _, tc := range []struct {
				name   string
				filter servicedto.UsageFilter
			}{
				{"explicit realtime end", servicedto.UsageFilter{RealtimeWindow: "15m", RealtimeEndTime: &end}},
				{"query now fallback", servicedto.UsageFilter{RealtimeWindow: "15m", QueryNow: &end}},
				{"explicit end takes precedence", servicedto.UsageFilter{RealtimeWindow: "15m", RealtimeEndTime: &end, QueryNow: &later}},
			} {
				t.Run(tc.name, func(t *testing.T) {
					rows, err := provider.ListUsageAPIKeyOptions(context.Background(), "realtime", tc.filter)
					if err != nil {
						t.Fatal(err)
					}
					if len(rows) != 1 || rows[0].APIKey != "used" {
						t.Fatalf("fixed window returned %+v", rows)
					}
				})
			}
		})
	}
}
