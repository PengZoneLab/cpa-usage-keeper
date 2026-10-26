# Advanced Configuration

[Back to README](../README.md) · [简体中文](./configuration.zh.md)

See the README for connection, login, and common settings, and [`.env.example`](../.env.example) for the complete variable template.

## Web Access And Reverse Proxy

- The `--host` startup flag overrides `APP_HOST`. When neither is set, Keeper listens on all available network interfaces.
- For Docker/Compose, keep `APP_HOST` empty. To restrict access to the Docker host, publish the port as `127.0.0.1:8080:8080`.
- `APP_BASE_PATH` must be empty or start with `/`; `/cpa/` is normalized to `/cpa`. Reverse proxies must preserve this prefix.
- `CPA_BASE_URL` is the server-side CPA address and may use a private host or Docker service name.
- `CPA_PUBLIC_URL` is the public CPA address used by browsers. It controls the "Back to CPA" link and cross-origin CPAMC frame trust. Leave it empty for same-origin `/management.html`, or set it when domains, ports, or paths differ.
- For cross-origin CPAMC embedding, `CPA_PUBLIC_URL` must be a complete `http://` or `https://` URL with a host. Relative paths affect navigation only.
- Keeper trusts `X-Forwarded-For` only from local loopback and `TRUSTED_PROXY_CIDRS`. Direct clients cannot change their login-rate-limit source with this header. Configure only the exact proxy address or network; universal CIDRs are rejected.
- Local Nginx requires no extra proxy trust settings. If the proxy connects from a container or another host, or a CDN such as Cloudflare sits in front of it, configure the actual proxy networks rather than copying an example range.

See the [README](../README.md#nginx-reverse-proxy) for an Nginx example.

## Redis Queue Advanced Settings

| Variable | Default | Description |
| --- | --- | --- |
| `REDIS_QUEUE_ADDR` | Derived from `CPA_BASE_URL` | An explicit value takes precedence. When empty, use the hostname and explicit port from `CPA_BASE_URL`, or `8317` if no port is specified. Set `host:port` for a separate address |
| `REDIS_QUEUE_TLS` | `false` | Set to `true` to force TLS for the Redis queue; when no queue address is specified, TLS follows the protocol of `CPA_BASE_URL` by default. `false` does not override automatically inferred TLS settings. |
| `REDIS_QUEUE_BATCH_SIZE` | `10000` | Maximum queue records per pull |
| `REDIS_QUEUE_IDLE_INTERVAL` | `1s` | Empty queue check interval |

All variables above are optional.

## Session And Message Retention

- Login session hashes persist in SQLite until logout or `AUTH_SESSION_TTL` expiry.
- CPAMC uses a separate embed session: an `HttpOnly` cookie when available, or a per-tab header token in browser session storage as a fallback.
- Same-origin embedding works by default. For cross-origin embedding, set `CPA_PUBLIC_URL` to the public CPA/CPAMC origin used for `frame-ancestors`.
- Redis inbox messages are retained through the current day after success or for 7 days after failure.

## Storage And Log Details

Keeper archives raw request records older than 90 local calendar days daily at 04:30 in the configured timezone. Archives are retained permanently by default. With `USAGE_RAW_RETENTION_DAYS>=90`, daily maintenance deletes expired archived records in batches after archiving, using the request timestamp and local calendar days in the configured timezone. The 90-day hot-table window remains unchanged. Normal pages do not directly query archived records; historical aggregates and backups keep their own retention policies. Deleted raw records cannot support later historical recalculation. Deletion may not immediately shrink the SQLite file: freed space can be reused and is reclaimed by the existing conditional compaction policy.

When file logging is enabled, `cpa-usage-keeper-YYYY-MM-DD.log` contains all emitted levels. Error, fatal, and panic entries are also copied to `cpa-usage-keeper-error-YYYY-MM-DD.log`, which keeps the previous 30 local calendar dates plus the current date.
