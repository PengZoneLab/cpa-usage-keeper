package service

import (
	"context"
	"cpa-usage-keeper/internal/cpa/dto/response"
	"errors"
	"time"
)

var ErrResetDrainUnavailable = errors.New("reset blocked: authoritative account drain is unavailable")

type ResetCredentialReader interface {
	FetchCredentials(context.Context) (*response.CredentialsResult, error)
}

// AccountDrain must prevent admission and wait for existing executions, not merely
// observe a quiet log. Nil is deliberately fail-closed.
type AccountDrain interface {
	WithDrained(context.Context, string, func() error) error
}
type resetRoutingGuard struct {
	floor  *QuotaFloorService
	reader ResetCredentialReader
	drain  AccountDrain
}

func NewResetRoutingGuard(floor *QuotaFloorService, reader ResetCredentialReader, drain AccountDrain) ResetRoutingGuard {
	return &resetRoutingGuard{floor, reader, drain}
}
func (g *resetRoutingGuard) PlanStop(ctx context.Context, index string, at *time.Time) error {
	i, e := g.floor.identity(ctx, index)
	if e != nil {
		return e
	}
	defer g.floor.locks.lockCredential(*i.FileName)()
	p, e := g.floor.load(ctx, index)
	if e != nil {
		return e
	}
	if !policyDispatchExpired(p, time.Now()) {
		p.ResetDispatchUntil = at
		if e = g.floor.save(ctx, &p); e != nil {
			return e
		}
	}
	select {
	case g.floor.wake <- struct{}{}:
	default:
	}
	return nil
}
func (g *resetRoutingGuard) WithStopped(ctx context.Context, index string, fn func() error) error {
	i, e := g.floor.identity(ctx, index)
	if e != nil {
		return e
	}
	defer g.floor.locks.lockCredential(*i.FileName)()
	i, e = g.floor.identity(ctx, index)
	if e != nil {
		return e
	}
	p, e := g.floor.load(ctx, index)
	if e != nil {
		return e
	}
	now := time.Now()
	if p.ResetDispatchUntil == nil || p.ResetDispatchUntil.After(now) {
		p.ResetDispatchUntil = &now
	}
	// ManualHold ensures no quota-floor recovery can re-enable the reset account.
	p.ManualHold = true
	if e = g.floor.pauseDeadline(ctx, i, &p); e != nil {
		return e
	}
	r, e := g.reader.FetchCredentials(ctx)
	if e != nil {
		return e
	}
	stopped := false
	for _, c := range r.Payload.Files {
		if c.AuthIndex == index {
			stopped = c.Disabled != nil && *c.Disabled
			break
		}
	}
	if !stopped {
		return errors.New("reset blocked: CPA did not confirm disabled")
	}
	if g.drain == nil {
		return ErrResetDrainUnavailable
	}
	return g.drain.WithDrained(ctx, index, fn)
}
