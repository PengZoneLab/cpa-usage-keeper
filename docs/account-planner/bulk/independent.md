# 批量选择与到期账号独立验收

**撤回，不作为验收结论。** weekly fixture 加入一个已到期账号。清空、全选、反选操作可执行；选择未到期账号后真实 worker 返回唯一 ranking，推荐 Beta 20x，说明到期账号被跳过。计算结果情景总量 245.714。无 JS 错误。

证据：`verify.log`、`verify.mjs`、`desktop.png`、`mobile.png`。代码已确认移动端预览使用通用 Modal，展示账号到期、额度刷新、重置卡到期三类时间，并提供关闭操作；本轮脚本覆盖批量操作与到期跳过，Modal DOM由现有组件渲染。
