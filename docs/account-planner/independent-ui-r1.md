# N8 独立界面验收第1轮

- 版本：基线 `ae2be0c3`（验收时工作树含开发者未提交改动，以下 SHA 为文件内容 SHA256）
- 时间：2026-10-30 07:02 Asia/Shanghai
- 执行者：独立 UI 验收 Agent
- 方法：Playwright headless Chrome，Vite `http://127.0.0.1:5196/planner`；API 全部只读 fixture 拦截；未发生产写请求。
- 文件 SHA：见 `ui-browser-r1.json`。

## 结果

**阻塞，不通过。** 页面未进入账号规划器。应用重复请求 `/api/v1/startup/status` 后还请求 `/api/v1/status`、`/api/v1/version`、`/api/v1/usage/api-keys/options`。fixture 未覆盖这些启动依赖，返回空 JSON，页面未出现“参与账号”标题，30 秒超时。

原始请求、异常、失败截图：`ui-browser-r1.json`、`ui-failure-r1.png`。没有宣称 worker、计算、推荐、取消、响应式或 401 通过；这些项目待修复 fixture/启动路由后复验。

追加复验（中文 locale `cpa-usage-keeper-language=zh`）确实加载页面并成功请求 WASM（`highs.wasm`, HTTP 200）。Fixture 展示 Alpha 5x、Beta 20x、未知/缺失/stale 账号，错误标识可见。点击“计算优先账号”后 60 秒未出现结果，原始日志记录为 Timeout；因此计算/推荐/取消/移动端项目仍不通过。已知待修复项：样例短窗 fixture 与计算输入需核对；SCSS 全局 label/input 污染；无重读快照按钮；历史估计异常缺少 catch；参数改变后的异步旧值风险；日期 `toISOString` 时区风险；结果公式目前只有文字说明。
