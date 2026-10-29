package quota

import (
	"context"
	"cpa-usage-keeper/internal/cpa/dto/apicall"
	"cpa-usage-keeper/internal/repository"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

// ErrScheduledNotSent identifies failures before an upstream consumption request.
var ErrScheduledNotSent = errors.New("scheduled reset was not sent")

// ConsumeScheduledCredit consumes exactly one selected card without clearing CPA cooldown
// or changing routing. Its durable request ID is supplied by the scheduler.
func (s *Service) ConsumeScheduledCredit(ctx context.Context, index, creditID, requestID string, deadline time.Time) (ProviderResetOutput, error) {
	if s.scheduledCreditAllowlist != nil && !slices.Contains(s.scheduledCreditAllowlist[index], creditID) {
		return ProviderResetOutput{}, fmt.Errorf("%w: outside configured validation scope", ErrScheduledNotSent)
	}
	if strings.TrimSpace(creditID) == "" || strings.TrimSpace(requestID) == "" {
		return ProviderResetOutput{}, ErrValidation
	}
	if !s.beginReset(index) {
		return ProviderResetOutput{}, fmt.Errorf("%w: %v", ErrScheduledNotSent, ErrResetInProgress)
	}
	defer s.finishReset(index)
	identity, err := repository.GetActiveCredentialUsageIdentityByAuthIndex(ctx, s.db, index)
	if err != nil {
		return ProviderResetOutput{}, fmt.Errorf("%w: %v", ErrScheduledNotSent, err)
	}
	typ, handler, ok := s.resolveQuotaHandlerForIdentity(identity)
	if !ok || typ != "codex" {
		return ProviderResetOutput{}, ErrUnsupportedType
	}
	provider, ok := handler.(codexProvider)
	if !ok {
		return ProviderResetOutput{}, ErrUnsupportedType
	}
	// Revalidate the card under the same lock used by manual resets.
	cards, err := provider.ListResetCredits(ctx, ProviderInput{Identity: identity})
	if err != nil {
		return ProviderResetOutput{}, fmt.Errorf("%w: %v", ErrScheduledNotSent, err)
	}
	found := false
	for _, card := range cards.Credits {
		if card.ID == creditID {
			expiry, e := time.Parse(time.RFC3339Nano, card.ExpiresAt)
			found = e == nil && expiry.After(time.Now())
			break
		}
	}
	if !found {
		return ProviderResetOutput{Code: "no_credit"}, nil
	}
	if ctx.Err() != nil || time.Now().After(deadline) {
		return ProviderResetOutput{}, fmt.Errorf("%w: deadline reached", ErrScheduledNotSent)
	}
	response, err := provider.caller.CallManagementAPI(ctx, apicall.Request{AuthIndex: index, Method: "POST", URL: CodexRateLimitResetCreditsConsumeURL, Header: provider.requestHeaders(identity), Data: map[string]string{"redeem_request_id": requestID, "credit_id": creditID}})
	if err != nil {
		return ProviderResetOutput{}, err
	}
	object, err := parseResponseObject(response)
	if err != nil {
		return ProviderResetOutput{}, err
	}
	code := stringField(object, "code")
	switch code {
	case "reset":
		return parseCodexResetCreditResponse(response)
	case "nothing_to_reset", "no_credit", "already_redeemed":
		return ProviderResetOutput{Code: code}, nil
	default:
		return ProviderResetOutput{}, fmt.Errorf("unknown consume result")
	}
}

// ParseScheduledCreditAllowlist returns nil only for an absent restriction.
// An explicit empty object denies all scheduled consumptions.
func ParseScheduledCreditAllowlist(value string) (map[string][]string, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	var allowed map[string][]string
	if err := json.Unmarshal([]byte(value), &allowed); err != nil || allowed == nil {
		return nil, fmt.Errorf("invalid RESET_SCHEDULE_ALLOWED_CREDITS JSON object")
	}
	for index, cards := range allowed {
		if strings.TrimSpace(index) == "" {
			return nil, ErrValidation
		}
		for _, card := range cards {
			if strings.TrimSpace(card) == "" {
				return nil, ErrValidation
			}
		}
	}
	return allowed, nil
}
