---
title: Diary 命令
description: 日记的按月读取、搜索与详情命令。
---

# Diary 命令

Diary 对应日记、AI 日记、闪极日记和 Loomos Diary。

当前产品只暴露日记：

- CLI 固定使用后端 `report_type=daily`；
- 不提供 weekly/monthly 参数；
- 不支持生成、重试、重新生成、设置或 HTML。

所有命令要求 `ai_daily:read`。

## `sharge diary list`

读取明确月份中的日记：

```text
sharge diary list <YYYY-MM>
```

```sh
sharge diary list 2026-07 --json
```

`data` 是日记文档数组：

| 字段 | 类型/说明 |
| --- | --- |
| `identifier` | `YYYYMMDD` |
| `duration_seconds` | number，非负 |
| `extra.city` | string/null |
| `extra.keywords` | string array |
| `extra.recording_count` | integer，非负 |
| `title` | string |
| `description` | string/null |
| `cover_thumbnail_url` | string/null |
| `cover_large_url` | string/null |
| `generated_at` | datetime/null |
| `updated_at` | datetime |

月份必须真实存在。命令不隐式使用当前月份。重复执行安全。

## `sharge diary search`

```text
sharge diary search <keyword> [--limit <1..100>]
```

默认 `limit=20`，keyword 长度 1–200。

```sh
sharge diary search "上海" --limit 20 --json
```

结果在列表字段外增加：

| 字段 | 说明 |
| --- | --- |
| `matched_fields` | `title` 和/或 `body` |
| `matched_title` | 命中标题 |
| `matched_body_excerpt` | 正文命中摘要 |

`data` 是数组。重复执行安全。

## `sharge diary get`

```text
sharge diary get <YYYYMMDD>
```

```sh
sharge diary get 20260730 --json
```

identifier 必须是有效真实日期，不只是八位数字。`20260230` 在本地失败。

`data`：

| 字段 | 类型/说明 |
| --- | --- |
| `report_type` | 固定 `daily` |
| `identifier` | `YYYYMMDD` |
| `status` | `waiting\|queued\|processing\|success\|failed\|cancelled` |
| `timezone` | 报告业务时区 |
| `period_start` / `period_end` | datetime |
| `title` | string/null |
| `description` | string/null |
| `summary` | string/null |
| `duration_seconds` | number/null |
| `markdown` | string/null |
| `word_count` | integer/null |
| `generated_at` / `updated_at` | datetime/null |

正文不存在时仍可能返回报告详情，`markdown` 和 `word_count` 为 `null`。

重复执行安全。

## 不支持

不存在：

```text
sharge diary get weekly ...
sharge diary get monthly ...
sharge diary generate
sharge diary retry
sharge diary settings
```

返回数据不包含 HTML、OSS key、模板、render info、内部 metadata 或 retry 信息。
