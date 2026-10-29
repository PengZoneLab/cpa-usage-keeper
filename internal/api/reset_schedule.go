package api

import (
	"cpa-usage-keeper/internal/quota"
	"cpa-usage-keeper/internal/service"
	"errors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"net/http"
	"time"
)

func registerResetScheduleRoutes(router gin.IRoutes, s *service.ResetScheduleService) {
	respond := func(c *gin.Context, v service.ResetScheduleView, e error) {
		if e == nil {
			c.JSON(http.StatusOK, v)
			return
		}
		switch {
		case errors.Is(e, quota.ErrValidation):
			c.JSON(400, gin.H{"error": e.Error()})
		case errors.Is(e, gorm.ErrRecordNotFound):
			c.JSON(404, gin.H{"error": "account not found"})
		case errors.Is(e, quota.ErrUnsupportedType):
			c.JSON(400, gin.H{"error": "Codex account required"})
		default:
			writeInternalError(c, "reset schedule unavailable", e)
		}
	}
	ready := func(c *gin.Context) bool {
		if s == nil {
			c.JSON(503, gin.H{"error": "reset schedule unavailable"})
			return false
		}
		return true
	}
	router.GET("/credentials/:auth_index/reset-schedule", func(c *gin.Context) {
		if !ready(c) {
			return
		}
		v, e := s.Get(c.Request.Context(), c.Param("auth_index"))
		respond(c, v, e)
	})
	router.PUT("/credentials/:auth_index/reset-schedule", func(c *gin.Context) {
		if !ready(c) {
			return
		}
		var b struct {
			Enabled *bool `json:"auto_before_expiry"`
		}
		if c.ShouldBindJSON(&b) != nil || b.Enabled == nil {
			c.JSON(400, gin.H{"error": "auto_before_expiry boolean required"})
			return
		}
		v, e := s.SetAuto(c.Request.Context(), c.Param("auth_index"), *b.Enabled)
		respond(c, v, e)
	})
	router.PUT("/credentials/:auth_index/reset-schedule/cards/:credit_id", func(c *gin.Context) {
		if !ready(c) {
			return
		}
		var b map[string]*time.Time
		if c.ShouldBindJSON(&b) != nil {
			c.JSON(400, gin.H{"error": "scheduled_at must be RFC3339 or null"})
			return
		}
		at, ok := b["scheduled_at"]
		if !ok {
			c.JSON(400, gin.H{"error": "scheduled_at is required"})
			return
		}
		v, e := s.SetCard(c.Request.Context(), c.Param("auth_index"), c.Param("credit_id"), at)
		respond(c, v, e)
	})
}
