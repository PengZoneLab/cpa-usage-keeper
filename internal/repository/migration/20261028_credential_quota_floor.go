package migration

import (
	"cpa-usage-keeper/internal/entities"
	"gorm.io/gorm"
)

func addCredentialQuotaFloor(tx *gorm.DB) error {
	return tx.AutoMigrate(&entities.CredentialQuotaFloor{})
}
