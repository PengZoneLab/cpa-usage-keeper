package service

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"

	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/quota"
	"cpa-usage-keeper/internal/repository"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

var ErrQuotaFloorBlocked = errors.New("quota floor prevents enabling this credential")

type QuotaFloorChecker interface {
	Check(context.Context, quota.CheckRequest) (quota.CheckResponse, error)
}
type QuotaFloorClient interface {
	UpdateCredentialStatus(context.Context, string, string, bool) (int, error)
}

// QuotaFloorService uses the same file locks as manual edits. It never consumes model tokens.
type QuotaFloorService struct {
	db       *gorm.DB
	checker  QuotaFloorChecker
	client   QuotaFloorClient
	locks    *CredentialMutationLocks
	metadata *CredentialMetadataCoordinator
	refresh  MetadataRefresher
	wake     chan struct{}
}

func NewQuotaFloorService(db *gorm.DB, checker QuotaFloorChecker, client QuotaFloorClient, locks *CredentialMutationLocks, metadata *CredentialMetadataCoordinator, refresh MetadataRefresher) *QuotaFloorService {
	return &QuotaFloorService{db: db, checker: checker, client: client, locks: locks, metadata: metadata, refresh: refresh, wake: make(chan struct{}, 1)}
}

func BindQuotaFloor(status CredentialStatusProvider, bulk CredentialsManagementProvider, floor *QuotaFloorService) {
	if s, ok := status.(*credentialStatusService); ok {
		s.floor = floor
	}
	if s, ok := bulk.(*credentialsManagementService); ok {
		s.floor = floor
	}
}

func (s *QuotaFloorService) identity(ctx context.Context, index string) (entities.UsageIdentity, error) {
	identity, err := repository.GetActiveCredentialUsageIdentityByAuthIndex(ctx, s.db, strings.TrimSpace(index))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return identity, ErrCredentialStatusNotFound
	}
	if err != nil {
		return identity, err
	}
	if identity.FileName == nil || strings.TrimSpace(*identity.FileName) == "" {
		return identity, ErrCredentialStatusUnsupported
	}
	return identity, nil
}
func (s *QuotaFloorService) Get(ctx context.Context, index string) (entities.CredentialQuotaFloor, error) {
	index = strings.TrimSpace(index)
	if _, err := s.identity(ctx, index); err != nil {
		return entities.CredentialQuotaFloor{}, err
	}
	return s.load(ctx, index)
}
func (s *QuotaFloorService) load(ctx context.Context, index string) (entities.CredentialQuotaFloor, error) {
	p := entities.CredentialQuotaFloor{AuthIndex: index, State: "off"}
	err := s.db.WithContext(ctx).First(&p, "auth_index = ?", index).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return p, nil
	}
	return p, err
}
func (s *QuotaFloorService) save(ctx context.Context, p *entities.CredentialQuotaFloor) error {
	p.UpdatedAt = time.Now()
	return s.db.WithContext(ctx).Save(p).Error
}
func (s *QuotaFloorService) Set(ctx context.Context, index string, minimum *float64, until ...*time.Time) (entities.CredentialQuotaFloor, error) {
	index = strings.TrimSpace(index)
	if minimum != nil && (math.IsNaN(*minimum) || math.IsInf(*minimum, 0) || *minimum < 0 || *minimum > 100) {
		return entities.CredentialQuotaFloor{}, ErrCredentialStatusValidation
	}
	identity, err := s.identity(ctx, index)
	if err != nil {
		return entities.CredentialQuotaFloor{}, err
	}
	defer s.locks.lockCredential(*identity.FileName)()
	identity, err = s.identity(ctx, index)
	if err != nil {
		return entities.CredentialQuotaFloor{}, err
	}
	p, err := s.load(ctx, index)
	if err != nil {
		return p, err
	}
	if p.MinimumPercent == nil && p.DispatchUntil == nil && p.ResetDispatchUntil == nil && (minimum != nil || (len(until) > 0 && until[0] != nil)) && identity.Disabled != nil && *identity.Disabled && !p.Paused {
		p.ManualHold = true
	}
	if (p.MinimumPercent == nil) != (minimum == nil) || (minimum != nil && p.MinimumPercent != nil && *minimum != *p.MinimumPercent) {
		p.WindowKeys = ""
	}
	p.MinimumPercent = minimum
	if len(until) > 0 {
		p.DispatchUntil = until[0]
	}
	if minimum == nil && p.DispatchUntil == nil && p.ResetDispatchUntil == nil && p.Paused && !p.ManualHold {
		// Clearing the policy releases only a pause owned by this policy.
		if err = s.apply(ctx, identity, false); err != nil {
			return p, err
		}
		p.Paused = false
	}
	if minimum == nil && p.DispatchUntil == nil && p.ResetDispatchUntil == nil {
		p.State = "off"
	} else if p.ManualHold {
		p.State = "manual"
	} else {
		p.State = "pending"
	}
	if err = s.save(ctx, &p); err != nil {
		return p, err
	}
	select {
	case s.wake <- struct{}{}:
	default:
	}
	return p, nil
}

// prepareManual runs inside the existing file mutation lock. Persist manual intent first:
// if CPA fails or the process exits, automatic recovery cannot undo a manual stop.
func (s *QuotaFloorService) prepareManual(ctx context.Context, name, index string, disabled bool) error {
	if s == nil {
		return nil
	}
	var policies []entities.CredentialQuotaFloor
	query := s.db.WithContext(ctx).Model(&entities.CredentialQuotaFloor{})
	if index != "" {
		query = query.Where("auth_index = ?", index)
	} else {
		query = query.Where("auth_index IN (?)", s.db.Model(&entities.UsageIdentity{}).Select("identity").Where("auth_type = ? AND file_name = ? AND is_deleted = ?", entities.UsageIdentityAuthTypeCredential, name, false))
	}
	if err := query.Find(&policies).Error; err != nil {
		return err
	}
	for policyIndex, p := range policies {
		// Explicit enable may release a reset-owned hold once no pending reset remains.
		// This never removes a manual dispatch deadline or resumes automatically.
		if !disabled && p.ResetDispatchUntil != nil && s.db.Migrator().HasTable(&entities.ResetTask{}) {
			var pending int64
			if err := s.db.WithContext(ctx).Model(&entities.ResetTask{}).Where("auth_index = ? AND state IN ?", p.AuthIndex, []string{"pending", "running"}).Count(&pending).Error; err != nil {
				return err
			}
			if pending == 0 {
				p.ResetDispatchUntil = nil
			}
		}
		if !disabled && policyDispatchExpired(p, time.Now()) {
			return ErrQuotaFloorBlocked
		}
		if !disabled && p.MinimumPercent != nil {
			result, err := s.checker.Check(ctx, quota.CheckRequest{AuthIndex: p.AuthIndex, RequireExplicitPercent: true})
			low, known, _ := quotaFloorDecision(result.Quota, *p.MinimumPercent)
			var expected []string
			_ = json.Unmarshal([]byte(p.WindowKeys), &expected)
			seen := make(map[string]bool)
			for _, row := range result.Quota {
				seen[row.Key] = true
			}
			for _, key := range expected {
				if !seen[key] {
					known = false
				}
			}

			if err != nil || !known || low || policyDispatchExpired(p, time.Now()) {
				return ErrQuotaFloorBlocked
			}
		}
		policies[policyIndex] = p
	}
	for _, p := range policies {
		p.ManualHold = disabled
		p.Paused = false
		if disabled {
			p.State = "manual"
		} else if p.MinimumPercent != nil || (p.DispatchUntil != nil || p.ResetDispatchUntil != nil) {
			p.State = "pending"
		} else {
			p.State = "off"
		}
		if err := s.save(ctx, &p); err != nil {
			return err
		}
	}
	return nil
}

// quotaFloorDecision requires complete percentages to resume; a known low window can pause
// even when another window is missing. Disabled optional billing rows are not quota windows.
func quotaFloorDecision(rows []quota.QuotaRow, floor float64) (low, complete bool, remaining *float64) {
	complete = true
	count := 0
	for _, row := range rows {
		if row.Scope == "extra_usage" && (row.Allowed == nil || !*row.Allowed) {
			continue
		}
		count++
		var percent float64
		switch {
		case row.LimitReached != nil && *row.LimitReached:
			percent = 0
		case row.RemainingFraction != nil:
			percent = *row.RemainingFraction * 100
		case row.UsedPercent != nil:
			percent = 100 - *row.UsedPercent
		case row.Limit != nil && *row.Limit > 0 && row.Remaining != nil:
			percent = *row.Remaining / *row.Limit * 100
		case row.Limit != nil && *row.Limit > 0 && row.Used != nil:
			percent = (1 - *row.Used / *row.Limit) * 100
		default:
			complete = false
			continue
		}
		if math.IsNaN(percent) || math.IsInf(percent, 0) || percent > 100 {
			complete = false
			continue
		}
		percent = math.Max(0, percent)
		if remaining == nil || percent < *remaining {
			v := percent
			remaining = &v
		}
		if percent <= floor {
			low = true
		}
	}
	return low, complete && count > 0, remaining
}

func (s *QuotaFloorService) apply(ctx context.Context, identity entities.UsageIdentity, disabled bool) error {
	if _, err := s.client.UpdateCredentialStatus(ctx, *identity.FileName, identity.Identity, disabled); err != nil {
		return err
	}
	defer func() {
		if s.refresh != nil {
			s.refresh.RequestLocalMetadataRefresh()
		}
	}()
	return s.metadata.completeMutation(func() error {
		return repository.UpdateUsageIdentityDisabled(ctx, s.db, entities.UsageIdentityAuthTypeCredential, identity.Identity, disabled)
	})
}

func (s *QuotaFloorService) Reconcile(ctx context.Context, index string) error {
	index = strings.TrimSpace(index)
	identity, err := s.identity(ctx, index)
	if err != nil {
		return err
	}
	defer s.locks.lockCredential(*identity.FileName)()
	// Reload after locking; a manual edit or metadata sync may have changed this account.
	identity, err = s.identity(ctx, index)
	if err != nil {
		return err
	}
	p, err := s.load(ctx, index)
	if err != nil || (p.MinimumPercent == nil && p.DispatchUntil == nil && p.ResetDispatchUntil == nil) {
		return err
	}
	if p.ManualHold {
		p.State = "manual"
		return s.save(ctx, &p)
	}
	if identity.Disabled != nil && *identity.Disabled && !p.Paused {
		p.ManualHold = true
		p.State = "manual"
		return s.save(ctx, &p)
	}
	now := time.Now()
	p.CheckedAt = &now
	expired := policyDispatchExpired(p, now)
	low, complete := expired, true
	if !expired && p.MinimumPercent != nil {
		checkCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
		defer cancel()
		result, checkErr := s.checker.Check(checkCtx, quota.CheckRequest{AuthIndex: index, RequireExplicitPercent: true})
		if policyDispatchExpired(p, time.Now()) {
			return s.pauseDeadline(ctx, identity, &p)
		}
		if checkErr != nil {
			p.State = "unavailable"
			return s.save(ctx, &p)
		}
		var remaining *float64
		low, complete, remaining = quotaFloorDecision(result.Quota, *p.MinimumPercent)
		var expected []string
		_ = json.Unmarshal([]byte(p.WindowKeys), &expected)
		seen := make(map[string]bool)
		for _, row := range result.Quota {
			seen[row.Key] = true
		}
		for _, key := range expected {
			if !seen[key] {
				complete = false
			}
		}
		for key := range seen {
			found := false
			for _, old := range expected {
				if old == key {
					found = true
					break
				}
			}
			if !found {
				expected = append(expected, key)
			}
		}
		keys, _ := json.Marshal(expected)
		p.WindowKeys = string(keys)

		p.RemainingPercent = remaining
	}

	if low {
		if !p.Paused {
			// Durable ownership intent precedes the external write, so restart retries safely.
			p.Paused = true
			p.State = "pausing"
			if err = s.save(ctx, &p); err != nil {
				return err
			}
		}
		if identity.Disabled == nil || !*identity.Disabled {
			if err = s.apply(ctx, identity, true); err != nil {
				p.State = "apply_failed"
				_ = s.save(ctx, &p)
				return err
			}
		}
		p.State = "paused"
		if expired {
			p.State = "expired"
		}
	} else if !complete {
		p.State = "unavailable"
	} else {
		if p.Paused {
			if err = s.apply(ctx, identity, false); err != nil {
				p.State = "apply_failed"
				_ = s.save(ctx, &p)
				return err
			}
			p.Paused = false
		}
		p.State = "watching"
	}
	return s.save(ctx, &p)
}
func (s *QuotaFloorService) Run(ctx context.Context) error {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		var policies []entities.CredentialQuotaFloor
		if err := s.db.WithContext(ctx).Where("(minimum_percent IS NOT NULL OR dispatch_until IS NOT NULL OR reset_dispatch_until IS NOT NULL) AND manual_hold = ?", false).Find(&policies).Error; err == nil {
			// Bound fan-out; one unavailable account must not delay every other account.
			sem := make(chan struct{}, 4)
			done := make(chan struct{}, len(policies))
			launched := 0
			for _, p := range policies {
				if ctx.Err() != nil {
					break
				}
				sem <- struct{}{}
				launched++
				go func(index string) {
					defer func() { <-sem; done <- struct{}{} }()
					if err := s.Reconcile(ctx, index); err != nil && ctx.Err() == nil {
						logrus.WithError(err).WithField("auth_index", index).Warn("quota floor check failed")
					}
				}(p.AuthIndex)
			}
			for i := 0; i < launched; i++ {
				<-done
			}
		} else if ctx.Err() == nil {
			logrus.WithError(err).Warn("quota floor policies unavailable")
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		case <-s.wake:
		}
	}
}

func dispatchExpired(until *time.Time, now time.Time) bool {
	return until != nil && !now.Before(*until)
}

func (s *QuotaFloorService) pauseDeadline(ctx context.Context, identity entities.UsageIdentity, p *entities.CredentialQuotaFloor) error {
	p.Paused = true
	p.State = "pausing"
	if err := s.save(ctx, p); err != nil {
		return err
	}
	if identity.Disabled == nil || !*identity.Disabled {
		if err := s.apply(ctx, identity, true); err != nil {
			p.State = "apply_failed"
			_ = s.save(ctx, p)
			return err
		}
	}
	p.State = "expired"
	return s.save(ctx, p)
}

func policyDispatchExpired(p entities.CredentialQuotaFloor, now time.Time) bool {
	return dispatchExpired(p.DispatchUntil, now) || dispatchExpired(p.ResetDispatchUntil, now)
}
