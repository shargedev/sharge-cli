---
title: 待办命令
description: 待办的单页列表、详情、创建、局部修改、批量完成与删除。
---

# 待办命令

待办是一件要做完的事：标题、可选的开始时间、完成状态。没有结束时间，不重复、不提醒。占时段、重复或到点提醒用 [日程](./calendar.md)。

ID 在 flags 与 JSON 中都写成十进制字符串，范围为 1..18446744073709551615，不转成 Number。JSON 数字不作为待办 ID 接受；请使用字符串。读取需要 `calendar:read`，写入需要 `calendar:write`。

## `sharge todos list`

```sh
sharge todos list --status unfinished --limit 20 --json
sharge todos list --status all --cursor 'opaque-cursor' --json
```

只读一页，不自动翻页。`--status` 可选 unfinished（默认）、completed 或 all；`--limit` 为 1–100，默认 20。首页不传 cursor。返回 `{ items, next_cursor, has_more }`；续页用返回的精确 cursor。不支持按标题或日期筛选。

## `sharge todos get`

```sh
sharge todos get 123 --json
```

读取一条待办；不存在或不属于当前用户时返回 `NOT_FOUND`。待办包含 `id`、`title`、可为 null 的 `start_time`、`timezone`、`completed`、`source_type`、`created_at` 和 `updated_at`。ID 无损输出为字符串。

## `sharge todos create`

```sh
sharge todos create --title '准备评审' --json
sharge todos create --input '{"title":"准备评审","start_time":"2026-11-12T10:00:00+08:00","timezone":"Asia/Shanghai"}' --dry-run --json
sharge todos create --generate-input
```

标题去掉首尾空白后须有 1–255 字，按输入原样发送。开始时间可不填，填写时必须是带显式 offset 的 RFC 3339 时间。`--timezone` 为待办的 IANA 时区或 UTC 偏移；不指定时沿用服务端规则。用户没给时间就不传。成功要求 HTTP 201 与完整待办回执。

## `sharge todos update`

```sh
sharge todos update 123 --title '今天评审' --json
sharge todos update 123 --clear-start-time --json
sharge todos update 123 --input '{"start_time":null}' --dry-run --json
sharge todos update 123 --generate-input
```

局部 PATCH，只传要改的字段，至少提供 title 或 start_time。`--start-time` 与 `--clear-start-time` 互斥。JSON 的 `start_time: null` 清除时间；没传的字段不变。

## `sharge todos complete`

```sh
sharge todos complete --todo-id 123 --todo-id 456 --completed true --json
sharge todos complete --input '{"ids":["123","456"],"completed":false}' --dry-run --json
sharge todos complete --generate-input
```

接收 1–100 个 ID，按原顺序去重；`--completed true` 完成，false 恢复未完成。发给服务端的 ID 是无损 JSON 整数。返回 `{ "changed_count": 0 }`，表示实际变化条数，0 也是成功；已是目标状态、不存在或不属于当前用户的待办被跳过。不能说每个 ID 都成功，要逐条确认用 get。

## `sharge todos delete`

```sh
sharge todos delete --todo-id 123 --todo-id 456 --yes --json
sharge todos delete --input '{"ids":["123","456"]}' --dry-run --json
sharge todos delete --generate-input
```

接收 1–100 个 ID，按原顺序去重。真实不可恢复删除须显式 `--yes`。成功文本为“实际变更 N 条”；返回实际 `changed_count`，含 0。

所有写命令支持 `--input` inline、`@file`、`-`（显式 stdin），与业务 flags 互斥。`--generate-input` 离线单独使用。`--dry-run` 零网络、不要求凭证、展示最终请求计划，不验证远端存在性与归属。

写操作 `retrySafe: false`，不会自动重发。请求发送后超时、断网或成功回执不完整，返回 `outcome: "unknown"`、`retryable: false`。create 用 `sharge todos list --json` 找最新同标题条目，不能唯一确认就如实报告；update、complete、delete 用 `sharge todos get <id> --json` 逐条核对。
