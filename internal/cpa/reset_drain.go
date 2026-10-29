package cpa

import (
	"context"
	"fmt"
)

// WithDrained requires a positive receipt from the patched CPA. Older CPA versions
// fail closed rather than turning disabled=true into a fictitious drain guarantee.
func (c *Client) WithDrained(ctx context.Context, index string, fn func() error) error {
	var receipt struct {
		AuthIndex string `json:"auth_index"`
		Disabled  bool   `json:"disabled"`
		Active    *int   `json:"active"`
		Drained   bool   `json:"drained"`
	}
	_, _, err := c.doManagementJSONPostRequest(ctx, "/v8/management/routing/stop-and-cancel", struct {
		AuthIndex string `json:"auth_index"`
	}{index}, &receipt, "account stop and cancel")
	if err != nil {
		return err
	}
	if receipt.AuthIndex != index || !receipt.Disabled || !receipt.Drained || receipt.Active == nil || *receipt.Active != 0 {
		return fmt.Errorf("account drain not confirmed")
	}
	return fn()
}
