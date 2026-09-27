# 独立验收

验收者：独立 Agent `/root/review`（不参与实现）。环境：macOS，本地源码，2026-09-27。

## 验收标准

- 全请求跨 Session，timestamp 降序，同时间 ID 降序。
- Session 按精确 ID 分组，完整筛选索引加载完成才显示分组；组按最新请求降序，组内降序。
- 未关联 Session 与元数据不可用分别展示。
- 预览优先最后 user 文本，最多 50 Unicode 字符，超长加省略号；详情完整。
- 预览只按可见条目加载、受控并发、取消；详情复制下载保留。
- 8319 复用 8318 鉴权及采集，只读 SQLite 仅查询已授权响应的 IDs。
- 浏览器实际展示证据与最终构建对应。

## 第 1 轮（进行中）

版本：基线 0db6a6e9 + 本轮未提交工作区；最终哈希待固定。

|检查|操作与预期|实际|结论|
|---|---|---|---|
|后端回归|独立执行 go test ./cmd/prompt-viewer -count=1|通过，0.174s|通过|
|权限与只读|审查 enrichment + 测试：401、授权 IDs、只读写拒绝、缺DB|mode=ro、query_only，成功响应 IDs 查询，未启动采集器|通过|
|详情回归|独立执行 RequestEventsDetailsCardRequestLog、PromptReader、promptInspector|3 文件 18 tests 通过|通过|
|Session 刷新|审查分页 attempt 防重复签名|筛选刷新首屏相同时，旧 attempt 可能阻止后续自动加载|不通过，已反馈主 Agent|
|实际界面|待主 Agent 提供最终运行截图与证据|未执行|待验证|

当前总体结论：未完成，等待修复与运行证据。不得将上述局部测试视为整体功能验收。

## 第 2 轮复验

- 前端已在 `loading=true` 重置分页 attempt；独立新增 `RequestBrowser.acceptance.test.tsx`，真实 React render 验证同首屏刷新继续加载、重复页不空转、失败停止自动加载、完整索引前不显示分组、完成后显示 Session。
- 独立运行上述测试与 promptPreview / RequestEventsDetailsCardRequestLog / PromptReader / promptInspector：5 文件 24 tests 全通过（17:30:47）。
- 独立运行 lint、typecheck：全部通过。
- 审查预览现在有组件生命周期 500 项限额缓存，只存预览短文本；4 并发、IntersectionObserver 按可见加载、卸载 abort。
- 实际打开审阅 `time.png`、`session.png`、`detail.png`：安全请求 10821 显示 50 字预览和省略号，详情包含完整末尾 `DETAIL_COMPLETE_20260927`；全部请求与 Session 均按时间降序。
- 等待多请求 Session 展开证据、完整索引验证与最终运行版本指纹后作整体结论。

## 最终独立结论（第 3 轮，2026-09-27 17:40）

**通过。** 初轮分页缺陷已修复并由本验收者复验。无未解决的范围内阻断问题。

最终运行版本：`adc1254a8092ed8c81eb1eb4542c0011b4b349b4b5e6a58ee66f6b1fdf48a954`（8319 二进制 SHA256，验收者独立执行 shasum 核对一致）；前端 bundle `index-DWbIv5b1.js`。最终源码提交 `6690fe37`（本地 master）；后续文档归档不改变运行代码。

- 最新隐藏无效列按钮、点击请求说明、Session 模式记忆变更已独立审查；再次执行 6 文件 25 tests，全部通过（17:36:30）。
- 独立打开最终 `time.png`、`session.png`、`detail.png`、`mobile.png`：两种视图、完整安全 Prompt 末尾、50字预览和移动布局符合要求；最终截图已移除无效列按钮。
- 独立打开 `group.png`：118 条 Session 展开后，时间 17:33:30 → 17:33:17 → 17:33:01 → 17:32:47，组内降序。此图来自前一构建，后续仅文案/列按钮/模式持久化，排序及分组逻辑未变；最终同逻辑测试已复验。
- 审阅主 Agent 实测原始结果 `runtime.json`：最终完整索引 3908 条、51 组；50 条 API Session 与 SQLite 对齐；未认证 401；预览实测 50 字；全量复制 JSON 相等；14209 bytes 下载含全文标记；移动宽度 382，scrollWidth 382。
- 独立测试覆盖只读 SQL、授权 IDs、元数据未知区分、Unicode、同时间排序、完整索引关卡、刷新分页、详情长文本与复制。浏览器操作及复制下载由主 Agent 执行，本验收者独立审阅截图和运行记录，未声称再次操作浏览器。

限制沿用原服务：历史日志缺失无法补录，超过服务预览上限的日志通过下载原文查看；本次50字列表截取不改变详情数据。无新增阻塞。
