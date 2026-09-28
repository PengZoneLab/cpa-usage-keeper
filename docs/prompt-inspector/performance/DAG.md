# Prompt Inspector 加载性能

目标：持久存储已解析输入/输出；首屏少量请求立即呈现；按需获取更多历史和完整上下文；刷新增量合并；失败可见可重试。保持 50 Unicode 字预览、完整详情、时间倒序和 Session 归拢、原 Keeper 授权。

源码基线：1cad978f59a2e9ebba0a243a4bd32abb30856fae。环境：macOS，8318 原 Keeper 唯一采集器，8319 viewer。原数据库只读。初始工作区干净。没有找到适用 AGENTS.md。

可编辑图：DAG.mmd。历史：LOOP.md。

|节点|负责人|依赖|完成标准|状态|轮次|产物/证据|
|---|---|---|---|---|---|---|
|A 准备|主 Agent|无|确认规范、源码/运行结构/端口归属|已完成|1|代码核查、git status 干净；global-port-manage list 8319 当前项目占用|
|B 后端缓存|cache_backend|A|独立 SQLite 持久缓存；默认不传完整上下文；每次命中仍授权；全文按需|已完成|2|conversation_cache.go; Go test/race; ACCEPTANCE.md|
|C 分页刷新|paging_frontend|A|首屏无需全量索引；历史按需；新增超过一页不丢；过滤切换不串数据|已完成|2|70条新增跨页组件测试 frontend-tests.txt|
|D 页面集成|主 Agent + paging_frontend|B,C|预览50字、输入输出、全文按需、超时/重试、展开状态保持|已完成|2|按需context、50字、重试自动化与独立验收|
|E 构建自检|主 Agent|D|Go/前端针对性回归、typecheck/lint/build通过|已完成|2|typecheck.txt lint.txt build.txt go-test.txt; 独立106测试通过，5历史失败已复现|
|F 部署|主 Agent|E|构建产物安装并重启8319，验证运行版本和鉴权|已完成|2|deployment.json; UI200、未认证401、DB0600、PID31117|
|G 独立验收|performance_review；主 Agent 采运行证据|F|独立审查通过；安全多轮会话截图；真实大日志轻量响应；缓存重启持久；权限拒绝|待手机5G复验|3|本机UI/API、重启缓存、公网域名API已通过，desktop.png及after-api.json等|
|H 整体关卡|主 Agent|G|全部必需节点证据适用于最终版本，无范围内阻断|阻塞|2|G未通过，不宣布整体完成|

第一期分页范围：按已加载请求归拢 Session，并清楚标注部分加载。不是服务器端完整 Session 聚合分页。不以本机测试冒充手机5G网络测试。
