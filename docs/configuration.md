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
