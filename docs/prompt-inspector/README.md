# Keeper Prompt Inspector 第一期

入口：http://127.0.0.1:8319/request-events 。使用原 Keeper 管理员密码登录，选择“请求事件”，点击某一行的成功/失败状态即可查看 Prompt、完整请求入参、上游转换日志并复制或下载。

## 结构与版本

- 源码：`https://github.com/PengZoneLab/cpa-usage-keeper`，分支 `master`。
- 上游：`https://github.com/Willxup/cpa-usage-keeper`，本期基于稳定标签 `v1.15.8`。
- 本地：`/Users/ly/Documents/coderepo/cpa-usage-keeper-prompts`。
- 8319 运行新命令 `cmd/prompt-viewer`，仅提供 Fork 界面并代理 `/api/` 到现有8318。不会启动第二份采集器；通过 `-usage-db` 只读原数据库，为已授权返回的请求补充 Session 信息。
- 8318 仍是 Homebrew Keeper v1.15.7，页面页脚版本来自该后端；前端基线为v1.15.8。
- CPA 8317负责真实请求日志持久化，Keeper8318维护原有请求索引。无需修改客户端API地址。
- 登录权限、API Key只读用户权限、日志访问限制均复用8318，8319仅绑定本机回环地址。8319代理全部Keeper API，因此界面管理操作仍作用于原8318，并不是只读镜像。
- 仅支持根路径部署（现有8318的APP_BASE_PATH为空）。

## 已开启的配置

- CPA：管理API将 `request-log` 从false设置为true，写入原CPA配置，记录启用后的请求。
- Keeper：`/opt/homebrew/etc/cpa-usage-keeper.env` 的 `CPA_REQUEST_LOG_ACCESS_ENABLED=true`，已重启8318服务加载。
- 修改前配置备份：上述env和 `/opt/homebrew/etc/cliproxyapi.conf` 的 `.before-prompt-inspector` 文件；均为600权限。
- 启动项：`~/Library/LaunchAgents/local.keeper-prompt-viewer.plist`。
- 二进制：`~/.local/bin/keeper-prompt-viewer`；错误日志：`/opt/homebrew/var/log/keeper-prompt-viewer.err.log`。

## 构建与验证

需要 Node/npm 和 Go >=1.26。本机官方Go工具链在 `~/.local/share/keeper-toolchain/go/bin`，官方归档SHA256已核对。

```sh
npm --prefix web ci
npm --prefix web run typecheck
npm --prefix web run lint
npm --prefix web run test -- src/components/usage/test/promptInspector.test.ts src/components/usage/test/RequestEventsDetailsCardRequestLog.test.tsx
npm --prefix web run build
go test ./cmd/prompt-viewer
go build -o "$HOME/.local/bin/keeper-prompt-viewer" ./cmd/prompt-viewer
launchctl kickstart -k "gui/$(id -u)/local.keeper-prompt-viewer"
```

## 同步上游

```sh
git fetch upstream --tags
git switch master
git merge <经检查的上游稳定标签>
```

解决冲突后执行上述验证与真实请求回归，再重建并重启8319。优先核对 `RequestEventLogModal.tsx` 的小型接入差异与后端API兼容性；其余新增模块独立。8318通过Homebrew单独升级；不要把默认 `cmd/server` 启动为第二份采集服务。合并不是自动无冲突保证。

## 记录范围与保留

- 展示CPA实际保存且Keeper有对应请求事件的日志。过去未保存的Prompt、CPA未记录的请求、已清理日志以及服务端持有的历史上下文不能补回。
- 原始入参完整保留；Prompt区提取常见协议的system/instructions/messages/input/prompt/contents及工具定义，嵌套图片引用、工具结果保持结构。上游转换后的请求在原始日志区。
- 日志超过上游6MiB预览限制时，继续提供完整原始日志下载，不截断成“完整预览”。
- 请求日志存于CPA现有日志目录。本机 `logs-max-total-size-mb=0`，当前没有总容量上限；本期不自动删除用户日志。长期运行需要按使用量制定保留策略。
- 原始日志可能包含请求头、凭据和业务内容，沿用管理员访问控制；不要上传生产日志到GitHub。本仓库只保存无敏感内容的人工验收请求及检查结果。
- 支持全部请求时间倒序及 Session 分组倒序；列表预览前50字，详情保留全文。Session视图先加载当前筛选范围的完整请求索引。没有跨请求全文搜索、会话上下文重建或独立日志归档。

## 停用与回滚

停止新界面：`launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.keeper-prompt-viewer.plist`，然后在原端口登记目录释放8319锁。保留源码、二进制和日志便于恢复。

若同时停止记录：使用CPA管理API把request-log设置回false；Keeper env将CPA_REQUEST_LOG_ACCESS_ENABLED恢复为原值并重启8318。不要直接覆盖整份备份配置，以免覆盖此后其他任务的改动。以上均不删除已有日志与数据库。

验收和DAG：[DAG.md](DAG.md)、[LOOP.md](LOOP.md)、[ACCEPTANCE.md](ACCEPTANCE.md)。
