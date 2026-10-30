# 线上独立验收

状态：**阻塞**。

独立 Playwright 导航 `http://192.168.31.251:8318/planner` 返回 `net::ERR_CONNECTION_TIMED_OUT`。未取得线上 bundle，未加载账号，未执行计算，未发起账号启停或重置卡操作。

脱敏原始日志：`production.log`。待部署及网络恢复后复验；不得将本地 fixture 通过替代线上通过。
