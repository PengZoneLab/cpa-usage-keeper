# Account Planner 独立数学验收 R1

- 基线：`ae2be0c3c8af76ca859e301e5311d6c0522ec655`
- Worktree：`/Users/ly/Documents/coderepo/cpa-usage-keeper-optimal-planner`
- 时间：2026-10-30 07:00（Asia/Shanghai）
- 验收范围：冻结的 `solver.ts`、`types.ts`、`runner.ts`；不含 UI 和真实数据接入。
- 执行者：独立验收 Agent（N3/N8）。
- 文件 SHA256：
  - `solver.ts`: `743944fcd9d3c0a1540c3e07c825801def855976b7cd19364fbdba344e100c5f`
  - `types.ts`: `8fce8489bd7971847c15bd0a71c4930c6d3cd1bca94e6276fd23dbd24bb3d351`
  - `runner.ts`: `5dcacbda1e3bf7e8e84553411cd636f27b6b0b2e80f1cc7e7947bd889320fca0`

## 操作与结果

独立新增 `solver.independent.test.ts`，执行：

```text
npm --prefix web test -- --run src/features/account-planner/solver.independent.test.ts
```

原始结果：`8 tests passed`，耗时约 `265 ms`。

覆盖：

- 5x=1、20x=2 权重和单一需求池。
- 自然重置的周期预测与单次边界。
- 短窗口、最低额度和停派约束。
- 卡最多一次、到期前候选时刻及排空/恢复黑窗。
- 共享需求下多账号排名。
- 求解器非 Optimal 状态不标记为最优。

## 结论

本轮通过。当前求解器在有限事件网格、显式短窗容量、允许卡恢复 100% 的输入假设下，HiGHS 返回 `Optimal` 时可证明该离散 MILP 的最优值。代码说明其不主张连续时间全局最优。

限制仍有效：卡恢复量、自然重置未来重复、需求均匀到达和短窗到周额度的换算均为输入或场景假设；每卡执行后账户仍需人工恢复；真实历史数据按模型/effort 过滤仍属 UI/数据接入范围。`score` 是规划期总量，`monthScore` 单独记录月末前量；当前排序使用总量。
