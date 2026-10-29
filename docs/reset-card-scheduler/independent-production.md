# N11 独立生产验收（阶段记录）

执行者 `/root/acceptance`，只读。更新时间：2026-10-29T17:00:10.045509+00:00

**阶段结论：部署与指定时间单卡路径通过；临期自动路径待真实到期窗口，N11尚未整体通过。**

## 版本与部署核验

- master：`c5e8abff1d54352ddd458e6105674c9db3ed74e6`。
- CPA image：`cpa-reset-scheduler:20261030`；image ID `sha256:b7afdb76bd35e5ae8da915ccc60073cb0b75fc86c613bd8746545870fad3ddd8`。
- Keeper image：`keeper-reset-scheduler:20261030`；image ID `sha256:79d684a5dc8c71e62fdf345aaa74166af68bd8c365ed3f96655a49763769a874`。
- CPA binary SHA256：`2479a3f6cb9219518a4df2cdbe147c3d0a347fe06ea0d20f6615a8f9a85b44b5`。
- Keeper binary SHA256：`e1e2698e6c66c05bb40c814d22ac8ef5c528a81b537df678efba9d74bc2ed867`。
- 运行容器binary hash与本地linux build逐字匹配。两容器running；Keeper健康；readyz HTTP200。
- 两旧容器以before-reset-20261030后缀保留且退出0；state.tgz回滚备份存在。
- 实际RESET_SCHEDULE_ALLOWED_CREDITS与私有scope精确匹配：3账户各1张指定卡。没有输出凭据。
- 配置前私有快照三账户auto=false、tasks=[]；独立配置后快照确认仅指定预约及临期账户开启，备用账户未配。

## 指定单卡真实路径

T为北京时间2026-10-30 00:59:00；派生截止00:56:00。

- 独立00:55:20快照：目标卡仍available，任务pending/attempts0。
- 截止后读取floor：expired/paused=true，reset deadline为00:56:00。
- 消费回执：stopped_at 00:58:41.392518505，updated_at 00:58:45.598157266，succeeded/attempts1/code=reset，在最后一分钟内且早于T。
- 独立官方usage读取：primary used_percent=0（消费前88），账户仍disabled。
- 消费前2张卡；消费后只剩11月到期卡available，选中目标卡不再返回。其他两账户仍各2张卡、无消费任务。
- 独立管理GET原始credits也只返回剩余卡；上游不返回已消费目标，因此**没有目标redeemed_at字段证据**，不作此宣称。
- 独立usage/events最新请求开始时间00:56:24.723982257，早于强断/消费；截至00:59:18未观察消费后新增调用。分钟扫描停派存在秒级延迟，不以日志静默替代排空回执。

原始证据保存在git忽略的private目录：independent-before-consume.json、independent-stop-before.json、independent-after-baicheng.json、independent-baicheng-raw-credits.json、independent-events-before.json、independent-events-after-baicheng.json；另有主Agent的before-real-validation/configured快照。账号/卡标识及凭据不写入公共记录。

## 待完成

临期账户真实窗口北京时间02:49:20—02:50:20，不能提前修改到期时间模拟。备用账户不为补测试额外消费。独立验收Agent未发stop/consume、未改设置、未发模型请求；真实动作由主Agent统一协调。上游applicable_available_count=0在本次真实指定卡仍成功重置，不能单凭该字段推断禁止消费。
