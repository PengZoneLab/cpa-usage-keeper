package api

import (
	"cpa-usage-keeper/internal/service"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http"
)

func registerQuotaFloorRoutes(router gin.IRoutes, provider *service.QuotaFloorService) {
	router.GET("/credentials/:auth_index/quota-floor", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "quota floor unavailable", nil)
			return
		}
		result, err := provider.Get(c.Request.Context(), c.Param("auth_index"))
		if err != nil {
			writeCredentialStatusError(c, err, "quota floor unavailable")
			return
		}
		c.JSON(http.StatusOK, result)
	})
	router.PUT("/credentials/:auth_index/quota-floor", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "quota floor unavailable", nil)
			return
		}
		var body map[string]json.RawMessage
		if c.ShouldBindJSON(&body) != nil {
			c.JSON(400, gin.H{"error": "minimum_percent is required"})
			return
		}
		raw, ok := body["minimum_percent"]
		var minimum *float64
		if !ok || json.Unmarshal(raw, &minimum) != nil {
			c.JSON(400, gin.H{"error": "minimum_percent must be a number or null"})
			return
		}
		result, err := provider.Set(c.Request.Context(), c.Param("auth_index"), minimum)
		if err != nil {
			writeCredentialStatusError(c, err, "quota floor update failed")
			return
		}
		c.JSON(http.StatusOK, result)
	})
}
