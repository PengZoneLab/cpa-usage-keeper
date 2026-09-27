# UI 独立验收

执行者：独立 Agent `/root/acceptance`，2026-09-27 16:54–16:59 Asia/Shanghai。

结论：本次请求详情 UI 优化通过独立代码审查、组件回归及真实截图审查。范围内无未解决阻断。

## 最终产物版本

基线 HEAD `4f22b1e79b0fe30648cf7e43ecdb014c962d2a14` 加本次未提交差异。验收文件 SHA256：

- PromptReader.tsx：`59286b5ea636867081a2aabdf2b1060c25674ed487b03777a3644f8c9d205557`
- PromptReader.module.scss：`935547b479446bb944bf32cce1d0048e0551e95894c327a74cd4073eef75a08a`
- RequestEventLogModal.tsx：`1817b2d7f01336d7cbd56d307365d5d23953adfc12de82147ffa87653207c2c1`

## 审查与修复复验

1. 初审发现新正文 pre 绕过已有虚拟化保护，长正文可能造成渲染退化。主Agent修复为长Prompt或长正文调用既有分段虚拟化渲染器；memo化解析条目与字节计算。独立组件测试确认长内容不生成逐消息article，长内容和复制值未截断。
2. 初审发现 content:null 展示为{}、空数组被省略。主Agent修复后，独立测试确认null、工具调用元信息、空数组均可见，完整入参复制逐字相同。
3. 结构化Prompt和原始正文来源未改变；未通过HTML解释用户内容。完整入参、原始日志及下载入口保留。
4. 三视图为原生button，有aria-pressed状态、可见focus-visible轮廓；复制结果使用role=status。基本键盘/读屏语义审查通过。未实际运行屏幕阅读器，不宣称完整无障碍认证。

## 独立执行测试

- 新增 `web/src/components/usage/test/PromptReader.test.tsx`：3项全部通过。覆盖三视图切换、复制、null/tool metadata/空数组、大内容渲染回退与完整复制、畸形正文保留及缺失Prompt提示。
- 原有 promptInspector、UsagePage.logic、UsagePageRuntime：89项全部通过。
- `npm run typecheck`：通过。
- 合计92项测试通过。无全量上游测试或浏览器性能基准结论；大正文验证为结构/回归测试。

## 真实截图与交互证据

独立Agent直接查看主Agent在8319运行环境采集的 `desktop.png` 和 `mobile.png`：桌面元信息侧栏与对话区层级清晰，系统/用户内容直接阅读，复制及原始日志下载可见；移动布局转为上下结构，文字换行、弹窗边界可见，无截图可见的横向溢出。

浏览器三视图切换、系统剪贴板完整JSON比对、13970字节原始日志下载及移动宽度测量由主Agent实际执行并提供证据；独立Agent未冒充执行这些浏览器操作。UI截图审查与独立组件测试共同支持本次结论。

既有覆盖边界保持：历史缺失日志不可恢复，服务端隐含上下文不补全，超过6MiB日志沿用下载方式。无新增阻断问题。
