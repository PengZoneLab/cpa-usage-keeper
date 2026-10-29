package entities

import "time"

// ResetPolicy is opt-in per account. Credential routing state is not an eligibility filter.
type ResetPolicy struct {
	AuthIndex        string     `gorm:"primaryKey" json:"auth_index"`
	AutoBeforeExpiry bool       `json:"auto_before_expiry"`
	CheckedAt        *time.Time `gorm:"serializer:storageTime" json:"checked_at"`
	Error            string     `json:"error"`
}

// A single durable row per account/card joins manual and expiry triggers.
// RequestID never changes after an attempt, including across restarts.
type ResetTask struct {
	AuthIndex   string     `gorm:"primaryKey" json:"-"`
	CreditID    string     `gorm:"primaryKey" json:"credit_id"`
	ScheduledAt *time.Time `gorm:"serializer:storageTime" json:"scheduled_at"`
	ExpiresAt   time.Time  `gorm:"serializer:storageTime" json:"expires_at"`
	State       string     `json:"state"`
	Source      string     `json:"source"`
	RequestID   string     `json:"-"`
	Attempts    int        `json:"attempts"`
	ResultCode  string     `json:"result_code"`
	StoppedAt   *time.Time `gorm:"serializer:storageTime" json:"stopped_at"`
	UpdatedAt   time.Time  `gorm:"serializer:storageTime" json:"updated_at"`
}
