package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type sessionMetadataStore struct{ db *sql.DB }
type sessionMetadata struct {
	session string
	parent  *string
}

func openSessionMetadata(path string) (*sessionMetadataStore, error) {
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: absolute}
	q := u.Query()
	q.Set("mode", "ro")
	q.Set("_query_only", "true")
	q.Set("_busy_timeout", "1000")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite3", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return &sessionMetadataStore{db: db}, nil
}

// The only IDs queried are from a successful upstream-authorized response.
func (s *sessionMetadataStore) lookup(ctx context.Context, ids []int64) (map[int64]sessionMetadata, error) {
	result := make(map[int64]sessionMetadata)
	for start := 0; start < len(ids); start += 400 {
		end := start + 400
		if end > len(ids) {
			end = len(ids)
		}
		args := make([]any, end-start)
		marks := make([]string, len(args))
		for i, id := range ids[start:end] {
			args[i] = id
			marks[i] = "?"
		}
		rows, err := s.db.QueryContext(ctx, "SELECT id, session_id, parent_session_id FROM usage_events WHERE id IN ("+strings.Join(marks, ",")+")", args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id int64
			var session, parent sql.NullString
			if err = rows.Scan(&id, &session, &parent); err != nil {
				rows.Close()
				return nil, err
			}
			m := sessionMetadata{session: session.String}
			if parent.Valid {
				p := parent.String
				m.parent = &p
			}
			result[id] = m
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (s *sessionMetadataStore) enrichResponse(resp *http.Response) error {
	if resp.Request.Method != http.MethodGet || resp.Request.URL.Path != "/api/v1/usage/events" || resp.StatusCode != http.StatusOK {
		return nil
	}
	// Upstream JSON may be compressed on client request. Ask for identity in the director instead.
	if resp.Header.Get("Content-Encoding") != "" {
		return nil
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	resp.Body.Close()
	var payload map[string]json.RawMessage
	if json.Unmarshal(body, &payload) != nil {
		resp.Body = io.NopCloser(bytes.NewReader(body))
		return nil
	}
	var events []map[string]json.RawMessage
	if json.Unmarshal(payload["events"], &events) != nil {
		resp.Body = io.NopCloser(bytes.NewReader(body))
		return nil
	}
	ids := make([]int64, len(events))
	for i, event := range events {
		var id string
		if json.Unmarshal(event["id"], &id) == nil {
			ids[i], _ = strconv.ParseInt(id, 10, 64)
		}
	}
	available := s != nil
	metadata := map[int64]sessionMetadata{}
	if available {
		ctx, cancel := context.WithTimeout(resp.Request.Context(), 2*time.Second)
		defer cancel()
		metadata, err = s.lookup(ctx, ids)
		if err != nil {
			available = false
		}
	}
	allAvailable := available
	for i, event := range events {
		value, found := metadata[ids[i]]
		valid := available && found
		event["session_metadata_available"], _ = json.Marshal(valid)
		if valid {
			event["session_id"], _ = json.Marshal(value.session)
			event["parent_session_id"], _ = json.Marshal(value.parent)
		} else {
			allAvailable = false
			delete(event, "session_id")
			delete(event, "parent_session_id")
		}
	}
	payload["session_metadata_available"], _ = json.Marshal(allAvailable)
	payload["events"], _ = json.Marshal(events)
	body, err = json.Marshal(payload)
	if err != nil {
		return err
	}
	resp.Body = io.NopCloser(bytes.NewReader(body))
	resp.ContentLength = int64(len(body))
	resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
	resp.Header.Del("ETag")
	resp.Header.Del("Content-MD5")
	return nil
}
