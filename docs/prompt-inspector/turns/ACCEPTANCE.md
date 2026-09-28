# 独立验收：Session 调用归拢

验收者：`/root/mobile_review`，2026-09-28。基线 `1c62c35f37f171362183bc8f000f0b43de879d4f` + 当前工作区。
当前结论：自动化及代码审查通过；真实API组合和运行截图待审阅，暂不宣称整体交付完成。

## 审查与修复历史

1. 初版纯 user_history hash 归拢不通过：同Session真实两次同文字、均只带一个user的请求会误合并。修复为必须 `turn_continuation=true`、相同明确Session、同user_history key、在已加载时间序中相邻；普通新user请求始终新组。
2. 发现空user content数组被错误视作续调；后端已改unknown，不给可合并key。
3. 初始UI“同一轮提问”过度确定；改“按用户历史归拢”，明确仅覆盖已加载记录，未知单独展示。hash仅证明所带用户历史相同，不证明服务端完整上下文或真实业务轮次。
4. 实际Responses日志存在agent_message，主Agent/后端按实际shape新增支持并补测试；续调范围包含assistant/agent/tool后缀，不仅限tool。

## 独立验证

- `go test -race ./cmd/prompt-viewer -count=1`：PASS，2.807s。
- 4前端文件 RequestBrowser / RequestBrowserConversation / RequestBrowser.acceptance / RequestEventsDetailsCard：40 tests PASS，12:28:46，1.22s。
- `npm --prefix web run typecheck`、`npm --prefix web run lint`：exit0。
- 自动化覆盖：四协议与agent_message续调；重复新增用户不合并；previous_response_id/conversation/unknown/工具独立结果/空内容降级；不跨缺失摘要或缺失Session归拢；50 Unicode字预览不切emoji；完整输入/相关调用/原始上下文仍可展开；刷新本组更新返回。
- 代码确认最新有正文返回来自倒序请求，UI明确“不代表最终回答”；所有请求仍能展开查看。

版本摘要：
- conversation_turn.go SHA256 `a96652eca57ace1d36fd5a63045d569b795e5c8d9f7ee9381aaa99bb52147298`
- RequestBrowser.tsx SHA256 `a4355ca466a6f7f9707a095c7620512ae10020a9c461cdf92375c1d2fa8d4a52`

## 边界

归拢是根据已提供用户历史及续调结构的保守估计，不能发现上游未记录的真实提问。截断历史、未知结构、缺失记录保持提示/单独项，不能据此声称完整Session。刷新本组目前会暂时卸载轮次卡片，复载后本组内部展开态重置；此为非阻断交互限制，普通页面刷新保留Session展开态有既有回归。

## 最终运行证据与结论

**通过本轮Session调用归拢验收。** 独立审阅主Agent保存的真实运行产物：

- `mobile-grouped.png`：Chrome 390×844，实际Session的3次调用展示为一组，用户50字预览、展开入口、最新有效返回及“不代表最终回答”提示同屏；“轮次仅覆盖已加载记录”可见。
- `mobile-calls.png` 与 `calls-expanded-ax.txt`：相关调用3条可展开，AX具有3个原始日志入口及各自用户/模型/系统上下文，不丢原请求可追溯性。
- `api-verification.json`：13800/13793/13749/13724/13711均相同key且续调true；11598和11600的真实两轮新提问key不同且续调false。主Agent实际UI亦验证二者仍2卡。
- 主Agent执行完整输入展开并看到末尾、收起恢复50字；独立组件自动化同时覆盖展开/收起与Unicode截取。未由验收者重复操作共享浏览器。

最终部署产物：bundle `index-DR32c5zQ.js`（截图Network可见）；binary SHA256 `80660c87b4702e71c34c5963d6ca0c7115cca03005a4f0f10ba25bcff080d475`。主Agent确认测试后无代码再修改。

剩余阻断：无。明确交互限制：点击“刷新本组对话”会收起其子内容，需重新展开；此次验收范围为Chrome390px响应式界面，不宣称Safari/手机5G真机验收。原始上下文内“完整请求历史”应理解为日志携带内容，并不能恢复上游未传入历史，建议后续文案改为“本次请求携带的上下文”。
