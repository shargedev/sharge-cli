# JSON 契约

## 启用 JSON

所有命令默认文本。机器调用必须显式使用：

```sh
sharge notes list --json
```

不存在 `--output json`、NDJSON 默认模式或基于 TTY 的自动切换。

## Success envelope

```json
{
  "schemaVersion": "1",
  "ok": true,
  "command": "notes.list",
  "data": {
    "items": [],
    "has_more": false,
    "next_cursor": null
  },
  "warnings": [],
  "meta": {
    "runId": "run_...",
    "requestId": "req_...",
    "timezone": "Asia/Shanghai",
    "clientDate": "2026-07-31T09:00:00+08:00"
  }
}
```

规则：

- `schemaVersion` 是字符串。
- `ok` 是可靠的成功标志。
- `command` 是规范命令名。
- `warnings` 始终是数组。
- `meta.runId` 始终存在。
- 没有网络请求时 `requestId` 为 `null`。
- 成功不包含 `error`。

## Error envelope

```json
{
  "schemaVersion": "1",
  "ok": false,
  "command": "calendar.create",
  "data": null,
  "warnings": [],
  "error": {
    "type": "INVALID_INPUT",
    "message": "start_time 必须包含显式时区。",
    "retryable": false,
    "field": "start_time",
    "path": "$.start_time",
    "nextActions": [
      {
        "description": "使用带 offset 的 RFC 3339 时间",
        "command": "sharge calendar create --generate-input"
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

失败时：

- stdout 是一个完整 error envelope；
- stderr 只包含 debug 或 login 状态事件；
- 进程退出码非零；
- `data` 固定为 `null`；
- 可恢复错误提供 `nextActions`。

Agent 不应解析中文 `message` 做逻辑判断。使用 `type`、`field`、`path`、`requiredScopes`、`retryable`、`outcome` 和退出码。

## 字段命名边界

```text
CLI envelope/help/error：camelCase
Open API 业务 data：保持原始命名，通常 snake_case
--input：保持 OpenAPI 原始命名
flags：kebab-case
```

例如：

```text
--start-time
    ↓
start_time
```

CLI 不递归转换业务对象，避免破坏动态字典键、缩写和未来新增字段。

下载结果由 CLI 自己创建，因此使用：

```json
{
  "filePath": "/absolute/path/file.m4a",
  "bytes": 123,
  "mediaType": "audio/mp4",
  "sha256": "..."
}
```

## JSON help

```sh
sharge calendar create --help --json
```

help 使用普通 success envelope，help 对象位于 `data`：

```json
{
  "schemaVersion": "1",
  "ok": true,
  "command": "calendar.create",
  "data": {
    "command": "calendar.create",
    "description": "创建结构化日历事件或待办",
    "requiredScopes": ["calendar:write"],
    "arguments": [],
    "options": [],
    "inputSchema": {},
    "outputSchema": {},
    "network": true,
    "sideEffects": ["create_calendar_item"],
    "destructive": false,
    "dryRun": true,
    "retrySafe": false,
    "pagination": null,
    "errors": [],
    "examples": []
  },
  "warnings": [],
  "meta": {
    "runId": "run_...",
    "requestId": null
  }
}
```

根 help 返回完整命令目录；namespace 和具体命令 help 返回各自范围。

JSON help 不要求登录，也不访问网络。

## Structured input

写命令接受三种 `--input`：

```sh
sharge notes update 123 --input '{"title":"标题"}' --json
sharge notes update 123 --input @update.json --json
sharge notes update 123 --input - --json
```

inline、文件和 stdin 的 JSON schema 完全相同。

业务 flags 与 `--input` 互斥：

```sh
# 错误：混用了两种业务输入
sharge notes update 123 \
  --title "标题" \
  --input @update.json \
  --json
```

控制参数可以与 `--input` 共存：

```sh
sharge calendar create \
  --input @event.json \
  --dry-run \
  --timeout 30s \
  --json
```

未知字段在本地失败，不发送请求。

## 输入模板

```sh
sharge calendar create --generate-input > event.json
```

模板：

- 是可直接传给 `--input @event.json` 的原始 JSON；
- 不包 success envelope；
- 不登录、不联网；
- 与 `--json`、`--jq`、业务 flags 和 `--input` 互斥。

## Dry run JSON

```sh
sharge notes update 123 \
  --input '{"title":"新标题"}' \
  --dry-run \
  --json
```

结果包含：

- method；
- resolved base URL 与 path；
- 脱敏 body；
- required scopes；
- side effects；
- retry safety；
- `unverified` 远端条件。

dry run 不验证凭证或远端资源。

文本模式也必须完整显示相同计划字段；它可以改变排版，但不能只显示 method 和 URL。

稳定 shape：

```json
{
  "method": "PATCH",
  "url": "https://ai.shargetech.com/open-api/v1/user-memory/quick-notes/123",
  "path": "/open-api/v1/user-memory/quick-notes/123",
  "body": {
    "title": "新标题"
  },
  "requiredScopes": ["quick_notes:write"],
  "sideEffects": [
    "update_quick_note",
    "update_related_calendar_events"
  ],
  "retrySafe": false,
  "unverified": [
    "resource_exists",
    "resource_owned_by_current_user"
  ]
}
```

删除计划的 `body` 是 `null`。`url` 不包含 credential，`body` 中任何被 schema 标记为
secret 的字段必须脱敏；普通业务字段保留，供调用方在执行前核对。

## `--jq`

```sh
sharge notes list --json --jq '.data.items[] | {id, title}'
```

规则：

- 必须同时使用 `--json`；
- 作用于完整 success envelope；
- 成功 stdout 使用 jq 结果，不再保证 envelope；
- 错误仍返回完整 error envelope；
- 表达式在网络请求前校验；
- 不依赖系统 `jq`。

获取下一页 cursor：

```sh
sharge notes list --json --jq '.data.next_cursor'
```

## stdout/stderr

```text
业务结果或最终 envelope  -> stdout
文本错误                  -> stderr
debug / login 状态事件    -> stderr
持久化日志                -> ~/.sharge/sharge.log
下载二进制                -> 文件
```

stdout 不混入进度、warning 文本、debug、日志或二进制。

## Schema 版本

`schemaVersion: "1"` 只描述 CLI envelope。Open API 业务 schema 由 CLI 版本和固定 OpenAPI 契约共同确定。

破坏性 envelope 变更必须升级 schema 版本。新增可选字段不要求升级。
