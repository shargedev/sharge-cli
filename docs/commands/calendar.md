---
title: Calendar 命令
description: Calendar 的读取、搜索、创建、更新、删除与 Todo 状态命令。
---

# Calendar 命令

Calendar 对应 Calendar、日程、闪极日程和 Loomos Calendar。

所有 datetime 必须包含显式 offset。v1 只支持结构化输入，不解析自然语言。

读取命令不会猜测“今天”“本月”或当前时间范围：

- `month` 必须显式提供 `YYYY-MM`；
- `list` 必须同时提供 `--start` 和 `--end`；
- `search` 只按标题搜索，当前 Open API 不支持时间范围过滤；
- `--timezone` 必须是 IANA timezone，例如 `Asia/Shanghai`。它同时决定
  `X-Client-Date` 和月视图的本地日期边界。

`--source-type` 的默认值是 `all`，可选值为
`all|manual|quick_note|audio_recorded`。CLI 使用产品命令名 Calendar；这些值是
Open API 的业务字段，不会被重命名或推断别名。

## 业务对象

Calendar event：

| 字段 | 类型/枚举 |
| --- | --- |
| `id` | integer |
| `title` | string |
| `type` | `event\|todo` |
| `description` | string/null |
| `location` | string/null |
| `start_time` | aware datetime |
| `end_time` | aware datetime/null |
| `is_all_day` | boolean |
| `timezone` | string |
| `rrule` | string/null |
| `excluded_dates` | datetime array/null |
| `enable_alarm` | boolean |
| `trigger_seconds` | integer |
| `trigger_description` | string/null |
| `source_type` | `manual\|quick_note\|audio_recorded` |
| `source_id` | string/null |
| `completed` | boolean/null |
| `created_at` / `updated_at` | datetime |

Instance：

| 字段 | 说明 |
| --- | --- |
| `instance_id` | 重复实例标识 |
| `event_id` | 主 event ID |
| `original_start_time` / `original_end_time` | 原始时间 |
| `actual_start_time` / `actual_end_time` | 实际时间 |
| `trigger_start_time` | 提醒触发时间 |
| `is_cancelled` | 是否排除 |
| `created_at` / `updated_at` | 时间 |

JSON 中未超过 JavaScript 安全整数范围的 `id`/`event_id` 是 integer；更大的
十进制 ID 会无损输出为 string。位置参数仍接受十进制数字字符串，Agent 不应把
ID 转成浮点数。

## `sharge calendar month`

读取明确月份：

```text
sharge calendar month <YYYY-MM>
  [--source-type <all|manual|quick_note|audio_recorded>]
  [--timezone <iana>]
```

Scope：`calendar:read`

本地校验：

- 只接受四位年和两位月；
- 年必须在 `1970..2100`，月必须在 `01..12`；
- 非法输入在发起网络请求前返回 `INVALID_INPUT`。

```sh
sharge calendar month 2026-07 \
  --timezone Asia/Shanghai \
  --source-type all \
  --json
```

`data`：

```json
{
  "dates": {
    "30": []
  },
  "events": {
    "123": {}
  },
  "has_new_instances": false
}
```

`dates` 按月内日期映射实例，`events` 按 event ID 映射主对象。重复执行安全。
JSON 保持这两个动态字典的 key 和 Open API 的 snake_case 字段原样，不做
camelCase 转换，也不丢弃后端新增字段。

文本输出列出本月 event/todo 摘要；需要按日期读取实例、完整 DTO 或动态字典时
使用 `--json`。

## `sharge calendar list`

读取时间范围：

```text
sharge calendar list --start <rfc3339> --end <rfc3339>
  [--source-type <all|manual|quick_note|audio_recorded>]
  [--timezone <iana>]
```

Scope：`calendar:read`

约束：

- `end` 必须晚于 `start`；
- 范围不能超过 31 天；
- 两者必须包含 offset。
- `--timezone` 只接受 IANA timezone；不改变 `start`/`end` 本身携带的 offset。

上述约束由 CLI 在联网前检查。范围长度按两个时间点的实际 UTC 时差计算。

```sh
sharge calendar list \
  --start 2026-07-30T00:00:00+08:00 \
  --end 2026-08-01T00:00:00+08:00 \
  --source-type all \
  --json
```

`data`：

```json
{
  "events": [],
  "instances": []
}
```

JSON 中 event、todo 和 instance 的业务字段保持 snake_case 原样，后端新增字段
也会透传。文本输出每行一个 item 摘要。重复执行安全。

## `sharge calendar search`

按标题搜索：

```text
sharge calendar search <keyword>
  [--source-type <all|manual|quick_note|audio_recorded>]
  [--limit <1..100>]
```

Scope：`calendar:read`

默认 `limit=30`。

搜索词去除首尾空白后不能为空。当前 Open API 只支持标题搜索，不接受
`--start`、`--end` 或隐式时间范围。结果只包含当前用户的正式 event/todo；
草稿不会返回。

```sh
sharge calendar search "评审" --limit 20 --json
```

`data` 是 event 数组，每项额外包含 `matched_title`。重复执行安全。
文本输出每行一个命中摘要；完整的匹配字段和动态 DTO 使用 `--json`。

## `sharge calendar get`

```text
sharge calendar get <event-id>
```

Scope：`calendar:read`

```sh
sharge calendar get 123 --json
```

返回正式 event 或 todo。草稿和不属于当前用户的资源返回 `NOT_FOUND`。重复执行安全。

`event-id` 必须是正整数。CLI 不通过“先 list 再过滤”模拟详情读取；它直接调用
详情接口，并在 `NOT_FOUND` 时建议重新执行 `calendar list` 或
`calendar search`。JSON 详情保留 Open API snake_case 字段和未知字段。

## Calendar 读取命令错误

四个读取命令共享以下主要错误和恢复方向：

| 错误 | 退出码 | 恢复方向 |
| --- | ---: | --- |
| `INVALID_INPUT` | 2 | 查看对应命令的 `--help --json`，修正月份、时间、timezone、枚举或 ID |
| `AUTH_REQUIRED` | 3 | 执行 `sharge login` |
| `SCOPE_REQUIRED` | 4 | 按 `nextActions` 重新授权 `calendar:read` |
| `NOT_FOUND` | 5 | 重新 list/search 当前用户的正式 Calendar item |
| `RATE_LIMITED` | 7 | 由调用方根据 `retryAfterMs` 决定是否重试 |
| `NETWORK_ERROR` / `TIMEOUT` | 8 | 读取命令可由 Agent 决定是否重试 |
| `SERVER_ERROR` | 8 | 保留 requestId，执行 `sharge doctor --json` |
| `CANCELLED` | 130 | 仅在仍需要结果时重新执行读取命令 |

CLI 不自动重试、不自动扩展时间范围，也不自动补发第二次查询。

## Create/Update 输入字段

| JSON 字段 | Flag | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | `--title` | 是 | 1–255 字符 |
| `description` | `--description` | 否 | nullable；默认 null |
| `location` | `--location` | 否 | nullable，最多 255 字符；默认 null |
| `timezone` | `--event-timezone` | 否 | nullable；IANA 名或 UTC offset；默认 null |
| `type` | `--type` | 否 | `event` 默认，或 `todo` |
| `start_time` | `--start-time` | 是 | 带 offset |
| `end_time` | `--end-time` | 否 | nullable；带 offset；默认 null |
| `is_all_day` | `--is-all-day` | 否 | 显式 `true\|false`；默认 false |
| `rrule` | `--rrule` | 否 | nullable；RFC 5545 RRULE；默认 null |
| `enable_alarm` | `--enable-alarm` | 否 | nullable；显式 `true\|false`；默认 null |
| `trigger_seconds` | `--trigger-seconds` | 否 | 默认 0，最小 -864000 |
| `trigger_description` | `--trigger-description` | 否 | nullable，最多 255 字符；默认 null |

flags 不能表达 null；省略可选 flag 时 CLI 按上表补成确定的 null/default。
需要明确审阅每个 nullable 字段时使用 `--input`。输入对象拒绝未知字段；
datetime 必须带 offset。CLI 会校验 RRULE 至少包含受支持的
`FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`，具体组合仍由 Open Platform 校验。

`--event-timezone` 与全局 `--timezone` 不同：

- `--event-timezone` 写入业务对象的 `timezone`；
- `--timezone` 控制本次 CLI 日期语义和 `X-Client-Date`。

## `sharge calendar create`

```text
sharge calendar create <business flags...>
sharge calendar create --input <json|@file|->
```

Scope：`calendar:write`

简单 flags：

```sh
sharge calendar create \
  --title "项目例会" \
  --type event \
  --start-time 2026-08-03T10:00:00+08:00 \
  --end-time 2026-08-03T11:00:00+08:00 \
  --event-timezone Asia/Shanghai \
  --json
```

结构化输入：

```json
{
  "title": "项目例会",
  "description": "讨论 v1",
  "location": null,
  "timezone": "Asia/Shanghai",
  "type": "event",
  "start_time": "2026-08-03T10:00:00+08:00",
  "end_time": "2026-08-03T11:00:00+08:00",
  "is_all_day": false,
  "rrule": "FREQ=WEEKLY;COUNT=4",
  "enable_alarm": true,
  "trigger_seconds": -900,
  "trigger_description": "提前 15 分钟"
}
```

```sh
sharge calendar create --input @event.json --dry-run --json
sharge calendar create --input @event.json --json
sharge calendar create --generate-input
```

`--generate-input` 离线输出原始 JSON 模板，不输出 success envelope，不读配置、
stdin 或网络。`--input`、业务 flags 和 `--generate-input` 互斥。

`--dry-run` 在零网络下输出最终 `POST` URL、完整规范化 body、所需 scope、
side effects、`retrySafe: false` 和未验证前置条件。它不要求 API Key，也不验证
资源端业务状态。

成功 `data` 是新 event。Open API 创建项的 `source_type` 为 `manual`。

创建没有服务端幂等键。timeout/network unknown outcome 时 CLI 不自动重试，
Agent 也不应直接重复创建；先用唯一标题执行 `calendar search`，必要时再按明确
时间范围 `calendar list` 确认。

## `sharge calendar update`

```text
sharge calendar update <event-id> <complete business flags...>
sharge calendar update <event-id> --input <json|@file|->
```

Scope：`calendar:write`

这是完整 PUT，不是局部 PATCH。CLI 发给服务端的 body 始终包含修改后的完整
Create 字段集合，并额外包含：

| JSON 字段 | Flag | 默认 | 说明 |
| --- | --- | --- | --- |
| `action` | `--action` | `all` | `all\|instance\|future` |
| `instance_id` | `--instance-id` | null | action 为 instance/future 时必填 |

`--input` 必须包含完整 Create 字段集合；`action` 和 `instance_id` 可以省略，
CLI 会分别补为 `all` 和 null，最终 PUT body 仍然完整。

使用 flags 时，省略可选业务 flag 会被明确重置为上表中的 null/default，而不是
保留服务端旧值。安全流程是先 `calendar get <event-id> --json`，构造完整
`--input`，执行 `--dry-run` 审阅最终 body，再执行真实 PUT。

`instance_id` 是服务端返回的 opaque 字符串。CLI 仅原样透传，不解析、不拼装、
不修改；`action=instance|future` 时本地必填，`action=all` 时必须为 null 或省略。

更新全部：

```json
{
  "title": "新的项目例会",
  "description": null,
  "location": null,
  "timezone": "Asia/Shanghai",
  "type": "event",
  "start_time": "2026-08-03T10:30:00+08:00",
  "end_time": "2026-08-03T11:30:00+08:00",
  "is_all_day": false,
  "rrule": "FREQ=WEEKLY;COUNT=4",
  "enable_alarm": true,
  "trigger_seconds": -900,
  "trigger_description": null,
  "action": "all",
  "instance_id": null
}
```

更新单个实例：

```sh
sharge calendar update 123 \
  --input @instance-update.json \
  --dry-run \
  --json

sharge calendar update 123 --generate-input
```

成功 `data`：

```json
{
  "action": "instance",
  "created_events": [],
  "updated_events": [],
  "deleted_events": []
}
```

更新保留原 `source_type` 与 `source_id`。可能触发现有提醒和 revision 更新。
`--generate-input` 与 dry run 的离线/互斥语义和 create 相同。

PUT 没有服务端幂等键。timeout/network 返回 `outcome: "unknown"` 且
`retryable: false`，CLI 不自动重试。后端的 `action=all` 可能以新 ID 替换旧
event，因此不能只 get 旧 ID；先按更新后的唯一标题执行 `calendar search`。
CLI 的直接恢复动作统一按更新后标题执行可复制的 `calendar search`。对于
`action=instance|future`，search 定位候选后，再用覆盖目标实例的明确时间范围
执行 `calendar list --json`，确认实际结果后再决定是否重发。

## `sharge calendar delete`

```text
sharge calendar delete <event-id>
  [--type <all|current|future>]
  [--instance-id <id>]
  --yes
```

Scope：`calendar:write`

| Type | 含义 | instance ID |
| --- | --- | --- |
| `all` | 删除整个 event/series | 不需要 |
| `current` | 删除当前实例 | 必填 |
| `future` | 删除当前及未来实例 | 必填 |

删除全部：

```sh
sharge calendar delete 123 --type all --yes --json
```

删除未来：

```sh
sharge calendar delete 123 \
  --type future \
  --instance-id instance_... \
  --yes \
  --json
```

dry run 不要求 `--yes`：

```sh
sharge calendar delete 123 \
  --type future \
  --instance-id instance_... \
  --dry-run \
  --json
```

成功 `data` 使用 update result schema。不可恢复，重复执行不安全。

本地约束：

- `--type` 默认 `all`；
- `current|future` 必须提供服务端返回的 opaque `--instance-id`；
- `all` 不接受 `--instance-id`；
- 真实删除必须显式提供 `--yes`，CLI 永不交互询问；
- `--dry-run` 不要求 `--yes`、不要求 API Key，且不发送网络请求。

dry run 输出最终 DELETE URL（含 query）、`calendar:write`、结构化 side
effects、`retrySafe: false` 和未验证前置条件。

删除没有服务端幂等键。timeout/network 返回 `outcome: "unknown"` 且
`retryable: false`，CLI 不自动重试。先执行 `calendar get <event-id> --json`
读取 series 状态；current/future 再按原实例时间范围执行 list 确认。

## `sharge calendar todos set-status`

批量设置 todo 完成状态：

```text
sharge calendar todos set-status
  --event-id <id>...
  --status <completed|uncompleted>
  [--input <json|@file|->]
```

Scope：`calendar:write`

Flags 可重复：

```sh
sharge calendar todos set-status \
  --event-id 101 \
  --event-id 102 \
  --status completed \
  --json
```

JSON：

```json
{
  "event_ids": [101, 102],
  "status": "completed"
}
```

约束：

- `event_ids` 至少一个正整数；重复 ID 会在本地稳定去重；
- status 只接受 `completed|uncompleted`；
- 目标必须是 todo，event 返回输入错误。

CLI 把产品输入映射为后端 `completed_ids/uncompleted_ids` 双数组；dry run 的
body 展示实际后端请求。`--generate-input` 离线输出原始产品 JSON 模板，
与业务 flags、`--input`、`--dry-run` 和 JSON 输出互斥。

成功 `data` 原样返回后端两个数组。默认文本使用中文摘要。写入没有服务端
幂等键；发生 unknown outcome 时不自动重试。错误中的可复制恢复命令会逐个执行
`calendar get <event-id> --json`，确认全部 todo 的 completed 状态，不能只抽查
批次中的第一个 ID。
