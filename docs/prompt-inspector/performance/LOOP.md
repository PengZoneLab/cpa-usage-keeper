# Loop 历史

## 第1轮：准备与实现
- 现象：手机公网已能打开页面，对话行一直加载。
- 已确认代码问题：Session 等待筛选范围内全部请求页；conversation 默认返回 full_input；缓存仅浏览器内存。
- 历史实测请求11878：输入247字符、输出194字符，但响应1,912,234字节。不能仅凭这一条断言手机无限加载的唯一根因。
- A通过：基线1cad978f，干净工作区、8319锁归属当前项目，原DB只读。
- B/C并行实施；G已安排实际独立Agent performance_review。
- 不写原Keeper数据库，不启动第二采集器。

## 第1轮中间验证
- B通过：Go tests及race通过，独立review确认持久化reopen、撤权403、2MiB上下文默认响应<1000B、全文按需与TTL测试。
- 发现并修复：并发队列超时曾返回空200，改504；未终止SSE不得长期缓存，改15秒。历史失败保留于本记录。
- 实机接口基线before-api.json：列表50条正常，原历史conversation返回500，未认证401。
- 原Keeper日志2026-09-28 10:40元数据同步401，10:41 request-log上游403；CPA原始错误为IP banned due to too many failed attempts，剩余约27分钟。已请求用户更新Keeper配置为当前CPA管理密码，禁止在对话发送凭据。未绕过封禁，未改原服务凭据。
- 浏览器cua getTab/nameSession报Codex auth token is unavailable，运行截图阻塞，已请用户重新连接。

## 第2轮：前端集成与回归
- C/D通过：Session局部立即呈现与按需分页；UsagePage真实组件70条新增跨2页刷新，并保持older-history cursor；完整上下文点击获取；错误重试与超时。
- 直接执行6文件24测试通过，记录frontend-tests.txt；typecheck/lint成功。Go测试成功。Vite构建成功，保留既有>500kB bundle警告。
- 扩大组件suite出现5条旧HTML断言失败，独立review正在核对基线，未把全套测试标为通过。
- 已知边界：当前API无since ID查询，时间戳早于最新已读记录的迟到数据及服务端删除，需重新加载页面；Session数量只表示已加载数据，不声称完整会话计数。

## 第2轮：部署与停止条件
- E通过：独立前端7文件106测试通过；历史5失败在隔离git archive HEAD上逐一复现，无本次回归。
- F通过：备份旧binary为~/.local/bin/keeper-prompt-viewer.before-performance，替换并kickstart既有local.keeper-prompt-viewer；未启动新采集器。沿用当前owner已持有的8319锁，重复register提示已锁，未force/未释放。
- 运行binary SHA256 0ea50c130d324ea9930a8dea51cb68715df5f8d709851b3e8f0e5e9fda640946；bundle index-DF300fWs.js。UI HTTP200、未认证conversation401、cacheDB0600。/health返回HTML，只记录事实，不作API健康证据。
- G代码独立验收通过，生产对话与浏览器截图仍阻塞。需要用户更新Keeper的CPA管理凭据、等待CPA临时封禁解除，以及恢复Codex浏览器连接。未重启CPA绕过封禁，未伪造截图。
- H未完成。当前为本地工作区改动，未提交或推送本次变更。

## 第3轮：用户恢复凭据后复验（2026-09-28）
- 未修改任何密码；使用现有本地配置登录验证成功。
- after-api.json：首屏50条、请求11878从1,912,234字节降为855字节，cold 0.167秒/hot0.002秒；safe两轮分别20与60；未认证401。
- 独立Agent亲测API与按需全文，见independent-after-api.json和independent-context-api.json。
- 原生Chrome绕过失效的浏览器插件连接（不是绕过网站安全）：正常登录，选择Yesterday/gpt-6-luna，展开safe Session，两轮input/output均可见；Refresh保持展开，点击完整context显示4条消息。原始desktop.png。
- 8319既有LaunchAgent重启后cached_record的expiry/summary长度/context长度未变；接口200，见cache-restart.json及after-restart-api.json。
- 本机访问公网域名ahai.tech:8319得到200/855字节，见public-host-api.json；不等价手机5G。
- G/H等待用户手机5G确认，其他运行阻塞解除。代码与binary未改，仍为deployment.json记录版本。

## 版本交付（2026-09-28）
用户明确要求将本次变更合并到 origin/master。提交前 fetch 确认本地 master 与 origin/master 无分叉；生产源文件 SHA256 与独立验收 manifest 全部一致。凭据扫描无命中，git diff --check 通过。提交范围为本次性能改造、针对性测试及证据。手机 5G 待用户确认，不因版本提交改变验收状态。
