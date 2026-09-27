# Session输入与返回最终DAG

完成。源码 `caf685f2`，本地macOS运行8319，未推送。

目标：Session展开直接阅读每条请求输入Prompt与模型返回；长内容展开全文；大日志可读；保留排序、50字列表、原鉴权和原始日志入口。

```mermaid
flowchart LR
 A["A 数据与规范检查：完成"]
 B["B 提取完整输入与输出：完成"]
 C["C Session对话展示：完成"]
 D["D 构建与回归：完成"]
 E["E 8319实际验收：完成"]
 F["F 独立验收与交付：完成"]
 A --> B --> C --> D --> E --> F
 classDef done fill:#d9f5df,stroke:#25823b
 class A,B,C,D,E,F done
```

|编号|负责人|依赖|验收标准|状态|证据|轮次|
|---|---|---|---|---|---|---|
|A|主Agent|无|规范、实际日志格式、安全边界确认|完成|5982a443基线及LOOP|3|
|B|后端Agent|A|原鉴权下提取输入/最终返回、大日志可读|完成|Go tests/实际30日志/API复验|3|
|C|前端Agent|B|直接读输入与返回、上下文全文展开、刷新保持状态|完成|组件回归/desktop.png|4|
|D|主Agent|C|类型lint构建及相关回归通过|完成|ACCEPTANCE.md|4|
|E|主Agent|D|两轮真实问答、大日志正文/分页、移动截图|完成|api-runtime.json / desktop.png / mobile.png|4|
|F|独立review Agent/主Agent|E|独立复验通过、源码与证据归档|完成|ACCEPTANCE.md / caf685f2|4|

[历史](LOOP.md) · [独立验收](ACCEPTANCE.md) · [运行数据](api-runtime.json)

剩余阻断：无。边界：日志未记录的正文不能恢复；超128MiB单日志明确提示下载。
