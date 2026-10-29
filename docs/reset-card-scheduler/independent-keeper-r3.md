# N8 / F1 独立验收 R3

**结论：通过本地功能独立验收。** R2 两项阻断缺陷均已修复并经原独立复现复验通过；历史 R2 失败保留，不改写。线上部署与真实白名单卡消费尚属 N11，不在此结论内。

- 执行者：`/root/acceptance`；第3轮；时间：2026-10-29T16:49:06.746703+00:00
- Keeper基线：`1ba6e62e7eb4c5e91a38a0dfe27cf32c3bbb33e4`。
- 分支：`feat/codex-reset-card-scheduler-20261030`。
- worktree：`/Users/ly/Documents/coderepo/cpa-usage-keeper-reset-scheduler`。
- 冻结文件版本：[version-r3.json](version-r3.json)；执行前后全部SHA256匹配。
- 独立构建 `/tmp/keeper-independent-r3` SHA256：`89a45f792bd4f5515b83d878a50b1f9579649cdbf85b486732a0af1e9a733ec7`。
- 环境：Darwin arm64、Go1.27.3、独立临时SQLite，真实60秒ticker；生产无操作。

## 复验与回归

|节点/问题|操作|预期与实际|结论|
|---|---|---|---|
|R2-1|原overlay关闭auto后显式enable测试|纯临期pending取消，允许显式恢复|通过|
|R2-2|原overlay双触发任务关闭auto测试|保留单卡预约且执行一次|通过|
|N8回归|service/quota/API/migration/QuotaFloor targeted race|全部通过|通过|
|N8真实分钟调度|原独立Runner实钟60秒测试，不推进假时间|最后一分钟才消费，停止时间在窗口内|通过|
|N8构建|go build ./cmd/server|退出0并产生上列二进制|通过|

R3仅 reset_schedule.go 和对应测试相较R2改变。事务保存auto开关并取消纯expiry pending，有ScheduledAt的恢复scheduled；Reconcile依据实际ScheduledAt和auto状态，不再以历史source跳过单卡任务。未修改实体、迁移、CPA、UI。R2原完整进程的fresh schema、API取消/重约、重启持久化、前端28项、排空回执和两卡分钟执行证据仍有效；涉及调度代码的下游用本轮race回归及实钟Runner再次验证。R2程序截图仅标R2，不冒称R3运行截图。

## 原始输出

### keeper-independent-r3-repro.log

```text
=== RUN   TestIndependentDisableAutoCanExplicitlyResume

2026/10/30 00:47:19 [31;1m/Users/ly/Documents/coderepo/cpa-usage-keeper-reset-scheduler/internal/service/reset_schedule.go:65 [35;1mrecord not found
[0m[33m[0.068ms] [34;1m[rows:0][0m SELECT * FROM `reset_policies` WHERE auth_index = "one" AND `reset_policies`.`auth_index` = "one" ORDER BY `reset_policies`.`auth_index` LIMIT 1
--- PASS: TestIndependentDisableAutoCanExplicitlyResume (0.02s)
=== RUN   TestIndependentKeepSingleCardAfterDisablingExpiry

2026/10/30 00:47:19 [31;1m/Users/ly/Documents/coderepo/cpa-usage-keeper-reset-scheduler/internal/service/reset_schedule.go:65 [35;1mrecord not found
[0m[33m[0.051ms] [34;1m[rows:0][0m SELECT * FROM `reset_policies` WHERE auth_index = "one" AND `reset_policies`.`auth_index` = "one" ORDER BY `reset_policies`.`auth_index` LIMIT 1
--- PASS: TestIndependentKeepSingleCardAfterDisablingExpiry (0.01s)
PASS
ok  	cpa-usage-keeper/internal/service	1.348s
```

### keeper-independent-r3-regression.log

```text
ok  	cpa-usage-keeper/internal/service	1.534s
ok  	cpa-usage-keeper/internal/quota/test	4.514s
ok  	cpa-usage-keeper/internal/api	1.473s
ok  	cpa-usage-keeper/internal/repository/migration/test	4.016s
```

### keeper-independent-r3-minute.log

```text
=== RUN   TestIndependentRealMinuteRunner

2026/10/30 00:47:32 [31;1m/Users/ly/Documents/coderepo/cpa-usage-keeper-reset-scheduler/internal/service/reset_schedule.go:65 [35;1mrecord not found
[0m[33m[0.082ms] [34;1m[rows:0][0m SELECT * FROM `reset_policies` WHERE auth_index = "one" AND `reset_policies`.`auth_index` = "one" ORDER BY `reset_policies`.`auth_index` LIMIT 1
--- PASS: TestIndependentRealMinuteRunner (60.10s)
PASS
ok  	cpa-usage-keeper/internal/service	61.436s
```

## 关键继承文件哈希

- `internal/cpa/reset_drain.go`: `50c8a17d6cc67ee685a4e6590315ab7459b7bac3110539464c3dd6d1e48e35ed`
- `internal/entities/reset_schedule.go`: `f0d9ebf768ed612e407488f22c4ad70027eff000777fabb657bacf13ca615235`
- `internal/quota/scheduled_reset.go`: `5014e5f42011517d6311022845de9421bb71880ae2986b109a2aafe3db0f37e4`
- `internal/repository/migration/20261030_reset_schedule.go`: `290406e5137a108cf20d030d65b1943692cc9ddfab9020200394f91f37dcc728`
- `internal/service/reset_routing_guard.go`: `ccd525d10e96d5f8c6893ed9fb72bd075968bea2010817e86bea0ef58e408de3`
- `internal/service/reset_routing_guard_test.go`: `4d60ebcc689499fb4a53c4cb0860a2bebf9a8c3a36a314ce71d02edb5e050ef7`
- `web/src/components/usage/credentials/ResetSchedulePanel.module.scss`: `c8f67c7f0783279ea13f041fca6ebf6edbef2a270312f55022318c89a1b7d29c`
- `web/src/components/usage/credentials/ResetSchedulePanel.tsx`: `0f3b898cd12a0ffad43ef040bddcb557c2e83b5bb3fd3ad07baf7abd2a0cd653`

其余继承文件逐项对比 version-r2.json/version-r3.json（1424项相同）。原始失败与完整进程证据见 [R2记录](independent-keeper-r2.md)。本地范围剩余阻断：无。
