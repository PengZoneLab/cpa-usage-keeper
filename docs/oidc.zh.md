[返回 README](../README.zh.md) · [English](./oidc.md)

# OIDC 管理员登录

Keeper 可通过一个 OpenID Connect 身份平台登录管理员。在平台中注册带客户端密钥的服务器端客户端，启用 Authorization Code Flow 和 PKCE S256，并精确注册公开回调地址：

```text
https://keeper.example.com/<APP_BASE_PATH>/api/v1/auth/oidc/callback
```

根路径部署省略 `<APP_BASE_PATH>/`。仍须保留 `AUTH_ENABLED=true` 和私有的 `LOGIN_PASSWORD`；身份平台暂时不可用时，密码登录继续可用。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTH_OIDC_ENABLED` | `false` | 在独立页面的管理员登录页签启用 OIDC |
| `AUTH_OIDC_PROMPT_LOGIN` | `true` | 发起登录时传递 `prompt=login` 要求重新认证；设为 `false` 时不传此参数，允许复用平台已有登录状态 |
| `AUTH_OIDC_ISSUER` | 空 | 精确的 HTTP/HTTPS Issuer，包含平台租户路径 |
| `AUTH_OIDC_CLIENT_ID` | 空 | 已注册的服务器端客户端 ID |
| `AUTH_OIDC_CLIENT_SECRET` | 空 | 已注册的客户端密钥 |
| `AUTH_OIDC_REDIRECT_URL` | 空 | 精确的 Keeper 公开回调地址，包含部署子路径 |
| `AUTH_OIDC_ALLOWED_SUBJECTS` | `[]` | 可选的 JSON 字符串数组，精确匹配区分大小写的 `sub` |

例如 `AUTH_OIDC_ALLOWED_SUBJECTS='["user-123","user,456"]'`。请使用平台实际签发给此客户端的 `sub`，不要替换成邮箱、显示名或猜测的平台用户 ID。缺省或空数组将应用准入交给身份平台：**通过此客户端认证的所有用户都会成为 Keeper 管理员**，请在平台中配置该应用的访问策略。邮箱和姓名仅用于显示。旧的 `AUTH_OIDC_ALLOWED_USERS` 非空时会阻止启动并提示迁移；删除旧配置前，须换成实际 subject，或在身份平台实施相应访问限制。

每次新发起 OIDC 登录时，默认通过 `prompt=login` 要求重新认证，具体认证方式由身份平台决定。设置 `AUTH_OIDC_PROMPT_LOGIN=false` 可允许复用平台现有登录状态。此设置不会撤销已建立的 Keeper 会话，也不会退出身份平台。

Keeper 使用标准 Discovery、JWKS、`openid profile email`、有签名的 ID Token、nonce、浏览器绑定及 PKCE S256。客户端密钥认证自动处理 `client_secret_basic` 和 `client_secret_post`。元数据端点可位于不同主机，并使用显式 HTTP/HTTPS 地址和已有查询参数。公共客户端、`form_post`、JWE、JWT Client Authentication、多 Issuer 选择和全局单点注销不属于本功能范围。

推荐 Issuer、元数据端点和 Keeper 均使用 HTTPS。明确配置的 HTTP 地址直接生效，无需额外开关，也不限于 localhost；HTTP Discovery/JWKS 无法保护身份信任起点，HTTP Keeper Cookie 没有传输加密。HTTPS 失败不会自动降级 HTTP 或跳过证书验证。内部 CA 需要加入服务使用的受信任证书链。配置或元数据使用 HTTP 时会记录提示；HTTP 支持是对 Discovery 的 HTTPS 要求的兼容扩展，不会让明文链路获得传输安全。

Issuer 使用平台公布的身份地址，须与 Discovery 和 ID Token 的 `iss` 精确一致。Keeper 服务端需要能访问 Discovery、Token 和 JWKS 端点，浏览器需要能访问授权端点；这些端点不要求同一主机。除非平台本身公布的身份地址就是容器内部地址，否则不能将 Issuer 随意替换为内部地址。

请从与回调相同的公开 origin 打开 Keeper。HTTPS 反向代理应保留公开 `Host` 和 `X-Forwarded-Proto`（或提供 `X-Forwarded-Host`），并在 `TRUSTED_PROXY_CIDRS` 中配置实际代理网段。API Key 页签和 CPAMC 嵌入模式不显示 OIDC。登录成功会恢复合法的站内页面及查询参数。未完成登录保存在当前进程内，五分钟过期；重启中断的登录可以重新点击按钮发起。请在代理访问日志中过滤回调查询参数，其中包含短期授权码和 state。

取消授权和身份平台故障不计入 OIDC 的来源认证失败额度；现有全局登录请求频率限制仍然生效。

登录后的会话沿用 `AUTH_SESSION_TTL`，在会话管理中显示 **OIDC 登录**。退出只撤销 Keeper 本地会话；当 `AUTH_OIDC_PROMPT_LOGIN=false` 时，再次登录仍可能由身份平台自动认证。关闭 OIDC、切换 Issuer/Client ID 或收紧 subject 列表后，配置随重启生效，在业务就绪前永久撤销受影响会话，无需旧浏览器再次访问或打开会话管理页；仅更换客户端密钥不会撤销现有会话。平台侧删号或收紧访问权限不会自动撤销 Keeper 已有会话，需要在会话管理中撤销或等待 TTL 到期。回退到不支持 OIDC 的 Keeper 版本前，先用新版本撤销所有 OIDC 会话，再停止 Keeper 并替换程序；新增可空数据库列可以保留。
