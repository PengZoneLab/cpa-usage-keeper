# CPA v8.0.40 reset guard compatibility patch

This package targets commit `d946c4fba6fc9a5cfbca1f3d85184d62ad2fb683` exactly. It adds `POST /v8/management/routing/stop-and-cancel` under the existing management authentication middleware. No deployment or reset-card redemption is performed by this package.

## Contract

Request: `{"auth_index":"ACCOUNT_INDEX"}`. Only a currently disabled Codex account is accepted.

Success: `{"auth_index":"ACCOUNT_INDEX","disabled":true,"active":0,"drained":true}`. This receipt means generation admission is closed, all registered generation executors have exited, and the account's websocket sessions have been closed. Errors return `drained:false`; callers must never redeem based on an error or timeout. The acknowledgment has a 20-second limit; this does not impose a new inference timeout.

`active` counts generation execution attempts, including HTTP, SSE, WS, token counting, retries and Home execution paths. A streaming attempt stays active until its source channel closes. Cancellation does not decrement it. The forwarding worker keeps draining the source after cancellation, preventing blocked output from impersonating an upstream exit. On actual source exit it closes any account WS session created by a late handshake before releasing its count.

The gate uses the current account state rather than a stale selection. Stop and admission share a mutex protocol, so late registrations cannot escape the stop. A stop latch stays closed across background account updates; only successful explicit management enable reopens it. After a process restart, persisted `disabled` state still blocks admission. No account is deleted and no global restart is used as a drain action.

Management `APICall` / `Manager.HttpRequest` is intentionally excluded: card inventory and redemption must remain usable on disabled accounts. The receipt describes generation requests, not arbitrary management HTTP calls. Executors other than Codex retain their existing behavior.

## Prepare and verify

```sh
./prepare.sh /path/to/CPA/git/repository /path/to/fresh/output
./verify.sh /path/to/fresh/output
```

`prepare.sh` archives the pinned commit without modifying the supplied checkout and refuses an existing output directory. `verify.sh` runs race tests, package regression tests, and builds `cpa-reset-guard`. `build/` is ignored and contains local development and verification artifacts only.

The patch contains all production changes and tests. `evidence/version.json` binds every patched source file to its SHA-256 and records the patch SHA-256. The prepared archive's patched files were compared against these hashes. The parent Keeper repository remains responsible for its 3-minute stop deadline, 1-minute cancellation request, and refusing redemption unless a successful zero-active receipt is obtained.

## Verification

- `reset-guard-race.txt`: concurrent admission; cross-account isolation; live HTTP and SSE cancellation; a source that refuses to exit; late session cleanup; real WebSocket isolation; explicit reopen.
- `real-transports-race.txt`: actual production `CodexAutoExecutor` through `Manager`, using local HTTP/SSE/WebSocket fake upstreams. Each mode verifies upstream disconnect and generation exit before acceptance.
- `management-tests.txt`: disabled-Codex requirement, enabled/non-Codex rejection, unknown/invalid request rejection, success receipt shape, v8 routes.
- `auth-regression.txt`, `api-regression.txt`: complete auth, management-handler and API package regression suites.
- `build.txt`: server compilation output; successful builds normally produce an empty file.
- `patch-apply.txt`: clean pinned-source patch application.

Tests use synthetic account IDs and local upstreams. No production account credentials or reset cards are used. Full repository-wide tests are not claimed; the affected auth and management packages, actual transport tests and full server compilation were verified.
