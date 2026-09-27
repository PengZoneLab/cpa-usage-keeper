# 独立验收：Prompt Inspector 第一期

- 执行者：独立验收 Agent `/root/acceptance`。
- 时间：2026-09-27 16:18–16:23 Asia/Shanghai。
- 功能版本：`b972192c`；前端基线 Keeper v1.15.8，后端8318 v1.15.7。
- 环境：本机 macOS，8319 回环绑定，8318 原 Keeper 后端。
- 结论：第一期范围通过。覆盖已记录且有 usage event/request_id 的请求，完整请求正文与结构化 Prompt 可读，原始日志可下载。不能恢复开启前不存在的日志，也不还原服务端持有而未在请求中传入的上下文。

## 独立执行结果

| 检查 | 预期 | 实际 | 结论 |
|---|---|---|---|
| 未登录请求日志 | 拒绝 | HTTP 401 | 通过 |
| 原有管理员登录，经8319代理 | 保留会话 | HTTP 204，随后日志200 | 通过 |
| 真实非流式请求9687/d4a525ad | 原始入参完整 | REQUEST BODY JSON 与 real-request.json 全字段相等 | 通过 |
| 原始日志下载 | 原始正文可得 | HTTP200，13970字节，attachment，包含逐字相同正文 | 通过 |
| 真实流式请求9828/916fbcba | 可读取完整正文 | HTTP200，stream=true，JSON可解析且含Prompt字段 | 通过 |
| 缺失事件 | 明确不存在 | HTTP404 | 通过 |
| 8318保留 | 原服务仍可用 | 同一真实日志HTTP200；PID60214监听8318 | 通过 |
| 8319服务隔离 | 不启动第二采集器 | PID85521仅监听127.0.0.1:8319；命令只初始化反代与静态文件，无App、DB或poller | 通过 |
| SPA直达 | 刷新usage可用 | /usage HTTP200 | 通过 |
| 缺失静态文件 | 不返回伪HTML | /assets/missing.js HTTP404 | 通过 |
| 新增Prompt解析测试 | 保留结构与原文 | 7项通过，覆盖messages/tools、多模态、Responses、Anthropic、Gemini、畸形输入、1MiB输入 | 通过 |
| Go回归 | 代理/权限/大日志边界/下载正常 | viewer routes与全部TestRequestLog测试通过 | 通过 |

API原始摘要见 `independent-api-results.json`、`independent-stream-results.json`。未在证据文件记录管理密码、会话或日常请求正文。

执行命令：

```sh
/Users/ly/.local/share/keeper-toolchain/go/bin/go test ./cmd/prompt-viewer ./internal/service/test -run 'TestViewerRoutes|TestRequestLog' -count=1
cd web
npm test -- src/components/usage/test/promptInspector.test.ts src/components/usage/test/RequestEventLogModal.test.tsx
```

第二条实际匹配一个文件、7个测试；没有把不存在的RequestEventLogModal测试文件记为测试通过。6MiB预览边界是单元测试证据，未制造超过6MiB的真实付费请求。全量上游测试未执行。

## UI与修复复验

主Agent执行真实浏览器交互、复制及下载；独立Agent只读查看 `prompt-detail.png`，确认实际画面显示系统/用户消息、完整请求入参区域及原始日志下载按钮。独立API下载另行验证了正文完整性。UI交互执行者仍标为主Agent，不冒充独立操作。

初审发现 `/usage` 直达或刷新404；主Agent加入SPA fallback与路由测试后，独立HTTP检查和Go测试均通过。未修改失败历史。

## 适用边界与剩余问题

- 仅根路径部署；登录、权限、请求索引与日志读取依赖8318，8318停机时8319的API也不可用。
- 预览沿用上游6MiB阈值；超过时必须下载原始日志。完整日志由CPA存储及清理，Keeper没有另行永久归档。
- 日志不存在、usage event缺失或request_id缺失的请求不在本期可查看范围。“所有请求”不应被解释为这些情形也可追溯。
- 原8318未改服务代码，只启用日志访问配置；8319复用其API，因此正常界面里的管理写操作也作用于原8318，并非只读镜像。
- 本期范围内未解决阻断问题：无。
