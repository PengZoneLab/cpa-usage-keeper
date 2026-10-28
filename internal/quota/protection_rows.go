package quota

// Protection must distinguish missing values from explicit zero usage. UI normalization
// remains unchanged; this stricter projection is used only for automated account control.
func protectionQuotaRows(output ProviderOutput) []QuotaRow {
	rows := NormalizeQuotaRows(output)
	var claude *ClaudeResult
	switch value := output.Result.(type) {
	case ClaudeResult:
		claude = &value
	case *ClaudeResult:
		claude = value
	}
	if claude != nil && claude.Usage != nil {
		usage := claude.Usage
		windows := map[string]*ClaudeUsageWindow{"five_hour": usage.FiveHour, "seven_day": usage.SevenDay, "seven_day_oauth_apps": usage.SevenDayOAuthApps, "seven_day_opus": usage.SevenDayOpus, "seven_day_sonnet": usage.SevenDaySonnet, "seven_day_cowork": usage.SevenDayCowork, "iguana_necktie": usage.IguanaNecktie}
		for i := range rows {
			if window, ok := windows[rows[i].Key]; ok && (window == nil || !window.HasUtilization) {
				rows[i].UsedPercent = nil
			}
		}
		return rows
	}
	var result CodexResult
	switch value := output.Result.(type) {
	case CodexResult:
		result = value
	case *CodexResult:
		if value == nil {
			return rows
		}
		result = *value
	default:
		return rows
	}
	if result.Usage == nil {
		return rows
	}
	known := map[string]bool{}
	add := func(prefix string, info *CodexRateLimitInfo) {
		if info == nil {
			return
		}
		known[prefix+".primary_window"] = info.PrimaryWindow != nil && info.PrimaryWindow.HasUsedPercent
		known[prefix+".secondary_window"] = info.SecondaryWindow != nil && info.SecondaryWindow.HasUsedPercent
	}
	add("rate_limit", result.Usage.RateLimit)
	add("code_review_rate_limit", result.Usage.CodeReviewRateLimit)
	for _, extra := range result.Usage.AdditionalRateLimits {
		add("additional_rate_limits."+extra.LimitName, extra.RateLimit)
	}
	for i := range rows {
		if !known[rows[i].Key] {
			rows[i].UsedPercent = nil
		}
	}
	return rows
}
