package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestIndependentActualLogStructure(t *testing.T) {
	dir := os.Getenv("KEEPER_ACCEPTANCE_LOG_DIR")
	if dir == "" {
		t.Skip("set KEEPER_ACCEPTANCE_LOG_DIR to inspect local logs without printing contents")
	}
	paths, _ := filepath.Glob(filepath.Join(dir, "*.log"))
	sort.Slice(paths, func(i, j int) bool {
		a, _ := os.Stat(paths[i])
		b, _ := os.Stat(paths[j])
		return a.ModTime().After(b.ModTime())
	})
	n, inputs, outputs, large := 0, 0, 0, 0
	for _, p := range paths {
		if n >= 30 {
			break
		}
		b, e := os.ReadFile(p)
		if e != nil || !strings.Contains(string(b), "=== REQUEST BODY ===") {
			continue
		}
		n++
		c := parseConversation(splitLogSections(string(b)))
		if c.InputAvailable {
			inputs++
		}
		if c.OutputAvailable {
			outputs++
		} else {
			types := map[string]int{}
			titles := []string{}
			for _, section := range splitLogSections(string(b)) {
				titles = append(titles, section.Title)
				if section.Title != "RESPONSE" {
					continue
				}
				for _, line := range strings.Split(section.Content, "\n") {
					if strings.HasPrefix(line, "data: ") {
						var v map[string]any
						if json.Unmarshal([]byte(line[6:]), &v) == nil {
							typ, _ := v["type"].(string)
							types[typ]++
						}
					}
				}
			}
			t.Logf("unavailable output bytes=%d sectionTitles=%v responseEventTypes=%v", len(b), titles, types)
		}
		if len(b) > 6<<20 {
			large++
		}
	}
	t.Logf("sample=%d input=%d output=%d largerThan6MiB=%d", n, inputs, outputs, large)
	if n == 0 || inputs != n || outputs == 0 {
		t.Fatal("actual log parsing did not meet minimum")
	}
}

func TestIndependentSafeTwoTurnLogs(t *testing.T) {
	dir := os.Getenv("KEEPER_ACCEPTANCE_LOG_DIR")
	if dir == "" {
		t.Skip("local safe fixture logs optional")
	}
	for _, tc := range []struct{ id, want string }{{"9dbf30a4", "20"}, {"f303fa68", "结果是 60"}} {
		paths, _ := filepath.Glob(filepath.Join(dir, "*"+tc.id+".log"))
		if len(paths) != 1 {
			t.Skip("safe log absent")
		}
		b, err := os.ReadFile(paths[0])
		if err != nil {
			t.Fatal(err)
		}
		c := parseConversation(splitLogSections(string(b)))
		if !strings.Contains(c.Output, tc.want) {
			t.Errorf("safe event %s missing expected output; input=%d output=%d", tc.id, len(c.Input), len(c.Output))
		}
	}
}
