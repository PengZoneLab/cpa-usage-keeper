# 开发指南

[返回 README](../README.zh.md) · [English](./development.md)

项目结构和本地启动步骤见 README 的开发者参考。

## 图表时间处理

- 使用响应/配置时区。自然日使用 `internal/timeutil.CivilDate` 和 `DayBounds`，滚动窗口使用真实时长；自然日不一定是24小时。
- 通过 repository 的桶读取适配方法查询现有增量表。Overview 与 Latency 的小时锚点不同；Activity 保留既有364格及存量结束边界。查询修复不得改变写入桶或重切已有聚合。
- 原始事件时间条件与真实时间过滤复用 `internal/repository/usage_event_time_read.go`。普通查询使用有界分段，近期缓存启动/重载使用开放上界读取；字段投影与生命周期逻辑保留在调用方。
- 桶身份使用真实时刻或完整日期，不使用格式化钟面标签。时间戳按真实时间排序，日桶速率使用完整自然日的实际分钟数。
- 复用 `web/src/utils/usage/timeLabels.ts` 获取时区日期部分、区分回拨时的重复钟面。保留各图表原有语言、精度、fallback和补点规则，仅对歧义钟面补offset。
- 同时验证上海普通日期和DST跳时/回拨，覆盖浏览器与响应时区不同的情况；保留现有图表样式和生命周期行为。
