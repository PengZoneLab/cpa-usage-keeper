[Back to README](../README.md) · [简体中文](./oidc.zh.md)

# OIDC Administrator Login

Keeper can sign administrators in through one OpenID Connect identity provider. Register a confidential client with a client secret, enable Authorization Code Flow with PKCE S256, and register the exact public callback URL:

```text
https://keeper.example.com/<APP_BASE_PATH>/api/v1/auth/oidc/callback
```

Omit `<APP_BASE_PATH>/` for a root deployment. Keep `AUTH_ENABLED=true` and a private `LOGIN_PASSWORD`; password login remains available when the identity provider is unavailable.

| Variable | Default | Description |
| --- | --- | --- |
| `AUTH_OIDC_ENABLED` | `false` | Enable OIDC on the standalone administrator login tab |
| `AUTH_OIDC_PROMPT_LOGIN` | `true` | Send `prompt=login` to request reauthentication; set to `false` to omit it and allow the provider to reuse its login session |
| `AUTH_OIDC_ISSUER` | Empty | Exact HTTP/HTTPS issuer, including any tenant path |
| `AUTH_OIDC_CLIENT_ID` | Empty | Registered server-side client ID |
| `AUTH_OIDC_CLIENT_SECRET` | Empty | Registered client secret |
| `AUTH_OIDC_REDIRECT_URL` | Empty | Exact public Keeper callback URL, including the configured base path |
| `AUTH_OIDC_ALLOWED_SUBJECTS` | `[]` | Optional JSON array of exact, case-sensitive `sub` values |

For example, `AUTH_OIDC_ALLOWED_SUBJECTS='["user-123","user,456"]'`. Use the actual `sub` issued to this client; do not substitute an email, display name, or assumed platform user ID. An omitted or empty list delegates application access to the identity provider: **everyone who authenticates for this client becomes a Keeper administrator**. Configure the provider's application access policy accordingly. Email and profile claims are used only for display. A nonempty legacy `AUTH_OIDC_ALLOWED_USERS` causes a startup error with migration guidance; convert its intended users to exact subjects or enforce that access policy at the provider before removing it.

By default, each new OIDC login requests reauthentication with `prompt=login`; the identity provider chooses the authentication method. Set `AUTH_OIDC_PROMPT_LOGIN=false` to allow reuse of its existing login session. This setting does not revoke existing Keeper sessions or log out the identity provider.

Keeper uses standard Discovery and JWKS, `openid profile email`, signed ID Tokens, nonce, browser binding, and PKCE S256. Client secret authentication automatically handles `client_secret_basic` and `client_secret_post`. Metadata may point to different hosts and explicit HTTP/HTTPS endpoints, including endpoints with existing query parameters. Public clients, `form_post`, JWE, JWT client authentication, multi-issuer selection, and global single logout are outside this feature's scope.

HTTPS is recommended for the issuer, discovered endpoints, and Keeper. Explicit HTTP URLs are accepted without an extra switch, including non-localhost addresses; HTTP Discovery/JWKS have no protected trust channel, and HTTP Keeper cookies have no transport encryption. HTTPS failures never trigger an HTTP fallback or bypass certificate checks. Install internal CA certificates into the service's trusted certificate chain when needed. Keeper logs a warning for configured or discovered HTTP links. HTTP compatibility is an extension to Discovery's HTTPS requirements; it does not make plaintext links secure.

Use the issuer advertised by the provider, exactly matching Discovery and the ID Token `iss`. Keeper must be able to reach Discovery, Token, and JWKS endpoints; the browser must be able to reach the authorization endpoint. These endpoints need not share a host, and an internal container address cannot replace the issuer unless the provider actually advertises that identity.

Open Keeper at the same public origin as the callback. Behind HTTPS proxies, preserve the public `Host` and `X-Forwarded-Proto` (or supply `X-Forwarded-Host`) and configure actual proxy networks in `TRUSTED_PROXY_CIDRS`. OIDC does not appear in the API Key tab or CPAMC embed mode. Login restores a valid in-app page and its query parameters. Pending logins expire after five minutes and are held only by the current Keeper process; restart an interrupted attempt by clicking the button again. Exclude callback query parameters from reverse-proxy access logs, because they contain short-lived authorization codes and state.

Canceled authorization and identity-provider outages do not consume the per-source OIDC authentication failure allowance; the existing global login request rate limit still applies.

Completed logins use the existing `AUTH_SESSION_TTL` and show **OIDC login** in Session Management. Signing out revokes only the local Keeper session; when `AUTH_OIDC_PROMPT_LOGIN=false`, the identity provider may sign you in automatically next time. Disabling OIDC, changing issuer/client ID, or tightening the subject list permanently revokes affected sessions during startup, before business routes become ready; this does not require a visit from the old browser or the Session Management page. Changing only the client secret does not revoke them. Provider-side account removal or access changes do not automatically revoke existing Keeper sessions: revoke them in Session Management or wait for their TTL. Before downgrading to a Keeper version without OIDC support, revoke every OIDC session using the new version, then stop Keeper and replace the binary; the added nullable database columns may remain.
