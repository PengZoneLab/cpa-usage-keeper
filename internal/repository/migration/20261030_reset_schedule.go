package migration

import (
	"cpa-usage-keeper/internal/entities"
	"gorm.io/gorm"
)

func addResetSchedule(tx *gorm.DB) error {
	return tx.AutoMigrate(&entities.ResetPolicy{}, &entities.ResetTask{}, &entities.CredentialQuotaFloor{})
}
