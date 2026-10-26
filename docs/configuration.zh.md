# 高级配置

[返回 README](../README.zh.md) · [English](./configuration.md)

基础连接、登录和常用配置见 README；完整变量模板见 [`.env.example`](../.env.example)。

## Web 访问与反代

- 启动参数 `--host` 的优先级高于 `APP_HOST`。两者都未设置时，Keeper 监听所有可用网络接口。
- Docker/Compose 请保持 `APP_HOST` 为空；如需仅允许 Docker 宿主机访问，请将端口发布为 `127.0.0.1:8080:8080`。
- `APP_BASE_PATH` 必须为空或以 `/` 开头；`/cpa/` 会规范为 `/cpa`。反向代理必须保留该前缀。
- `CPA_BASE_URL` 是 Keeper 服务端访问 CPA 的地址，可以使用内网地址或 Docker 服务名。
- `CPA_PUBLIC_URL` 是浏览器使用的公开 CPA 地址，控制“返回 CPA”跳转和跨域 CPAMC frame 信任。同源且 CPA 位于 `/management.html` 时可留空；域名、端口或路径不同时应设置公开地址。
- 跨域嵌入 CPAMC 时，`CPA_PUBLIC_URL` 必须是带 host 的完整 `http://` 或 `https://` URL；相对路径只影响浏览器跳转。
- Keeper 只信任本机 loopback 和 `TRUSTED_PROXY_CIDRS` 提供的 `X-Forwarded-For`；直连客户端不能通过该请求头切换登录限流来源。只配置实际代理地址或网段，全网 CIDR 会被拒绝。
- 本机 Nginx 无需额外配置代理信任。反向代理通过容器或其它主机访问 Keeper，或前面还有 Cloudflare 等 CDN 时，应配置准确的代理网段，而不是照搬示例网段。

Nginx 示例见 [README](../README.zh.md#nginx-反向代理)。
