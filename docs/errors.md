# 错误与退出码

## 读取错误

文本模式：

- stdout 为空；
- stderr 输出中文错误和精确下一步；
- 不倾倒完整 help。

JSON 模式：

- stdout 输出一个 error envelope；
- stderr 只用于 debug 或 login 状态事件；
- 进程返回非零退出码。

Agent 必须同时检查退出码和 `ok`。

## 稳定错误字段

| 字段 | 说明 |
| --- | --- |
| `type` | 稳定机器错误类型 |
| `message` | 中文人类说明，不用于逻辑判断 |
| `retryable` | Agent 是否可以考虑重试 |
| `outcome` | 写操作是否可能已经执行 |
| `field` | 参数或字段名 |
| `path` | JSON path |
| `requiredScopes` | 缺失 scope |
| `nextActions` | 可复制恢复动作 |
| `httpStatus` | HTTP 状态 |
| `requestId` | 服务端请求关联 ID |

`nextActions` 示例：

```json
[
  {
    "description": "重新授权完整 scope 集合",
    "command": "sharge login --scope quick_notes:read --scope calendar:read --scope calendar:write"
  }
]
```

Agent 仍需确认 next action 符合用户意图，不能无条件执行破坏性动作。

## 退出码

| Code | 含义 | 常见类型 |
| --- | --- | --- |
| `0` | 成功 | — |
| `1` | 本地文件或 CLI 内部错误 | `FILE_IO_ERROR`、`INTERNAL_ERROR` |
| `2` | 命令或输入错误 | `INVALID_COMMAND`、`INVALID_INPUT`、`FILE_EXISTS` |
| `3` | 未登录或凭证无效 | `AUTH_REQUIRED`、`CREDENTIAL_INVALID`、`AUTHORIZATION_DENIED`、`AUTHORIZATION_EXPIRED`、`AUTHORIZATION_CONSUMED`、`AUTHORIZATION_SUPERSEDED` |
| `4` | scope 或权限不足 | `SCOPE_REQUIRED`、`PERMISSION_DENIED` |
| `5` | 资源不存在 | `NOT_FOUND` |
| `6` | 冲突 | `CONFLICT` |
| `7` | 限流 | `RATE_LIMITED` |
| `8` | 暂时性失败 | `NETWORK_ERROR`、`TIMEOUT`、`SERVER_ERROR` |
| `130` | 用户取消 | `CANCELLED` |

HTTP 状态码不直接作为退出码。

## 常见错误

### `INVALID_COMMAND`

未知命令或不支持的 option。本地失败，不联网。

```sh
sharge notes --help --json
```

CLI 不根据产品别名自动纠错或执行另一命令。

### `INVALID_INPUT`

包括：

- 类型或枚举错误；
- 缺少必填字段；
- flags 与 `--input` 混用；
- 未知 JSON 字段；
- datetime 无 offset；
- 非法 timezone；
- 读命令使用 dry run；
- 删除缺少 `--yes`。

错误应提供 `field`/`path` 和修复示例。

### `AUTH_REQUIRED`

没有 settings API Key，也没有 `SHARGE_API_KEY`：

```sh
sharge login
```

业务命令不会自行打开浏览器。

### `CREDENTIAL_INVALID`

选中的 settings API Key 无效或过期。settings 存在时不会回退环境变量：

```sh
sharge login --force
```

### `AUTHORIZATION_DENIED` / `EXPIRED` / `CONSUMED` / `SUPERSEDED`

登录授权被拒绝、过期、已经领取，或被同一安装实例的新会话替代。当前 CLI 立即停止，不继续轮询。

需要登录时重新执行：

```sh
sharge login --force
```

### `SCOPE_REQUIRED`

凭证有效，但不包含命令所需 scope。读取 `requiredScopes` 和完整 `nextActions.command`。

### `NOT_FOUND`

资源不存在或不属于当前用户。服务端不区分这两种情况，以免泄露资源归属。

### `CONFLICT`

资源状态与请求冲突，例如授权会话已被处理。先读取当前状态，再决定下一步。

### `RATE_LIMITED`

服务端返回 `429`。CLI 不自动重试。错误可能包含 retry-after 信息；Agent 决定是否等待和重试。

### `NETWORK_ERROR`

请求未能可靠完成。读操作通常可考虑重新调用；写操作需要检查 `outcome`。

### `TIMEOUT`

CLI 到达总超时。普通请求默认 `30s`，下载默认 `10m`，登录不超过服务端授权有效期。

### `SERVER_ERROR`

服务端 `5xx`。CLI 不自动重试。

### `FILE_EXISTS`

显式 `--file` 的目标已存在：

```sh
sharge recordings download 456 \
  --file ./meeting.m4a \
  --overwrite \
  --json
```

自动生成的文件名发生冲突时不会报错，而是选择安全后缀。

### `FILE_IO_ERROR`

本地文件写入或原子发布失败，例如磁盘空间不足、目录权限不足或 I/O 错误。
该错误不可直接重试；先检查目标目录，再由 Agent 决定新的下载路径。

## Unknown outcome

写请求发出后发生 network/timeout：

```json
{
  "type": "TIMEOUT",
  "retryable": false,
  "outcome": "unknown"
}
```

正确恢复流程：

1. 不直接重发。
2. 使用相应读取命令检查资源。
3. 如果远端已执行，结束或继续后续任务。
4. 如果确认未执行，再由 Agent 决定是否重新提交。

例：Calendar create 超时后，可用明确时间范围和标题搜索验证是否已创建。

## 无自动重试

CLI 不重试 network、timeout、429 或 5xx。`retryable` 只是提供给 Agent 的判断信息。

对于写操作，仅当：

- 已确认第一次没有执行；
- 或命令 help 明确声明重复执行安全；

才可以重新调用。

## 本地日志

每个 envelope 的 `meta.runId` 对应本地日志：

```sh
sharge logs path
```

向支持人员提供：

- `runId`；
- `requestId`；
- CLI version；
- error type；
- 脱敏日志片段。

不要提供 API Key、settings 全文或业务数据。
