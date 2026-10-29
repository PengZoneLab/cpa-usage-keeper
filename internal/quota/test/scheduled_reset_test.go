package test

import (
	"context"
	"cpa-usage-keeper/internal/cpa/dto/apicall"
	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/quota"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestScheduledCreditUsesExactIDAndNeverRecoversRouting(t *testing.T) {
	for _, code := range []string{"reset", "nothing_to_reset", "already_redeemed", "no_credit"} {
		t.Run(code, func(t *testing.T) {
			db := openQuotaTestDB(t)
			disabled := true
			seedUsageIdentity(t, db, entities.UsageIdentity{AuthType: entities.UsageIdentityAuthTypeCredential, Identity: "codex-auth", Type: "codex", Disabled: &disabled})
			caller := &recordingManagementCaller{responses: []*apicall.Response{{StatusCode: 200, BodyText: `{"credits":[{"id":"selected","reset_type":"codex_rate_limits","status":"available","expires_at":"2099-10-01T00:00:00Z"},{"id":"other","reset_type":"codex_rate_limits","status":"available","expires_at":"2099-09-01T00:00:00Z"}]}`}, {StatusCode: 200, BodyText: `{"code":"` + code + `","windows_reset":2}`}}}
			s := newQuotaServiceWithRegistry(t, db, quota.NewDefaultProviderRegistry(caller, quota.DefaultProviderConfigs()))
			out, e := s.ConsumeScheduledCredit(context.Background(), "codex-auth", "selected", "01234567-89ab-4cde-8fab-0123456789ab", time.Now().Add(time.Minute))
			if e != nil || out.Code != code {
				t.Fatal(out, e)
			}
			if len(caller.requests) != 2 {
				t.Fatalf("unexpected calls %d", len(caller.requests))
			}
			req := caller.requests[1]
			b, _ := json.Marshal(req.Data)
			var data map[string]string
			_ = json.Unmarshal(b, &data)
			if data["credit_id"] != "selected" || data["redeem_request_id"] != "01234567-89ab-4cde-8fab-0123456789ab" {
				t.Fatal(data)
			}
		})
	}
}

func TestScheduledCreditValidationAllowlistFailsBeforeAnyUpstreamCall(t *testing.T) {
	db := openQuotaTestDB(t)
	seedUsageIdentity(t, db, entities.UsageIdentity{AuthType: entities.UsageIdentityAuthTypeCredential, Identity: "account", Type: "codex"})
	caller := &recordingManagementCaller{}
	s := newQuotaServiceWithRegistryAndOptions(t, db, quota.NewDefaultProviderRegistry(caller, quota.DefaultProviderConfigs()), quota.ServiceOptions{ScheduledCreditAllowlist: map[string][]string{"account": {"only-card"}}})
	for _, pair := range [][2]string{{"account", "other-card"}, {"other-account", "only-card"}} {
		_, e := s.ConsumeScheduledCredit(context.Background(), pair[0], pair[1], "id", time.Now().Add(time.Minute))
		if !errors.Is(e, quota.ErrScheduledNotSent) {
			t.Fatal(e)
		}
	}
	if len(caller.requests) != 0 {
		t.Fatal("out of scope upstream call")
	}
	for _, input := range []string{"null", "[]", "bad", `{"":[]}`, `{"a":[""]}`} {
		if _, e := quota.ParseScheduledCreditAllowlist(input); e == nil {
			t.Fatal("invalid scope accepted", input)
		}
	}
	if a, e := quota.ParseScheduledCreditAllowlist("{}"); e != nil || a == nil {
		t.Fatal("empty deny-all lost")
	}
}
