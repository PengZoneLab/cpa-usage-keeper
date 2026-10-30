# 简化页面独立验收

结论：**不通过**。源码确认预览仅 selected，账号到期读取 active_until，停用账号勾选不被禁用，保护可选；页面无模型/effort/需求输入。

真实浏览器 fixture 含周额度及短窗额度。点击计算后显示：

> Alpha 5x：上游还返回了短窗额度，当前无法自动换算；暂不生成最优结论

ranking 为 0，未满足实际计算取得结果的验收标准。无推荐是显式限制，不是 worker 挂起。最初脚本只等“推荐账号”造成90秒超时；改为接收“本次未得到账号推荐”后立即复现。原始日志见 independent.log，脚本见 independent-simple.mjs。

需要主 Agent 明确简化输入后短窗换算机制或限定支持范围；不能将容量场景包装为真实需求预测。

## R2 正负案例复验

**通过（限定实际 weekly-only 合同）。** 独立 fixture 仅提供 weekly 604800 秒额度；选择两个账号（含停用/保护状态），页面允许勾选并计算。真实 worker 返回“推荐账号：Alpha 5x”，情景总量 `418.571`，并列时按规则选择。关闭保护时可模拟停用账号；勾选保护开关后旧结果失效。页面无模型、effort 或需求输入，预览有账号到期、下次额度刷新和卡到期；容量情景明确标注不代表真实需求。390px 无横向溢出。

正例证据：`independent-weekly.log`、`independent-weekly.mjs`、`independent-desktop.png`、`independent-mobile.png`。前述短窗负例正确返回无推荐及明确原因，保留为限制验证，未捏造 shortCapacity。R1 历史失败不覆盖。
