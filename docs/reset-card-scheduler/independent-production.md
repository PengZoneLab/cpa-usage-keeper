# N11 独立生产验收（阶段记录）

执行者 `/root/acceptance`，只读。更新时间：2026-10-29T17:00:10.045509+00:00

**最终结论：N11 独立生产验收通过。** 指定单卡及真实临期两路径各成功一次；保护、额度结果、其他卡及配置收尾均已独立只读核验。下文早期阶段记录保留，最终复核见末节。

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

## 早期阶段待完成记录（现已完成）

临期账户真实窗口北京时间02:49:20—02:50:20，不能提前修改到期时间模拟。备用账户不为补测试额外消费。独立验收Agent未发stop/consume、未改设置、未发模型请求；真实动作由主Agent统一协调。上游applicable_available_count=0在本次真实指定卡仍成功重置，不能单凭该字段推断禁止消费。

## 最终临期路径与收尾复核

独立执行时间：2026-10-30北京时间02:45—02:52。未发stop/consume/model请求，未修改配置。

- 保护前02:45:15：临期账户enabled，auto=true，2张卡，尚无任务；真实到期为03:00:20.326157。
- 02:47:48读到floor expired/paused=true，派生截止02:47:20.326157；pending/attempts0。
- 真实消费窗02:49:20.326157—02:50:20.326157。独立终态：stopped_at02:49:41.370602201，成功回执02:49:44.211347285，succeeded/attempts1/code=reset。没有篡改到期时间。
- primary used_percent归0；账户disabled=true；目标10月30卡消失，仅11月卡仍available。watcher随后关闭auto。
- 原指定卡账户仍disabled，额度0，原成功任务仍attempts1，无重复消费。
- 备用账户始终没有卡任务、auto=false，额度28而非归0。其10月30卡02:48:27.933584自然到期，available列表从2变1；剩余11月卡仍available。原始列表不返回已过期卡，故没有expired/redeemed_at字段回执；依据到期时间、前后卡列表、无任务及额度未重置判断未被本任务消费。备用账户停用来自原人工dispatch_until02:20:00，reset_dispatch_until=null。
- 02:51:39重启后复核，usage/events最新请求仍分别为00:56:24.723982257和02:47:37.334559562，均早于相应强断/消费；观测窗口内无重置后新调用。此为有限时间观测，排空保证另有CPA实际transport验收与成功回执支持。

### 临时白名单移除后的最终配置

主Agent在所有任务终态后移除验收白名单，仅重建Keeper。独立确认：

- 新Keeper容器ID `956580f553200ed2ffa159558677abf314a9db17e765ce14293cd807c9d2ee05`，启动 `2026-10-29T18:50:55.080213394Z`。
- CPA启动时间仍 `2026-10-29T16:51:37.306554445Z`，未为收尾重启。
- Keeper binary SHA256仍 `e1e2698e6c66c05bb40c814d22ac8ef5c528a81b537df678efba9d74bc2ed867`。
- 实际环境已无RESET_SCHEDULE_ALLOWED_CREDITS。真实消费证据绑定移除前的严格3卡白名单；配置收尾不改变已验收代码。
- 独立遍历全部7个非删除Codex账户，auto均false，pending/running均0。
- 三个指定验收账户均保持disabled；两条成功任务仍各attempts1；备用无任务。移除限制不会在无配置情况下触发用卡。

私有原始证据：independent-expiry-before.json、independent-expiry-stop-window.json、independent-expiry-after.json、independent-expiry-events-before.json、independent-expiry-events-after.json、independent-backup-raw-final.json、independent-final-post-restart.json、independent-final-events.json、independent-final-summary.json；主Agent另保存expiry-final-snapshot.json。均在git忽略目录，不向公共记录复制账号/卡标识或请求详情。

最终范围内剩余问题与阻断：无。上游计算及延迟计费不可由本地断连追溯撤销，此边界沿用产品说明，不影响本次“CPA不再继续调用”的验收。
