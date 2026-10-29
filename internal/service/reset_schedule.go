package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/quota"
	"cpa-usage-keeper/internal/repository"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The guard must synchronously stop routing and drain admitted requests. Failure is
// fail-closed: a reset credit must never be consumed without this prerequisite.
type ResetRoutingGuard interface {
	PlanStop(context.Context, string, *time.Time) error
	WithStopped(context.Context, string, func() error) error
}
type ResetQuotaClient interface {
	GetResetCredits(context.Context, quota.ResetCreditsRequest) (quota.ResetCreditsResponse, error)
	ConsumeScheduledCredit(context.Context, string, string, string, time.Time) (quota.ProviderResetOutput, error)
}
type ResetScheduleView struct {
	entities.ResetPolicy
	Credits []quota.CodexRateLimitResetCredit `json:"credits"`
	Tasks   []entities.ResetTask              `json:"tasks"`
}
type ResetScheduleService struct {
	db    *gorm.DB
	quota ResetQuotaClient
	guard ResetRoutingGuard
	locks sync.Map
	now   func() time.Time
	wake  chan struct{}
}

func NewResetScheduleService(db *gorm.DB, q ResetQuotaClient, g ResetRoutingGuard) *ResetScheduleService {
	return &ResetScheduleService{db: db, quota: q, guard: g, now: time.Now, wake: make(chan struct{}, 1)}
}
func (s *ResetScheduleService) lock(index string) func() {
	m, _ := s.locks.LoadOrStore(index, &sync.Mutex{})
	m.(*sync.Mutex).Lock()
	return m.(*sync.Mutex).Unlock
}
func (s *ResetScheduleService) validate(ctx context.Context, index string) error {
	i, e := repository.GetActiveCredentialUsageIdentityByAuthIndex(ctx, s.db, index)
	if e != nil {
		return e
	}
	if strings.ToLower(strings.TrimSpace(i.Type)) != "codex" && strings.ToLower(strings.TrimSpace(i.Provider)) != "codex" {
		return quota.ErrUnsupportedType
	}
	return nil
}
func (s *ResetScheduleService) policy(ctx context.Context, index string) (entities.ResetPolicy, error) {
	p := entities.ResetPolicy{AuthIndex: index}
	e := s.db.WithContext(ctx).First(&p, "auth_index = ?", index).Error
	if errors.Is(e, gorm.ErrRecordNotFound) {
		e = nil
	}
	return p, e
}
func (s *ResetScheduleService) view(ctx context.Context, index string) (ResetScheduleView, error) {
	p, e := s.policy(ctx, index)
	v := ResetScheduleView{ResetPolicy: p, Credits: []quota.CodexRateLimitResetCredit{}, Tasks: []entities.ResetTask{}}
	if e != nil {
		return v, e
	}
	if e = s.db.WithContext(ctx).Where("auth_index = ?", index).Order("updated_at DESC").Find(&v.Tasks).Error; e != nil {
		return v, e
	}
	r, e := s.quota.GetResetCredits(ctx, quota.ResetCreditsRequest{AuthIndex: index})
	if e != nil {
		v.Error = "credits_unavailable"
		return v, nil
	}
	v.Credits = r.Credits
	return v, nil
}
func (s *ResetScheduleService) Get(ctx context.Context, index string) (ResetScheduleView, error) {
	defer s.lock(index)()
	if e := s.validate(ctx, index); e != nil {
		return ResetScheduleView{}, e
	}
	return s.view(ctx, index)
}
func (s *ResetScheduleService) SetAuto(ctx context.Context, index string, enabled bool) (ResetScheduleView, error) {
	defer s.lock(index)()
	if e := s.validate(ctx, index); e != nil {
		return ResetScheduleView{}, e
	}
	p, e := s.policy(ctx, index)
	if e != nil {
		return ResetScheduleView{}, e
	}
	p.AutoBeforeExpiry = enabled
	p.Error = ""
	if e = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&p).Error; err != nil {
			return err
		}
		if !enabled {
			q := tx.Model(&entities.ResetTask{}).Where("auth_index = ? AND state = ? AND source = ?", index, "pending", "expiry")
			if err := q.Where("scheduled_at IS NULL").Updates(map[string]any{"state": "cancelled", "updated_at": s.now()}).Error; err != nil {
				return err
			}
			if err := tx.Model(&entities.ResetTask{}).Where("auth_index = ? AND state = ? AND source = ? AND scheduled_at IS NOT NULL", index, "pending", "expiry").Updates(map[string]any{"source": "scheduled", "updated_at": s.now()}).Error; err != nil {
				return err
			}
		}
		return nil
	}); e != nil {
		return ResetScheduleView{}, e
	}
	if e = s.replan(ctx, index); e != nil {
		return ResetScheduleView{}, e
	}
	s.notify()
	return s.view(ctx, index)
}
func (s *ResetScheduleService) SetCard(ctx context.Context, index, cardID string, at *time.Time) (ResetScheduleView, error) {
	defer s.lock(index)()
	if e := s.validate(ctx, index); e != nil {
		return ResetScheduleView{}, e
	}
	if strings.TrimSpace(cardID) == "" {
		return ResetScheduleView{}, quota.ErrValidation
	}
	t := entities.ResetTask{AuthIndex: index, CreditID: cardID}
	e := s.db.WithContext(ctx).First(&t, "auth_index = ? AND credit_id = ?", index, cardID).Error
	if e != nil && !errors.Is(e, gorm.ErrRecordNotFound) {
		return ResetScheduleView{}, e
	}
	if t.Attempts > 0 || t.State == "running" || t.State == "succeeded" {
		return ResetScheduleView{}, fmt.Errorf("%w: card already attempted", quota.ErrValidation)
	}
	if at == nil && errors.Is(e, gorm.ErrRecordNotFound) {
		return s.view(ctx, index)
	}
	if at == nil {
		t.ScheduledAt = nil
		t.State = "cancelled"
	} else {
		if at.Before(s.now().Add(3*time.Minute)) || at.Year() > 9999 {
			return ResetScheduleView{}, quota.ErrValidation
		}
		r, e := s.quota.GetResetCredits(ctx, quota.ResetCreditsRequest{AuthIndex: index})
		if e != nil {
			return ResetScheduleView{}, e
		}
		found := false
		for _, c := range r.Credits {
			if c.ID == cardID && c.Status == "available" {
				expiry, e := time.Parse(time.RFC3339Nano, c.ExpiresAt)
				if e == nil && at.Before(expiry) {
					t.ExpiresAt = expiry
					found = true
				}
				break
			}
		}
		if !found {
			return ResetScheduleView{}, fmt.Errorf("%w: card unavailable or schedule beyond expiry", quota.ErrValidation)
		}

		t.ScheduledAt = at
		t.State = "pending"
		t.Source = "scheduled"
		t.ResultCode = ""
	}
	t.UpdatedAt = s.now()
	if e = s.db.WithContext(ctx).Save(&t).Error; e != nil {
		return ResetScheduleView{}, e
	}
	if e = s.replan(ctx, index); e != nil {
		return ResetScheduleView{}, e
	}
	s.notify()
	return s.view(ctx, index)
}
func (s *ResetScheduleService) notify() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}
func resetRequestID() (string, error) {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		return "", e
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	h := hex.EncodeToString(b[:])
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:], nil
}
func (s *ResetScheduleService) saveTask(ctx context.Context, t *entities.ResetTask) error {
	t.UpdatedAt = s.now()
	return s.db.WithContext(ctx).Save(t).Error
}
func (s *ResetScheduleService) Reconcile(ctx context.Context, index string) error {
	defer s.lock(index)()
	if e := s.validate(ctx, index); e != nil {
		return e
	}
	p, e := s.policy(ctx, index)
	if e != nil {
		return e
	}
	now := s.now()
	p.CheckedAt = &now
	fail := func(e error) error {
		p.Error = "check_or_stop_failed"
		_ = s.db.WithContext(ctx).Save(&p).Error
		return e
	}
	r, e := s.quota.GetResetCredits(ctx, quota.ResetCreditsRequest{AuthIndex: index})
	if e != nil {
		return fail(e)
	}
	available := map[string]time.Time{}
	for _, c := range r.Credits {
		expiry, e := time.Parse(time.RFC3339Nano, c.ExpiresAt)
		if e != nil || c.ID == "" || c.Status != "available" {
			continue
		}
		available[c.ID] = expiry
		if p.AutoBeforeExpiry && expiry.After(now) {

			if !now.Before(expiry.Add(-13 * time.Minute)) {
				t := entities.ResetTask{AuthIndex: index, CreditID: c.ID, ExpiresAt: expiry, State: "pending", Source: "expiry", UpdatedAt: now}
				if e = s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&t).Error; e != nil {
					return fail(e)
				}
				// Cancelling a single-card timer does not switch off the separate account policy.
				if e = s.db.WithContext(ctx).Model(&entities.ResetTask{}).Where("auth_index = ? AND credit_id = ? AND state = ? AND attempts = 0", index, c.ID, "cancelled").Updates(map[string]any{"state": "pending", "source": "expiry", "expires_at": expiry}).Error; e != nil {
					return fail(e)
				}
			}
		}
	}
	var tasks []entities.ResetTask
	if e = s.db.WithContext(ctx).Where("auth_index = ? AND state IN ?", index, []string{"pending", "running"}).Find(&tasks).Error; e != nil {
		return fail(e)
	}
	for _, t := range tasks {
		if t.State == "running" {
			t.State = "uncertain"
			t.ResultCode = "interrupted_do_not_retry"
			if e = s.saveTask(ctx, &t); e != nil {
				return fail(e)
			}
			continue
		}
		if t.ScheduledAt == nil && !p.AutoBeforeExpiry {
			continue
		}
		expiry, present := available[t.CreditID]
		if !t.ExpiresAt.After(now) {
			t.State = "expired"
			t.ResultCode = "expired"
			if e = s.saveTask(ctx, &t); e != nil {
				return fail(e)
			}
			continue
		}
		if !present {
			t.State = "unavailable"
			t.ResultCode = "no_credit"
			if e = s.saveTask(ctx, &t); e != nil {
				return fail(e)
			}
			continue
		}
		var target *time.Time
		if t.ScheduledAt != nil {
			v := *t.ScheduledAt
			target = &v
		}
		if p.AutoBeforeExpiry {
			v := expiry.Add(-10 * time.Minute)
			if target == nil || v.Before(*target) {
				target = &v
				t.Source = "expiry"
			}
		}
		if target == nil {
			continue
		}
		if now.After(*target) {
			t.State = "failed"
			t.ResultCode = "deadline_missed"
			if e = s.saveTask(ctx, &t); e != nil {
				return fail(e)
			}
			continue
		}
		if now.Before(target.Add(-time.Minute)) {
			continue
		}
		deadlineCtx, cancelDeadline := context.WithDeadline(ctx, *target)

		// Keep the guard held across consumption. A concurrent enable must not race this.
		e = s.guard.WithStopped(deadlineCtx, index, func() error {
			if !t.ExpiresAt.After(s.now()) || s.now().After(*target) {
				t.State = "expired"
				return s.saveTask(ctx, &t)
			}
			if t.RequestID == "" {
				id, e := resetRequestID()
				if e != nil {
					return e
				}
				t.RequestID = id
			}
			stopped := s.now()
			t.StoppedAt = &stopped
			t.State = "running"
			t.Attempts++
			if e = s.saveTask(ctx, &t); e != nil {
				return e
			}
			out, consumeErr := s.quota.ConsumeScheduledCredit(deadlineCtx, index, t.CreditID, t.RequestID, *target)
			t.ResultCode = out.Code
			switch {
			case errors.Is(consumeErr, quota.ErrScheduledNotSent):
				t.State = "pending"
				t.Attempts--
				t.ResultCode = "not_sent_retry_pending"
			case consumeErr != nil:
				t.State = "uncertain"
				t.ResultCode = "consume_result_unknown"
			case out.Code == "reset":
				t.State = "succeeded"
			case out.Code == "already_redeemed":
				t.State = "uncertain"
			case out.Code == "no_credit":
				t.State = "unavailable"
			case out.Code == "nothing_to_reset":
				t.State = "failed"
			default:
				t.State = "uncertain"
			}
			// Save the receipt even when the request context expired after a real consume.
			saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			return s.saveTask(saveCtx, &t)
		})
		cancelDeadline()
		if e != nil {
			return fail(e)
		}
	}
	p.Error = ""
	if e = s.db.WithContext(ctx).Save(&p).Error; e != nil {
		return e
	}
	return s.replan(ctx, index)
}
func (s *ResetScheduleService) Run(ctx context.Context) error {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		var indices []string
		e := s.db.WithContext(ctx).Raw("SELECT auth_index FROM reset_policies WHERE auto_before_expiry = 1 UNION SELECT auth_index FROM reset_tasks WHERE state IN ('pending','running')").Scan(&indices).Error
		if e == nil {
			var wg sync.WaitGroup
			sem := make(chan struct{}, 8)
			for _, index := range indices {
				if ctx.Err() != nil {
					break
				}
				select {
				case sem <- struct{}{}:
				case <-ctx.Done():
					return nil
				}
				wg.Add(1)
				go func(index string) {
					defer wg.Done()
					defer func() { <-sem }()
					taskCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
					defer cancel()
					if err := s.Reconcile(taskCtx, index); err != nil {
						logrus.WithError(err).WithField("auth_index", index).Warn("reset schedule check failed")
					}
				}(index)
			}
			wg.Wait()
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		case <-s.wake:
		}
	}
}

// Recompute only the reset-owned deadline. Manual deadlines are never overwritten.
func (s *ResetScheduleService) replan(ctx context.Context, index string) error {
	p, e := s.policy(ctx, index)
	if e != nil {
		return e
	}
	var earliest *time.Time
	choose := func(t time.Time) {
		if earliest == nil || t.Before(*earliest) {
			v := t
			earliest = &v
		}
	}
	var tasks []entities.ResetTask
	if e = s.db.WithContext(ctx).Where("auth_index = ? AND state = ?", index, "pending").Find(&tasks).Error; e != nil {
		return e
	}
	for _, t := range tasks {
		if t.ScheduledAt != nil {
			choose(t.ScheduledAt.Add(-3 * time.Minute))
		}
	}
	if p.AutoBeforeExpiry {
		r, e := s.quota.GetResetCredits(ctx, quota.ResetCreditsRequest{AuthIndex: index})
		if e != nil {
			return e
		}
		for _, c := range r.Credits {
			expiry, e := time.Parse(time.RFC3339Nano, c.ExpiresAt)
			if e == nil && expiry.After(s.now()) {
				choose(expiry.Add(-13 * time.Minute))
			}
		}
	}
	return s.guard.PlanStop(ctx, index, earliest)
}
