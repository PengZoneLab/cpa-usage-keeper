package quota

import "testing"

func TestProtectionRowsDoNotInventMissingPercent(t *testing.T) {
	output := ProviderOutput{Result: CodexResult{Usage: &CodexUsagePayload{RateLimit: &CodexRateLimitInfo{PrimaryWindow: &CodexUsageWindow{UsedPercent: 0}, SecondaryWindow: &CodexUsageWindow{UsedPercent: 0, HasUsedPercent: true}}}}}
	rows := protectionQuotaRows(output)
	if len(rows) != 2 || rows[0].UsedPercent != nil || rows[1].UsedPercent == nil {
		t.Fatalf("missing/explicit zero confused: %+v", rows)
	}
}
