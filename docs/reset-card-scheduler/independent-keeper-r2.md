# N8 / F1 独立验收 R2

**结论：不通过。** 两项关闭临期策略边界缺陷已独立复现，需 R3 修复复验。本轮其他通过项不替代整体结论。

执行者 `/root/acceptance`；时间 2026-10-29T16:46:43.761024+00:00

版本：Keeper 基线 `1ba6e62e7eb4c5e91a38a0dfe27cf32c3bbb33e4`，分支 `feat/codex-reset-card-scheduler-20261030`，工作区 `/Users/ly/Documents/coderepo/cpa-usage-keeper-reset-scheduler`。未提交实现用 [version-r2.json](version-r2.json) 逐文件 SHA256 绑定，R2独立测试及构建前逐文件比对无差异。00:45:50完整进程取证完成后已通知主Agent解除冻结进入R3；本报告写入时 reset_schedule.go 与 reset_schedule_test.go 已开始R3修复，因此不把该后续版本混入本轮结果。R2结果绑定version-r2.json及上述R2二进制。

独立构建二进制 `/tmp/keeper-independent-r2` SHA256 `bf2029a091bf7e98cfbdf180ee9c0fb24be632aaf3e4cd919aa7d7e4734bd89d`。环境 Darwin arm64、Go1.27.3；端口19285/19286经global-port-manage注册，数据库全新 `/tmp/keeper-independent-r2-data/app.db`。CPA为合成管理服务，本轮没有生产连接/卡操作。真实transport取消由 N5a 单独验收。

## 问题

|编号|复现|期望|实际|影响|
|---|---|---|---|---|
|R2-1|临期任务已生成pending且T-3截止已生效，关闭auto，然后显式enable|无单卡预约时允许显式恢复；不会自动恢复|expiry pending永不清除，prepareManual计入后拒绝enable|账户无法通过该操作恢复|
|R2-2|双触发任务已选较早expiry来源且尚未消费，保留ScheduledAt，关闭auto，到单卡时间|独立单卡预约仍执行|Reconcile根据历史source=expiry直接continue|独立单卡预约被永久跳过|

复现测试通过 Go overlay 运行，未修改实现。R2-2 用数据库构造 source=expiry、ScheduledAt仍存在的已持久状态；该状态可由临期触发消费前失败退回pending产生。

## 已通过项

- Go targeted race：service、quota/test、api、migration/test，覆盖默认关闭、精确ID、重启/去重、截止错过、未知不重试、消费前失败重试、认证401、接口校验、白名单、迁移。
- 前端28项测试通过。首次默认Node实验webstorage环境导致localStorage undefined，使用 `NODE_OPTIONS=--no-experimental-webstorage` 复跑通过，无代码修改。
- 独立实钟Runner overlay：不调用Reconcile、不推进假时钟，真实等待60秒ticker，确认最后一分钟才消费，通过。
- 独立drain receipt七种响应测试：缺active、错账户、active>0、disabled=false、drained=false均拒绝，完整正确回执才调用消费回调。
- 完整R2应用 fresh schema：reset_tasks/reset_policies/credential_quota_floors存在；无任务且auto=false。API完成预约→取消→重新预约；主动SIGTERM并重启同一DB，pending保留。
- 两条独立业务路径真实分钟运行：T=北京时间00:46:11.122423，到期=00:56:11.122423。00:43:35停新请求，00:45:35.866排空回执，00:45:35.870消费；均在T前最后一分钟。指定卡和自动卡各一次、各succeeded/attempts=1，账号保持disabled。
- 主Agent应验收Agent要求通过真实Chrome提供[预约截图](ui-r2-scheduled.png)及[结果截图](ui-r2-result.png)。截图由主Agent执行，独立业务结论依据上述独立API与mock原始事件，不冒称验收Agent操作浏览器。

## 原始证据

### keeper-independent-r2-go.log

```text
ok  	cpa-usage-keeper/internal/service	1.532s
ok  	cpa-usage-keeper/internal/quota/test	4.339s
ok  	cpa-usage-keeper/internal/api	1.434s
ok  	cpa-usage-keeper/internal/repository/migration/test	3.898s
```

### keeper-independent-r2-web-retry.log

```text

> web@0.0.0 test
> vitest run --run src/components/usage/credentials/test/ResetSchedulePanel.test.tsx src/components/usage/credentials/test/CredentialEditModal.test.tsx


 RUN  v3.2.7 /Users/ly/Documents/coderepo/cpa-usage-keeper-reset-scheduler/web

 ✓ src/components/usage/credentials/test/ResetSchedulePanel.test.tsx (6 tests) 41ms
 ✓ src/components/usage/credentials/test/CredentialEditModal.test.tsx (22 tests) 144ms

 Test Files  2 passed (2)
      Tests  28 passed (28)
   Start at  00:42:11
   Duration  836ms (transform 322ms, setup 0ms, collect 525ms, tests 185ms, environment 296ms, prepare 56ms)

```

### keeper-independent-minute.log

```text
=== RUN   TestIndependentRealMinuteRunner

2026/10/30 00:41:38 [31;1m/Users/ly/Documents/coderepo/cpa-usage-keeper-reset-scheduler/internal/service/reset_schedule.go:65 [35;1mrecord not found
[0m[33m[0.096ms] [34;1m[rows:0][0m SELECT * FROM `reset_policies` WHERE auth_index = "one" AND `reset_policies`.`auth_index` = "one" ORDER BY `reset_policies`.`auth_index` LIMIT 1
--- PASS: TestIndependentRealMinuteRunner (60.13s)
PASS
ok  	cpa-usage-keeper/internal/service	62.203s
```

### keeper-independent-receipts.log

```text
=== RUN   TestIndependentDrainReceiptsFailClosed
--- PASS: TestIndependentDrainReceiptsFailClosed (0.01s)
PASS
ok  	cpa-usage-keeper/internal/cpa/test	1.934s
```

### keeper-independent-auto-off.log

```text
=== RUN   TestIndependentDisableAutoCanExplicitlyResume

2026/10/30 00:43:14 [31;1m/Users/ly/Documents/coderepo/cpa-usage-keeper-reset-scheduler/internal/service/reset_schedule.go:65 [35;1mrecord not found
[0m[33m[0.019ms] [34;1m[rows:0][0m SELECT * FROM `reset_policies` WHERE auth_index = "one" AND `reset_policies`.`auth_index` = "one" ORDER BY `reset_policies`.`auth_index` LIMIT 1
    reset_schedule_test.go:276: auto disabled with no single-card schedule must permit explicit resume, got quota floor prevents enabling this credential
--- FAIL: TestIndependentDisableAutoCanExplicitlyResume (0.01s)
FAIL
FAIL	cpa-usage-keeper/internal/service	0.932s
FAIL
```

### keeper-independent-dual-off.log

```text
=== RUN   TestIndependentKeepSingleCardAfterDisablingExpiry

2026/10/30 00:43:37 [31;1m/Users/ly/Documents/coderepo/cpa-usage-keeper-reset-scheduler/internal/service/reset_schedule.go:65 [35;1mrecord not found
[0m[33m[0.019ms] [34;1m[rows:0][0m SELECT * FROM `reset_policies` WHERE auth_index = "one" AND `reset_policies`.`auth_index` = "one" ORDER BY `reset_policies`.`auth_index` LIMIT 1
    reset_schedule_test.go:288: disabling expiry suppressed independent single-card schedule
--- FAIL: TestIndependentKeepSingleCardAfterDisablingExpiry (0.01s)
FAIL
FAIL	cpa-usage-keeper/internal/service	0.345s
FAIL
```

### keeper-independent-plan.json

```json
{
  "target": "2026-10-29T16:46:11.122423+00:00",
  "expires": "2026-10-29T16:56:11.122423+00:00",
  "default": {
    "auth_index": "qa-scheduled",
    "auto_before_expiry": false,
    "checked_at": null,
    "error": "",
    "credits": [
      {
        "id": "qa-scheduled-card-1",
        "status": "available",
        "expiresAt": "2026-10-29T16:56:11.122423+00:00"
      }
    ],
    "tasks": []
  },
  "scheduled": {
    "auth_index": "qa-scheduled",
    "auto_before_expiry": false,
    "checked_at": null,
    "error": "",
    "credits": [
      {
        "id": "qa-scheduled-card-1",
        "status": "available",
        "expiresAt": "2026-10-29T16:56:11.122423+00:00"
      }
    ],
    "tasks": [
      {
        "credit_id": "qa-scheduled-card-1",
        "scheduled_at": "2026-10-30T00:48:11.122423+08:00",
        "expires_at": "2026-10-30T00:56:11.122423+08:00",
        "state": "pending",
        "source": "scheduled",
        "attempts": 0,
        "result_code": "",
        "stopped_at": null,
        "updated_at": "2026-10-30T00:42:11.129477+08:00"
      }
    ]
  },
  "cancelled": {
    "auth_index": "qa-scheduled",
    "auto_before_expiry": false,
    "checked_at": "2026-10-30T00:42:11.130548+08:00",
    "error": "",
    "credits": [
      {
        "id": "qa-scheduled-card-1",
        "status": "available",
        "expiresAt": "2026-10-29T16:56:11.122423+00:00"
      }
    ],
    "tasks": [
      {
        "credit_id": "qa-scheduled-card-1",
        "scheduled_at": null,
        "expires_at": "2026-10-30T00:56:11.122423+08:00",
        "state": "cancelled",
        "source": "scheduled",
        "attempts": 0,
        "result_code": "",
        "stopped_at": null,
        "updated_at": "2026-10-30T00:42:11.131487+08:00"
      }
    ]
  },
  "final_scheduled": {
    "auth_index": "qa-scheduled",
    "auto_before_expiry": false,
    "checked_at": "2026-10-30T00:42:11.130548+08:00",
    "error": "",
    "credits": [
      {
        "id": "qa-scheduled-card-1",
        "status": "available",
        "expiresAt": "2026-10-29T16:56:11.122423+00:00"
      }
    ],
    "tasks": [
      {
        "credit_id": "qa-scheduled-card-1",
        "scheduled_at": "2026-10-30T00:46:11.122423+08:00",
        "expires_at": "2026-10-30T00:56:11.122423+08:00",
        "state": "pending",
        "source": "scheduled",
        "attempts": 0,
        "result_code": "",
        "stopped_at": null,
        "updated_at": "2026-10-30T00:42:11.132851+08:00"
      }
    ]
  },
  "auto": {
    "auth_index": "qa-expiry",
    "auto_before_expiry": true,
    "checked_at": null,
    "error": "",
    "credits": [
      {
        "id": "qa-expiry-card-1",
        "status": "available",
        "expiresAt": "2026-10-29T16:56:11.122423+00:00"
      }
    ],
    "tasks": []
  }
}
```

### keeper-independent-mid.json

```json
{
  "time": "2026-10-29T16:43:59.332763+00:00",
  "qa-scheduled": {
    "reset-schedule": {
      "auth_index": "qa-scheduled",
      "auto_before_expiry": false,
      "checked_at": "2026-10-30T00:43:35.859253+08:00",
      "error": "",
      "credits": [
        {
          "id": "qa-scheduled-card-1",
          "status": "available",
          "expiresAt": "2026-10-29T16:56:11.122423+00:00"
        }
      ],
      "tasks": [
        {
          "credit_id": "qa-scheduled-card-1",
          "scheduled_at": "2026-10-30T00:46:11.122423+08:00",
          "expires_at": "2026-10-30T00:56:11.122423+08:00",
          "state": "pending",
          "source": "scheduled",
          "attempts": 0,
          "result_code": "",
          "stopped_at": null,
          "updated_at": "2026-10-30T00:42:11.132851+08:00"
        }
      ]
    },
    "quota-floor": {
      "reset_dispatch_until": "2026-10-30T00:43:11.122423+08:00",
      "dispatch_until": null,
      "auth_index": "qa-scheduled",
      "minimum_percent": null,
      "paused": true,
      "manual_hold": false,
      "remaining_percent": null,
      "checked_at": "2026-10-30T00:43:35.867756+08:00",
      "state": "expired",
      "updated_at": "2026-10-30T00:43:35.867792+08:00"
    }
  },
  "qa-expiry": {
    "reset-schedule": {
      "auth_index": "qa-expiry",
      "auto_before_expiry": true,
      "checked_at": "2026-10-30T00:43:35.859239+08:00",
      "error": "",
      "credits": [
        {
          "id": "qa-expiry-card-1",
          "status": "available",
          "expiresAt": "2026-10-29T16:56:11.122423+00:00"
        }
      ],
      "tasks": [
        {
          "credit_id": "qa-expiry-card-1",
          "scheduled_at": null,
          "expires_at": "2026-10-30T00:56:11.122423+08:00",
          "state": "pending",
          "source": "expiry",
          "attempts": 0,
          "result_code": "",
          "stopped_at": null,
          "updated_at": "2026-10-30T00:43:35.859239+08:00"
        }
      ]
    },
    "quota-floor": {
      "reset_dispatch_until": "2026-10-30T00:43:11.122423+08:00",
      "dispatch_until": null,
      "auth_index": "qa-expiry",
      "minimum_percent": null,
      "paused": true,
      "manual_hold": false,
      "remaining_percent": null,
      "checked_at": "2026-10-30T00:43:35.867785+08:00",
      "state": "expired",
      "updated_at": "2026-10-30T00:43:35.867977+08:00"
    }
  }
}
```

### keeper-independent-final.json

```json
{
  "time": "2026-10-29T16:45:50.964916+00:00",
  "qa-scheduled": {
    "auth_index": "qa-scheduled",
    "auto_before_expiry": false,
    "checked_at": "2026-10-30T00:45:35.860112+08:00",
    "error": "",
    "credits": [],
    "tasks": [
      {
        "credit_id": "qa-scheduled-card-1",
        "scheduled_at": "2026-10-30T00:46:11.122423+08:00",
        "expires_at": "2026-10-30T00:56:11.122423+08:00",
        "state": "succeeded",
        "source": "scheduled",
        "attempts": 1,
        "result_code": "reset",
        "stopped_at": "2026-10-30T00:45:35.867449+08:00",
        "updated_at": "2026-10-30T00:45:35.870622+08:00"
      }
    ]
  },
  "qa-expiry": {
    "auth_index": "qa-expiry",
    "auto_before_expiry": true,
    "checked_at": "2026-10-30T00:45:35.860112+08:00",
    "error": "",
    "credits": [],
    "tasks": [
      {
        "credit_id": "qa-expiry-card-1",
        "scheduled_at": null,
        "expires_at": "2026-10-30T00:56:11.122423+08:00",
        "state": "succeeded",
        "source": "expiry",
        "attempts": 1,
        "result_code": "reset",
        "stopped_at": "2026-10-30T00:45:35.867522+08:00",
        "updated_at": "2026-10-30T00:45:35.870832+08:00"
      }
    ]
  }
}
```

### keeper-independent-mock-events.jsonl

```json
{"path": "/v8/management/credentials/status", "body": {"name": "qa-expiry.json", "auth_index": "qa-expiry", "disabled": true}, "time": "2026-10-29T16:43:35.863361+00:00"}
{"path": "/v8/management/credentials/status", "body": {"name": "qa-scheduled.json", "auth_index": "qa-scheduled", "disabled": true}, "time": "2026-10-29T16:43:35.864064+00:00"}
{"path": "/v8/management/routing/stop-and-cancel", "body": {"auth_index": "qa-scheduled"}, "time": "2026-10-29T16:45:35.866983+00:00"}
{"path": "/v8/management/routing/stop-and-cancel", "body": {"auth_index": "qa-expiry"}, "time": "2026-10-29T16:45:35.867120+00:00"}

```

### keeper-independent-mock-consumes.jsonl

```json
{"account": "qa-scheduled", "card": "qa-scheduled-card-1", "request_id": "d6e02f06-49d7-4e56-8b2e-5860743555c4", "time": "2026-10-29T16:45:35.870182+00:00", "disabled": true}
{"account": "qa-expiry", "card": "qa-expiry-card-1", "request_id": "5a124fcb-bec2-4283-8f91-1447ea9cc33b", "time": "2026-10-29T16:45:35.870236+00:00", "disabled": true}

```

## 复现测试源码

```go
func TestIndependentRealMinuteRunner(t *testing.T) {
 s,_,_:=resetSetup(t); s.now=time.Now
 now:=time.Now();at:=now.Add(95*time.Second)
 task:=entities.ResetTask{AuthIndex:"one",CreditID:"a",ScheduledAt:&at,ExpiresAt:now.Add(time.Hour),State:"pending",Source:"scheduled",UpdatedAt:now}
 if e:=s.db.Create(&task).Error;e!=nil{t.Fatal(e)}
 ctx,cancel:=context.WithCancel(context.Background());done:=make(chan error,1);go func(){done<-s.Run(ctx)}()
 defer func(){cancel();<-done}()
 time.Sleep(2*time.Second)
 var early entities.ResetTask;s.db.First(&early,"auth_index = ? AND credit_id = ?","one","a");if early.State!="pending"{t.Fatalf("ran before final minute: %s",early.State)}
 limit:=time.Now().Add(68*time.Second)
 for time.Now().Before(limit){var got entities.ResetTask;s.db.First(&got,"auth_index = ? AND credit_id = ?","one","a");if got.State=="succeeded" {if got.StoppedAt==nil||got.StoppedAt.Before(at.Add(-time.Minute))||got.StoppedAt.After(at){t.Fatal("outside consumption window",got)};return};time.Sleep(time.Second)}
 t.Fatal("real minute runner did not consume")
}

func TestIndependentDisableAutoCanExplicitlyResume(t *testing.T){
 s,_,_:=resetSetup(t);ctx:=context.Background();now:=time.Now();expiry:=now.Add(11*time.Minute);past:=now.Add(-time.Minute)
 if e:=s.db.Create(&entities.ResetTask{AuthIndex:"one",CreditID:"a",ExpiresAt:expiry,State:"pending",Source:"expiry"}).Error;e!=nil{t.Fatal(e)}
 if e:=s.db.Save(&entities.CredentialQuotaFloor{AuthIndex:"one",ResetDispatchUntil:&past,Paused:true}).Error;e!=nil{t.Fatal(e)}
 if _,e:=s.SetAuto(ctx,"one",false);e!=nil{t.Fatal(e)}
 floor,_,_:=floorSetup(t);floor.db=s.db
 if e:=floor.prepareManual(ctx,"test.jsonone","one",false);e!=nil{t.Fatalf("auto disabled with no single-card schedule must permit explicit resume, got %v",e)}
}

func TestIndependentKeepSingleCardAfterDisablingExpiry(t *testing.T){
 s,f,now:=resetSetup(t);ctx:=context.Background();at:=now.Add(20*time.Minute);expiry:=now.Add(15*time.Minute); f.cards[0].ExpiresAt=expiry.Format(time.RFC3339Nano)
 // A dual-trigger task previously selected the earlier expiry trigger, but never sent a consume.
 if e:=s.db.Create(&entities.ResetTask{AuthIndex:"one",CreditID:"a",ExpiresAt:expiry,ScheduledAt:&at,State:"pending",Source:"expiry"}).Error;e!=nil{t.Fatal(e)}
 if _,e:=s.SetAuto(ctx,"one",false);e!=nil{t.Fatal(e)}
 // Use a valid still-before-expiry manual time; source is historical and must not suppress it.
 at=now.Add(8*time.Minute);s.db.Model(&entities.ResetTask{}).Where("auth_index = ? AND credit_id = ?","one","a").Update("scheduled_at",at)
 *now=at.Add(-30*time.Second)
 if e:=s.Reconcile(ctx,"one");e!=nil{t.Fatal(e)}
 if len(f.consumed)!=1{t.Fatal("disabling expiry suppressed independent single-card schedule")}
}

```
