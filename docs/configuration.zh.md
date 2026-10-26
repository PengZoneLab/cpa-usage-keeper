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

## Redis 队列高级配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REDIS_QUEUE_ADDR` | 从 `CPA_BASE_URL` 推导 | 显式设置时优先使用该地址；留空时沿用 `CPA_BASE_URL` 的主机和显式端口，未指定端口时使用 `8317`。独立地址填写 `host:port` |
| `REDIS_QUEUE_TLS` | `false` | 设为 `true` 强制启用 Redis 队列 TLS；未指定队列地址时，默认跟随 `CPA_BASE_URL` 的协议。`false` 不会覆盖自动推导的 TLS 设置。 |
| `REDIS_QUEUE_BATCH_SIZE` | `10000` | 每次最多拉取的队列记录数 |
| `REDIS_QUEUE_IDLE_INTERVAL` | `1s` | 队列为空时的检查间隔 |

以上变量均为可选配置。

## 会话与消息保留

- 登录 session hash 会保存在 SQLite 中，直到用户退出或超过 `AUTH_SESSION_TTL`。
- CPAMC 使用独立的 embed session：优先使用 `HttpOnly` Cookie，不可用时回退到保存在浏览器 session storage 中的单标签页请求头 token。
- 同源嵌入默认可用；跨域嵌入时，将 `CPA_PUBLIC_URL` 设置为用于 `frame-ancestors` 的公开 CPA/CPAMC 来源。
- Redis inbox 消息成功后保留到当天结束，失败后保留 7 天。

## 存储与日志细节

Keeper 每天按配置时区在 04:30 自动归档超过 90 个本地自然日的原始请求记录。归档默认永久保留。设置 `USAGE_RAW_RETENTION_DAYS>=90` 后，每日归档完成后会分批删除超过总保留天数的归档记录，期限按请求发生时间及配置时区的自然日计算；热表的 90 天窗口不变。常规页面不直接查询归档明细；历史汇总和备份继续采用各自的保留策略。删除的原始记录无法用于后续历史重算；SQLite 文件不一定立即缩小，空闲空间可复用，并由现有条件式整理回收。

启用文件日志后，`cpa-usage-keeper-YYYY-MM-DD.log` 会记录所有已输出级别；error、fatal 和 panic 级别还会同时写入 `cpa-usage-keeper-error-YYYY-MM-DD.log`，该文件固定保留历史 30 个本地自然日及当天。
