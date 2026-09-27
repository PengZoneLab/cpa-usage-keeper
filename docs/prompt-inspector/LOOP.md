# Loop 历史

## 第1轮：准备与方案
- 本机8318为Homebrew Keeper1.15.7；CPA8317；request-log=false。
- 主工作区已有未跟踪文件，源码独立放置到相邻目录。
- Fork确认为PengZoneLab/cpa-usage-keeper（GitHub返回的真实归属），保留upstream；稳定基线v1.15.8。
- 独立Agent发现双默认Keeper会竞争HTTP usage queue，舍弃双采集方案。8319仅反代8318 API，不打开数据库。
- 原有日志API+UI可复用，新增Prompt优先区块与完整原始请求区块。
- Go不在PATH，准备安装构建依赖；npm ci完成。

## 第2轮：实现、自检与修复
- 实现独立Go界面服务，新增Prompt解析模块与原弹窗小型接入。
- 独立Agent审查发现SPA深链刷新404；增加回退和路由测试后通过。历史失败不改写。
- 首次测试命令使用了多余web前缀，未找到测试；修正后15项通过。
- Homebrew Go无bottle；改用官方Go1.26.8归档，核验SHA256后构建成功。
- typecheck、lint、build、Go代理鉴权/路由测试通过；设计检测无发现。

## 第3轮：部署与真实验收
- 开启CPA request-log与Keeper日志读取，配置均已备份，重启8318；8319注册端口并安装LaunchAgent。
- launchctl显示running，8319/usage返回200；首次探测发生在启动前返回000，进程启动后复核通过。
- 真实请求 gpt-6-luna /v1/chat/completions 返回200与KEEPER_OK；事件9687、request_id=d4a525ad。
- 浏览器使用原管理员密码登录，统计和筛选可用；请求弹窗显示系统/用户Prompt与原始参数。点击复制后系统剪贴板JSON模型核对一致；浏览器专用剪贴板接口为空，改用系统剪贴板核验。
- 实际截图 prompt-detail.png；无伪造数据或页面注入。

### 修复链追溯

```mermaid
flowchart LR
 H1["N4-R1 独立审查：SPA深链404｜不通过"] --> H2["N4-F1 增加SPA回退与测试｜完成"] --> H3["N4-R2 /usage与/analysis路由测试｜通过"]
 style H1 fill:#fff,stroke:#888
 style H2 fill:#b7efc5,stroke:#268444
 style H3 fill:#b7efc5,stroke:#268444
```

主Agent完成真实浏览器下载，13970字节，REQUEST BODY与发送JSON逐字段一致。生产原始日志留在本机Downloads，不入Git。

## 第4轮：独立验收与交付
- 独立Agent对b972192c执行登录、鉴权、真实非流式与流式请求正文、下载、缺失事件、8318保留、8319回环/SPA等检查，全部通过。
- 独立测试覆盖Go viewer和TestRequestLog（含6MiB边界），Prompt解析7项；详情见ACCEPTANCE.md。
- 最终运行代码保持b972192c，后续只归档文档证据。Fork分支已推送；README记录更新、构建、日志范围、依赖及停用回滚。
- 有效DAG全部完成，历史SPA失败仍保留。范围内剩余阻断：无。
