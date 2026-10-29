# Account Planner 独立上线验收

## 开发侧复核（D4 R1）

- 复核提交：`6ae70328fea5139ff463065bde5cf2bf167e3906`
- 变更：接受只有 `rate_limit.primary_window`、604800 秒的 weekly-only 账号；仅在短窗记录存在但缺少剩余值或重置时间时阻断；界面显示 weekly-only 提示。
- 相关验证命令：

```text
npm --prefix web test -- --run src/features/account-planner/data.test.ts src/features/account-planner/AccountPlanner.test.tsx src/features/account-planner/solver.test.ts
```

- 原始结果：`data.test.ts 17 passed`、`solver.test.ts 11 passed`、`AccountPlanner.test.tsx 6 passed`，合计 34 tests passed。
- 结论：开发侧通过。weekly-only 数据不伪造短窗；缺失或不完整的显式短窗仍会阻断该账号；不把 code review 或其他非周窗口当作周额度。

## 线上独立验收

待部署完成后填写。只读检查 readyz、version、静态资源和账号数量/状态；不读取账号标识，不调用 quota、reset、enable 或模型接口。

## 线上独立验收 D4 R2

- 时间：2026-10-30（Asia/Shanghai）
- 地址：`http://192.168.31.251:8318`（通过根路径 API；`/planner/...` 会返回 SPA fallback）
- `/readyz`：HTTP 200，`{"phase":"ready","message":"Ready","progress":null}`。
- `/api/v1/version`：HTTP 200，版本 `6ae70328`，更新检查关闭。
- 静态资源：四项均 HTTP 200，资源类型正确：
  - `assets/index-CeHLhYTa.js`，1,356,795 bytes。
  - `assets/index-Cb805qTM.css`，357,526 bytes。
  - `assets/planner.worker-gKon_wmO.js`，109,255 bytes。
  - `assets/highs-CTQpMom3.wasm`，3,531,401 bytes。
- Keeper 容器：ID `c495d914ea8f…`，状态 running，镜像 `keeper-account-planner:20261030-r2`，启动时间 `2026-10-29T23:42:04.438706256Z`。
- CPA 容器：ID `9d35918f297b…`，未重启，启动时间 `2026-10-29T16:51:37.306554445Z`。
- 备份：`/opt/cpa-keeper/backups/planner-6ae70328-20261030/state.tgz` 存在。
- 账号数量、停用数量和 reset policy 统计由主 Agent 的真实浏览器情景读取；本轮未读取账号标识或凭据，也未发出 quota/reset/enable/模型请求。

结论：版本、就绪状态、worker/WASM 静态资源和容器状态通过。账号数据与浏览器实际计算属于主 Agent 后续验收范围。
