# N5a 独立验收 — CPA 账户停止与取消

结论：**通过本地源码及真实 transport 验收**。本结论不代表线上部署或真实卡消费通过。

- 执行者：独立验收 Agent `/root/acceptance`，第 1 轮。
- 时间：2026-10-29T16:36:36.097842+00:00
- Keeper 基线：`1ba6e62e7eb4c5e91a38a0dfe27cf32c3bbb33e4`。
- 工作区：`/Users/ly/Documents/coderepo/cpa-usage-keeper-reset-scheduler`。
- CPA 基线：`d946c4fba6fc9a5cfbca1f3d85184d62ad2fb683`（v8.0.40）。
- 冻结 patch SHA256：`2fa4a92ee8648aaacf670fefb6655ee3fc951bc8d9507fa1d1a62f965a99afad`。
- 独立源码目录：`/private/tmp/cpa-independent-reset-20261030`，由 prepare.sh 从基线重新生成。所有 patched 文件 SHA256 与 evidence/version.json 一致。
- 环境：Darwin arm64，Go 1.27.3；真实本地 HTTP/SSE/WebSocket upstream；无生产凭据。

## 步骤、期望及实际结果

| 范围 | 独立执行 | 期望/实际 | 状态 |
|---|---|---|---|
| 构建输入 | 精确基线重新 archive/apply，逐文件 hash 比对 | 无冲突、无不一致 | 通过 |
| 实际取消 | verify.sh 调用 production CodexAutoExecutor 三种 transport | 上游断开、执行退出、active=0 | 通过 |
| 稳定性 | 三种真实 transport 的 race 用例重复 10 次 | 无竞态、无超时/漏关 | 通过 |
| 账户隔离 | 网络执行与 WS 双账户用例 | 仅目标账户断开，另一账户保持运行 | 通过 |
| 新入场及锁存 | 并发 50 个入场、停止后重复入场、后台变更和显式 reopen | 禁止新入场，后台变更不清除锁存，显式 reopen 后放行 | 通过 |
| 假排空防护 | 拒绝退出的流 source、延迟会话 | 尚未退出时返回错误且 active>0；退出后关闭晚到会话 | 通过 |
| 管理请求 | 独立编写 overlay 用例，StopAndCancel 后调用 APICall 到真实本地服务器 | 200、正确替换合成 token；账户仍可显式启用 | 通过 |
| API 边界 | invalid/unknown/enabled/non-Codex 测试 | 非法状态不返回 drained=true | 通过 |
| 回归 | auth、management、API 包完整测试 | 全通过 | 通过 |
| 编译 | go build ./cmd/server | 可执行文件生成，退出码 0 | 通过 |

审查所有直接 Execute/CountTokens/ExecuteStream 调用点，普通、重试和 Home 路径均通过 guard；管理 HttpRequest 刻意保留。已有测试的重复入场覆盖停止后的重试入口拒绝；未另制造生产 401 重试。流计数直到 source 关闭才释放，cancel 本身不直接归零。

## 原始执行输出

### cpa-independent-reset-verify.log

```text
ok  	github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth	1.547s
ok  	github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor	1.800s
ok  	github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth	2.088s
ok  	github.com/router-for-me/CLIProxyAPI/v8/internal/api/handlers/management	4.247s
ok  	github.com/router-for-me/CLIProxyAPI/v8/internal/api	1.441s
```

### cpa-independent-extra.log

```text
=== RUN   TestIndependentResetGuardManagementRemainUsable
--- PASS: TestIndependentResetGuardManagementRemainUsable (0.00s)
PASS
ok  	github.com/router-for-me/CLIProxyAPI/v8/internal/api/handlers/management	1.605s
```

### cpa-independent-transport-repeat.log

```text
ok  	github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor	1.825s
```

## 独立补充测试源码

通过 Go overlay 替换测试文件参与本轮测试，未修改冻结源码。最初 overlay 使用 /tmp 路径遇到 macOS /private/tmp 规范化差异，显示 no tests to run；已纠正并确认出现 TestIndependentResetGuardManagementRemainUsable 的 RUN/PASS，前两次空跑不作为证据。

```go
package management
import("context";"encoding/json";"net/http";"net/http/httptest";"strings";"testing";"os";"path/filepath";"github.com/gin-gonic/gin";"github.com/router-for-me/CLIProxyAPI/v8/internal/config";a "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth")
func TestIndependentResetGuardManagementRemainUsable(t *testing.T){
 dir:=t.TempDir(); path:=filepath.Join(dir,"account.json");os.WriteFile(path,[]byte(`{"type":"codex","disabled":true}`),0600)
 m:=a.NewManager(nil,nil,nil); x:=&a.Auth{ID:"account.json",FileName:"account.json",Provider:"codex",Disabled:true,Metadata:map[string]any{"access_token":"synthetic-token"},Attributes:map[string]string{"path":path}};x.EnsureIndex();m.Register(context.Background(),x)
 if _,e:=m.StopAndCancel(context.Background(),x.ID);e!=nil{t.Fatal(e)}
 upstream:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){if r.Header.Get("Authorization")!="Bearer synthetic-token"{t.Error("token substitution missing")};w.Write([]byte(`{"available_count":1}`))}));defer upstream.Close()
 h:=NewHandlerWithoutConfigFilePath(&config.Config{AuthDir:dir},m);body,_:=json.Marshal(map[string]any{"auth_index":x.Index,"method":"GET","url":upstream.URL,"proxy_url":"direct","header":map[string]string{"Authorization":"Bearer $TOKEN$"}})
 rec:=httptest.NewRecorder();c,_:=gin.CreateTestContext(rec);c.Request=httptest.NewRequest("POST","/",strings.NewReader(string(body)));h.APICall(c);var out apiCallResponse;json.Unmarshal(rec.Body.Bytes(),&out);if rec.Code!=200||out.StatusCode!=200||!strings.Contains(out.Body,"available_count"){t.Fatalf("management blocked %d %s",rec.Code,rec.Body)}
 rec=httptest.NewRecorder();c,_=gin.CreateTestContext(rec);c.Request=httptest.NewRequest("PATCH","/",strings.NewReader(`{"name":"account.json","auth_index":"`+x.Index+`","disabled":false}`));h.PatchAuthFileStatus(c);if rec.Code!=200{t.Fatalf("enable failed %d %s",rec.Code,rec.Body)};live,_:=m.GetByID(x.ID);if live.Disabled{t.Fatal("enable did not persist")};if _,e:=m.StopAndCancel(context.Background(),x.ID);e!=a.ErrResetGuardEnabled{t.Fatalf("enabled accepted %v",e)}
}

```

## 边界与剩余验收

N5a 未发现阻断缺陷。线上部署与三账户白名单卡验证由主 Agent 统一执行，当前没有真实断连或消费操作。Keeper 的 T-3 分钟停派、T-1 分钟强断确认、错过 T 不消费仍属独立的待验收节点。本地排空只保证 CPA 执行退出及连接关闭，不保证上游已生成内容不计费、也不保证上游延迟结算消失。并发显式 enable 是用户主动重新开放；生产控制面不得在消费流程中另行启用该账户。
