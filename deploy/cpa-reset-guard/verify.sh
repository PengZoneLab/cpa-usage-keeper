#!/bin/sh
set -eu
source_dir=${1:?Usage: verify.sh PREPARED_SOURCE_DIRECTORY}
cd "$source_dir"
go test -race ./sdk/cliproxy/auth -run '^TestResetGuard' -count=1
go test -race ./internal/runtime/executor -run '^TestCodexResetGuardActualTransports$' -count=1 -timeout=60s
go test ./sdk/cliproxy/auth ./internal/api/handlers/management ./internal/api -count=1
go build -o cpa-reset-guard ./cmd/server
