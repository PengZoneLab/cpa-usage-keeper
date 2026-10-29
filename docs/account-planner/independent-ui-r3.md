# N8 独立界面验收第 3 轮

- 时间：2026-10-30 07:15:23 Asia/Shanghai（独立日志文件 mtime；执行完成时间）
- 执行者：独立 UI 验收 Agent
- 版本：生产 preview `http://127.0.0.1:5196/planner`；真实 Highs WASM；API 只读 fixture。
- 执行命令：`node docs/account-planner/browser-smoke.mjs`
- 原始日志：[independent-ui-r3.log](independent-ui-r3.log)
- 结构化证据：[developer-browser.json](evidence/developer-browser.json)

## 结论

**通过。** 独立浏览器验证取得 2 行真实 worker ranking，结果数值为：Alpha 5x 与 Beta 20x 均得分 587.912、月得分 67.912、区间 470.329–623.494、差值 0.000。页面显示模型内结果。Highs WASM 实际加载并完成计算。

通过项目：

- 多账号与 5x/20x 权重展示。
- 真实 worker 计算，ranking 行数为 2。
- 参数修改使旧结果失效。
- 延迟 WASM 后取消计算，取消后无结果。
- 401 重读进入登录提示。
- 桌面截图与 390px 手机截图已生成。
- 请求方法只包含 GET，以及只读 `POST /api/v1/quota/cache`。
- 页面无 JavaScript 错误。

## 最终源码 SHA256

完整六个文件 SHA 见 [final-sha256.txt](final-sha256.txt)。R1/R2 失败记录保留，不覆盖。


修订记录：2026-10-30 07:16，修正区间数值、执行时间和 SHA 证据链接。
