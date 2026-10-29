package entities

import "time"

// CredentialQuotaFloor is Keeper-owned policy; CPA metadata sync must not overwrite it.
type CredentialQuotaFloor struct {
	ResetDispatchUntil *time.Time `gorm:"serializer:storageTime" json:"reset_dispatch_until"`
	DispatchUntil      *time.Time `gorm:"serializer:storageTime" json:"dispatch_until"`
	WindowKeys         string     `json:"-"`
	AuthIndex          string     `gorm:"primaryKey" json:"auth_index"`
	MinimumPercent     *float64   `json:"minimum_percent"`
	Paused             bool       `json:"paused"`
	ManualHold         bool       `json:"manual_hold"`
	RemainingPercent   *float64   `json:"remaining_percent"`
	CheckedAt          *time.Time `gorm:"serializer:storageTime" json:"checked_at"`
	State              string     `json:"state"`
	UpdatedAt          time.Time  `gorm:"serializer:storageTime" json:"updated_at"`
}
