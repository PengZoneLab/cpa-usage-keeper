# 独立验收：移动请求阅读与角色分离

执行者：独立 Agent `/root/mobile_review`。时间：2026-09-28 12:01 +0800。
版本：基线 `0d3fac59c5bf88fcecf0536c430471ade8af2369` + 本轮工作区修改。
当前结论：后端角色分离、前端组件交互与静态检查通过；运行截图和真实移动布局待审阅，整体暂不宣称通过。

## 验收轮次与原始结果

1. 第一轮：Go race 通过；前端 4 文件共 7 fail / 32 pass。2 项 Session ID 旧断言与新收起布局冲突；5 项 DetailsCard 历史断言不适用阅读器。未将失败改写为通过。
2. 后端补修 legacy `system + prompt`、`developer + prompt` 和不重复已存在 user 后，独立执行 `go test -race ./cmd/prompt-viewer -count=1`：`ok cpa-usage-keeper/cmd/prompt-viewer 2.396s`。
3. 前端修正 Session 测试与角色交互用例后，独立执行 RequestBrowser、RequestBrowserConversation、RequestBrowser.acceptance：3 files / 4 tests passed。
4. 独立 `npm --prefix web run typecheck`、`npm --prefix web run lint`：均 exit 0。
5. 单独复验 RequestEventsDetailsCard：5 failed / 30 passed，未新增第六个失败。失败分别为旧标题/总数/表格的复合测试，2 个旧表格日志按钮 title，旧 loading 标签，旧详情禁止显示 Request ID。新 reader 原本不走这些旧表格操作；本轮标题改为“请求记录”。此测试文件仍红，不可宣称全套前端测试通过。

## 已审查标准

- Chat system/developer/user/assistant/tool 分开；Responses instructions、显式/隐式 message、input_text 和字符串 input；Anthropic system；Gemini systemInstruction/parts/model；legacy prompt 均有协议用例。
- 没有 user 时不以系统提示词、instructions、assistant 内容伪装为用户输入。
- 默认接口不附带完整上下文或 role_messages；2 MiB fixture 默认响应 <1000 bytes；context=1 才加载角色内容。
- 默认页面显示本轮用户输入和模型返回；展开上下文后系统、开发者、用户卡片独立，原始 JSON 可切换，保留全文。
- 刷新展开态、50 Unicode 字预览、手动加载历史仍有组件回归。
- CSS 触控按钮 min-height 44px，长文本 overflow-wrap/min-width 与窄屏网格已审查；静态规则不能替代真实尺寸/溢出测量。

## 核验产物 SHA256

- conversation.go: `8d7f119bf22c2eee3de35936af3b614e969120be6da76317f1e793c8cdcdadab`
- conversation_roles.go: `1606780bb3363efee920229bcdf62e4cf4217450ad2730f5e6b5ea21837440eb`
- RequestBrowser.tsx: `22ba116baa598440499f26f1af588a071ce6034fb21add29735023ddafa00759`
- RequestBrowser.module.scss: `cd91dd41a6e39db2bca23af8a8d62e3389120a67ee83cee1b9bdc5c26520ef3b`

## 待验证

主 Agent 部署后提供 390px 原始截图、页面宽度/触控尺寸与上下文交互证据；独立审阅后追加结论。手机 5G 真机效果未由本 Agent 测试。

## 第3轮：更新失效断言与独立截图审阅

主 Agent 明确授权验收者仅修测试断言（未改实现）。旧表格按钮断言改为权限开启时 reader 分组；实际点击打开日志仍由 RequestBrowserConversation 交互测试覆盖。旧 loading button 改为 reader 保留且详情 modal 有 polite live status；详情保留 Request ID 以可追溯，同时继续禁止内部 filename/cache metadata。无权限表格标题改为现有译名 Requests & Prompts，保留计数与 API Key 表格断言。

中间复验 2 failed / 33 passed：新 reader fixture 缺 session metadata 因此标题显示元数据不可用；补充显式 Session fixture 后再次复验。

最终 `vitest` 4 files / 39 tests passed（12:08:10，1.08s）。此前失败是历史记录，不覆盖。

独立打开并审阅 `after-mobile.png` 与 `roles-mobile.png`：Chrome 390×844 响应式运行界面，筛选收起，session 短标识与模型清晰；角色图实际包含本轮用户 Prompt、模型返回“结果是60（20×3=60）”、紫色系统提示词、蓝色历史用户与绿色历史回答20。所示范围未见横向裁切；Network 显示普通 conversation 与 context=1 均200，完整上下文请求发生于展开后。截图只能证明Chrome响应式视口，不等同手机5G或Safari真机。

非阻断视觉瑕疵：完整入参与日志按钮末字换到下一行，文字仍可读。未以截图推断所有按钮精确44px，44px为源码样式保证。

当前结论更新：本轮独立自动化与390px运行截图审阅通过；公共网络/真机未在本轮独立操作。等待主Agent原始入参切换与部署版本记录汇总，整体交付以该记录为准。

## 最终独立结论

**通过本次移动阅读器与角色分离验收。** 最终 CSS 仅补 `white-space: nowrap`；独立复看 `roles-mobile-final.png`，日志按钮已单行，用户/系统/历史角色分区仍清晰，390×844所示区域无可见裁切。此前按钮换行记录已被最终截图验证修复。

最终运行产物：binary SHA256 `5af4bd5e76cdc43ec563cea262647beb59af0559b402d5615887d4742d098bd0`；bundle `index-C16TBoKd.js`（截图 Network initiator可见）。最终 CSS SHA256 `6e351e6990d21bbf8e9c8b9edc007670d0a1ec4071a686a52167796d5fb98c32`，替代上述旧 CSS hash。逻辑文件未因此更改，39 tests / Go race / typecheck / lint证据仍适用。

独立审阅主Agent运行产物 `api-verification.json`：11600 默认230 bytes、不含role或full_input；按需1055 bytes，role顺序 system/user/assistant/user；11878默认855 bytes、不含上下文。主Agent报告实际切换原始入参见完整JSON，并刷新后仍保留展开态；该交互另有组件自动化通过。该部分标明主Agent执行，非独立重复浏览器操作。

剩余范围内阻断：无。边界：本次是真实Chrome响应式390px页面验收，不宣称手机5G/Safari真机新版本验收或已对所有屏宽进行实测。
