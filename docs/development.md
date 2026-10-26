# Development Guide

[Back to README](../README.md) · [简体中文](./development.zh.md)

See the developer reference in the README for project structure and local setup.

## Tests

Run the full verification baseline from the repository root:

```bash
make verify
```

Or run checks individually:

```bash
go test ./cmd/... ./internal/...
npm --prefix ./web run test
npm --prefix ./web run lint
npm --prefix ./web run typecheck
npm --prefix ./web run build
```

## Chart time handling

- Use the response/configured timezone. Calendar days use `internal/timeutil.CivilDate` and `DayBounds`; rolling windows use elapsed durations. A calendar day is not always 24 hours.
- Read existing rollups through the repository bucket adapters. Overview and Latency have different hourly anchors; Activity retains its existing 364-block grid and stored ends. Query fixes must not change write buckets or repartition stored aggregates.
- Reuse `internal/repository/usage_event_time_read.go` for raw-event time predicates and instant filtering. Use bounded segments for queries and the open-ended reader for recent-cache startup/reload; keep projections and lifecycle logic in callers.
- Keep bucket identity as an instant or full date, never a formatted clock label. Sort timestamps by instant; use actual full-day minutes for day-bucket rates.
- Reuse `web/src/utils/usage/timeLabels.ts` for timezone parts and repeated-clock disambiguation. Preserve each chart's locale, precision, fallback and empty-point rules; add offsets only to ambiguous local clocks.
- Test ordinary Shanghai dates alongside DST gaps/folds, including a browser timezone different from the response. Preserve existing chart styles and lifecycle behavior.
