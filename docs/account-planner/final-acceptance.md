# 最终验收

- 基线：远程 `origin/master` `ae2be0c3c8af76ca859e301e5311d6c0522ec655`
- 分支：`feat/account-optimal-planner-20261030`
- Worktree：`/Users/ly/Documents/coderepo/cpa-usage-keeper-optimal-planner`
- 独立数学验收：8 个反例通过；开发测试11个通过。
- 独立界面验收：R3通过；真实Highs WASM、2行ranking、取消、参数失效、401、390px无溢出、只读请求通过。
- 前端全量：206个测试文件、1650项通过；TypeScript、Lint、Build通过。Lint仅保留原有2条UsagePage Hook warning。
- Go：静态 `/planner` 路由测试通过。
- 生产构建资产：`web/dist/assets/index-Dh0pvJB6.js`、`index-Cb805qTM.css`、`planner.worker-gKon_wmO.js`、`highs-CTQpMom3.wasm`。
- 状态：代码未提交、未推送、未合并、未部署；原工作区未修改。

## 范围限制

求解器只对有限事件网格 MILP 宣称最优。未来自然重置周期、卡恢复100%、需求均匀到达、短窗换算和人工恢复延时都是页面可见假设。没有同模型同 effort 的完整历史时，页面不补预测，用户需填写情景需求。页面只读，不会切换账号、启用账号、修改停派或消费重置卡。
