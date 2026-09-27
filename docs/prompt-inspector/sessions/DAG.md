# Session 与 Prompt 列表最终 DAG

完成。代码版本 `6690fe37`；运行端口8319。全部请求跨Session按时间倒序；精确Session分组内外倒序；缺失与未知分开；列表50字；详情保留全文。

```mermaid
flowchart LR
 S1["S1 规范与数据链路：完成"]
 S2["S2 分组与预览数据：完成"]
 S3["S3 两种列表与完整详情：完成"]
 S4["S4 构建与自检：完成"]
 S5["S5 8319运行验收：完成"]
 S6["S6 独立验收与复验：完成"]
 S7["S7 交付与证据归档：完成"]
 S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> S7
 classDef done fill:#d9f5df,stroke:#25823b,color:#163d20
 class S1,S2,S3,S4,S5,S6,S7 done
```

|编号|名称|负责人|依赖|完成标准|状态|证据|轮次|
|---|---|---|---|---|---|---|---|
|S1|规范与数据链路|主Agent及实现Agents|无|确认源码/权限/只读策略|完成|源码基线0db6a6e9|2|
|S2|分组与预览数据|主Agent及实现Agents|S1|精确Session补充和Unicode50字|完成|session_metadata测试、promptPreview测试|2|
|S3|两种列表与完整详情|主Agent及实现Agents|S2|两种倒序视图、详情全量|完成|RequestBrowser组件测试|2|
|S4|构建与自检|主Agent及实现Agents|S3|Go/25前端测试、类型、lint、构建通过|完成|LOOP.md|3|
|S5|8319运行验收|主Agent及实现Agents|S4|真实8319索引/预览/详情/复制/下载/移动通过|完成|runtime.json及PNG|3|
|S6|独立验收与复验|独立Agent /root/review|S5|独立Agent复验通过|完成|ACCEPTANCE.md|3|
|S7|交付与证据归档|主Agent及实现Agents|S6|版本、图源、历史、证据归档|完成|代码6690fe37及本目录|3|

历史：[LOOP.md](LOOP.md)。独立验收：[ACCEPTANCE.md](ACCEPTANCE.md)。运行原始结果：[runtime.json](runtime.json)。

既有限制：历史未记录日志不可补回，超过上游6MiB预览上限的日志需下载原文；50字截取不改变详情数据。剩余阻塞：无。
