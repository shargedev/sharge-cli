# 鉴权

Sharge CLI 只使用 Open Platform API Key 访问业务 API。浏览器页面使用 Loomos JWT 完成人类身份确认，但 JWT 不会交给 CLI。

## 凭证来源

CLI 支持两种 API Key 来源：

1. `~/.sharge/settings.json`；
2. `SHARGE_API_KEY`。

优先级：

```text
settings.json apiKey > SHARGE_API_KEY
```

如果 settings 中存在 API Key 但服务端返回 `401`，CLI 立即失败，不会自动尝试环境变量中的另一身份。

不支持：

- `--api-key`；
- JWT；
- 系统 Keychain；
- 自定义 settings 路径。

`Bearer lms-...` 会被宽松规范化为原始 Key，但 settings 最终保存原始值。

## 浏览器登录

```sh
sharge login
```

默认请求全部当前 scopes：

| Scope | 能力 |
| --- | --- |
| `quick_notes:read` | 读取、搜索闪记和下载媒体 |
| `quick_notes:write` | 修改标题/正文和删除闪记 |
| `calendar:read` | 读取和搜索日历 |
| `calendar:write` | 创建、修改、删除日历和设置 todo 状态 |
| `voicemaster:read` | 读取、搜索和下载录音 |
| `ai_daily:read` | 读取和搜索日记 |

流程：

1. CLI 检查 settings 目录、权限和原子写入能力。
2. CLI 创建授权会话。
3. CLI 尝试打开服务端返回的完整 URL。
4. CLI 和页面展示相同 `user_code`。
5. 用户在页面中登录并批准完整 scope 集合。
6. CLI 按服务端间隔轮询。
7. CLI 一次性领取 API Key。
8. CLI 立即原子写入 settings。
9. 保存成功后才报告登录成功。

不能自动打开浏览器时：

```sh
sharge login --no-browser
```

CLI 会打印完整 URL。`user_code` 只用于视觉核对，不需要输入终端，也不能用于领取凭证。

## 限定 scope

`--scope` 可重复，并表示授权后的完整目标集合：

```sh
sharge login \
  --scope quick_notes:read \
  --scope calendar:read
```

这不是“新增两个 scope”，而是“最终只请求这两个 scope”。

业务命令发现 scope 不足时，会把当前已有 scopes 与所需 scopes 合并成完整命令：

```sh
sharge login \
  --scope quick_notes:read \
  --scope calendar:read \
  --scope calendar:write
```

## 幂等与强制轮换

普通登录是幂等的：

```sh
sharge login --json
```

如果 settings 凭证有效且覆盖目标 scopes，不打开浏览器：

```json
{
  "schemaVersion": "1",
  "ok": true,
  "command": "login",
  "data": {
    "changed": false
  },
  "warnings": [],
  "meta": {
    "runId": "run_...",
    "requestId": "req_..."
  }
}
```

强制重新授权并轮换 Key：

```sh
sharge login --force
```

只有环境变量凭证时，显式 `login` 仍启动浏览器授权，因为登录的目标是把 CLI 凭证写入 settings。

## JSON 登录

```sh
sharge login --json
```

- stdout 最终只输出一个 envelope。
- stderr 输出 JSON Lines 状态事件。
- 不混入人类文本。

示例事件：

```json
{"timestamp":"2026-07-31T01:00:00Z","level":"info","event":"authorization.created","authorizationId":"auth_...","userCode":"D9TF-20X4","expiresIn":600}
{"timestamp":"2026-07-31T01:00:02Z","level":"info","event":"authorization.pending"}
{"timestamp":"2026-07-31T01:00:08Z","level":"info","event":"credential.saved"}
```

事件不会包含 `pollingToken` 或 API Key。持久化日志不会保存完整授权 URL。

## 一次性领取

API Key 只能领取一次。CLI 收到 Key 后会先保存，再输出成功。

如果进程恰好在领取后、写入前崩溃，原 Key 无法找回：

```sh
sharge login --force
```

CLI 不实现 ack、明文恢复缓存或断点续领。

授权被拒绝、过期、已经领取，或被同一安装实例的新会话替代时，当前 login 立即停止。需要继续时重新执行 `sharge login --force`。

## 业务命令不会隐式登录

未登录：

```sh
sharge notes list --json
```

返回：

```json
{
  "schemaVersion": "1",
  "ok": false,
  "command": "notes.list",
  "data": null,
  "warnings": [],
  "error": {
    "type": "AUTH_REQUIRED",
    "message": "尚未配置 API Key。",
    "retryable": false,
    "nextActions": [
      {
        "description": "登录并保存 API Key",
        "command": "sharge login"
      }
    ]
  },
  "meta": {
    "runId": "run_...",
    "requestId": null,
    "httpStatus": null
  }
}
```

业务命令立即退出，不打开浏览器。

## 查看身份和 scope

```sh
sharge auth status --json
sharge auth scopes --json
```

`auth status` 显示：

- 最终凭证来源；
- settings 路径；
- base URL；
- `user_id`；
- `auth_type`；
- scopes；
- Key ID、名称、前缀、创建来源；
- client/installation 信息；
- 过期时间、最后使用时间；
- 服务端时间。

它永远不显示完整 API Key。

`auth scopes` 返回完整 scope 目录和每项 `granted` 状态。

## Logout

```sh
sharge logout
```

logout：

- 删除 settings 中活动 API Key；
- 删除上一份缓存凭证；
- 保留 installation ID、base URL 和 timezone；
- 不撤销服务端 Key；
- 不要求 `--yes`。

如果 `SHARGE_API_KEY` 仍存在，CLI 会明确提示环境变量凭证仍然有效。

远端撤销必须在开放平台页面完成。

## 安装后登录

通过 npm 安装 CLI 和可选的 Agent Skills 后，显式执行：

```sh
sharge login
```

Agent 协助登录时使用 `sharge login --no-browser`，把完整授权 URL 交给人类，并等待人类在浏览器中完成确认。登录失败不会卸载已安装的 CLI 或 Skills；修复网络或授权问题后重新执行 `sharge login`。

## 授权接口摘要

CLI 使用预注册的非安全标识：

```json
{
  "client_id": "sharge-cli"
}
```

创建会话响应至少包含：

```json
{
  "authorization_id": "auth_...",
  "polling_token": "high-entropy-secret",
  "verification_uri": "https://…/open-platform/authorize",
  "verification_uri_complete": "https://…/open-platform/authorize?authorization_id=auth_...&user_code=D9TF-20X4",
  "user_code": "D9TF-20X4",
  "expires_in": 600,
  "poll_interval": 2
}
```

授权页面尚未属于 CLI v1 实现范围；它由 web-app 项目根据该协议开发。
