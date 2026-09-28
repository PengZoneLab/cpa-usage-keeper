package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// This database belongs solely to the viewer. The upstream usage DB remains read-only.
// Separate columns prevent SQLite from loading full context for summary requests.
type conversationCache struct {
	db *sql.DB
	mu sync.Mutex
}

func openConversationCache(path string) (*conversationCache, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(absolute, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	f.Close()
	if err = os.Chmod(absolute, 0600); err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: absolute}
	q := u.Query()
	q.Set("_busy_timeout", "2000")
	q.Set("_journal_mode", "WAL")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite3", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS parsed_conversations_v1 (cache_key TEXT PRIMARY KEY, summary TEXT NOT NULL, full_input TEXT NOT NULL, expires_at INTEGER NOT NULL)`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &conversationCache{db: db}, nil
}
func (c *conversationCache) get(ctx context.Context, key string, full bool) (conversationPayload, bool) {
	var p conversationPayload
	if c == nil {
		return p, false
	}
	var summary, contextText string
	var err error
	if full {
		err = c.db.QueryRowContext(ctx, `SELECT summary,full_input FROM parsed_conversations_v1 WHERE cache_key=? AND expires_at>?`, key, time.Now().Unix()).Scan(&summary, &contextText)
	} else {
		err = c.db.QueryRowContext(ctx, `SELECT summary FROM parsed_conversations_v1 WHERE cache_key=? AND expires_at>?`, key, time.Now().Unix()).Scan(&summary)
	}
	if err != nil || json.Unmarshal([]byte(summary), &p) != nil {
		return p, false
	}
	p.FullInput = contextText
	return p, true
}
func (c *conversationCache) put(ctx context.Context, key string, p conversationPayload) {
	if c == nil || !p.Available {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	full := p.FullInput
	p.FullInput = ""
	b, err := json.Marshal(p)
	if err != nil {
		return
	}
	ttl := 24 * time.Hour
	if !p.OutputAvailable || !p.CacheComplete {
		ttl = 15 * time.Second
	}
	// Bound retention by time. Missing/incomplete results never become permanent.
	c.db.ExecContext(ctx, `DELETE FROM parsed_conversations_v1 WHERE expires_at<=?`, time.Now().Unix())
	// Keep at most 512 MiB of parsed text and 2000 recent entries.
	const budget = 512 << 20
	if len(full)+len(b) > budget {
		return
	}
	var size int64
	c.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(length(CAST(summary AS BLOB))+length(CAST(full_input AS BLOB))),0) FROM parsed_conversations_v1`).Scan(&size)
	for size+int64(len(full)+len(b)) > budget {
		result, e := c.db.ExecContext(ctx, `DELETE FROM parsed_conversations_v1 WHERE cache_key IN (SELECT cache_key FROM parsed_conversations_v1 ORDER BY expires_at LIMIT 1)`)
		if e != nil {
			return
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			break
		}
		c.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(length(CAST(summary AS BLOB))+length(CAST(full_input AS BLOB))),0) FROM parsed_conversations_v1`).Scan(&size)
	}
	c.db.ExecContext(ctx, `DELETE FROM parsed_conversations_v1 WHERE cache_key IN (SELECT cache_key FROM parsed_conversations_v1 ORDER BY expires_at DESC LIMIT -1 OFFSET 1999)`)
	c.db.ExecContext(ctx, `INSERT OR REPLACE INTO parsed_conversations_v1(cache_key,summary,full_input,expires_at) VALUES(?,?,?,?)`, key, string(b), full, time.Now().Add(ttl).Unix())
}
