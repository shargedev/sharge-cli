# Notes 命令

Notes 对应 Quick Note、闪记和 Live Photo。

Open API 支持读取、搜索、修改标题/正文、删除和媒体下载，不支持创建。

## 数据字段

Note 业务对象保持 OpenAPI 原始字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | integer/string | Note ID；超出 JavaScript 安全整数范围时以十进制字符串无损返回 |
| `title` | string/null | 标题 |
| `content` | string/null | 正文 |
| `status` | `pending\|processing\|success\|failed` | 处理状态 |
| `location` | string/null | 位置 |
| `longitude` / `latitude` | number/null | 坐标 |
| `has_calendar_events` | boolean | 是否有关联 Calendar |
| `available_media_types` | array | `audio`、`image`、`video` |
| `media_downloads` | object | 媒体类型到下载 path |
| `matched_fields` | array | 搜索命中 `title`/`content` |
| `matched_title` | string/null | 命中标题 |
| `matched_content` | string/null | 命中正文 |
| `created_at` / `updated_at` | datetime | RFC 3339 |

## `sharge notes list`

读取一页 Notes：

```text
sharge notes list [--cursor <id>] [--limit <1..100>]
                  [--created-at-start <rfc3339>]
                  [--created-at-end <rfc3339>]
```

Scope：`quick_notes:read`

Options：

| Option | 默认 | 说明 |
| --- | --- | --- |
| `--cursor <id>` | `0` | 十进制 ID cursor，不透明原样使用 |
| `--limit <n>` | `20` | 1–100 |
| `--created-at-start <time>` | — | 创建时间下界，必须带 offset |
| `--created-at-end <time>` | — | 创建时间上界，必须带 offset |

开始时间不能晚于结束时间。

```sh
sharge notes list \
  --limit 20 \
  --created-at-start 2026-07-01T00:00:00+08:00 \
  --created-at-end 2026-08-01T00:00:00+08:00 \
  --json
```

`data`：

```json
{
  "items": [],
  "has_more": true,
  "next_cursor": 123
}
```

`next_cursor` 与 Note `id` 在安全整数范围内是 integer；超出
`Number.MAX_SAFE_INTEGER` 时 CLI 以十进制 string 返回，避免舍入。调用方应始终把 cursor
视为不透明值并原样传回。

一次调用只读取一页。重复执行安全。

## `sharge notes search`

搜索标题和正文：

```text
sharge notes search <query> [--cursor <id>] [--limit <1..100>]
                    [--created-at-start <rfc3339>]
                    [--created-at-end <rfc3339>]
```

Scope：`quick_notes:read`

```sh
sharge notes search "发布计划" --limit 20 --json
```

输出与 list 相同；每个命中项可能包含 `matched_fields`、`matched_title` 和 `matched_content`。

一次只返回一页。重复执行安全。

## `sharge notes get`

```text
sharge notes get <note-id>
```

Scope：`quick_notes:read`

```sh
sharge notes get 123 --json
```

`data` 是一个完整 Note 对象。重复执行安全。

## `sharge notes update`

只修改 `title` 和/或 `content`：

```text
sharge notes update <note-id>
  [--title <title>] [--content <content>]
  [--input <json|@file|->]
  [--generate-input] [--dry-run]
```

Scope：`quick_notes:write`

至少提供一个字段。flags 与 `--input` 互斥。

Flags：

```sh
sharge notes update 123 \
  --title "新的标题" \
  --content "新的正文" \
  --json
```

JSON：

```json
{
  "title": "新的标题",
  "content": "新的正文"
}
```

将字段清空为 null 时使用 `--input`：

```sh
sharge notes update 123 \
  --input '{"title":null}' \
  --json
```

生成模板：

```sh
sharge notes update 123 --generate-input
```

模板是原始 JSON，不包 envelope：

```json
{
  "title": "",
  "content": ""
}
```

dry run：

```sh
sharge notes update 123 \
  --input @update.json \
  --dry-run \
  --json
```

成功 `data` 是更新后的完整 Note。

副作用可能包含既有业务关联更新。发生 timeout/network unknown outcome 时先 `notes get`，不要盲目重发。

## `sharge notes delete`

```text
sharge notes delete <note-id> [--yes] [--dry-run]
```

Scope：`quick_notes:write`

真实删除：

```sh
sharge notes delete 123 --yes --json
```

dry run 不要求 `--yes`：

```sh
sharge notes delete 123 --dry-run --json
```

删除沿用现有业务级联语义，可能清理关联 Calendar 项。不可恢复，重复执行不安全。

成功时 `data` 为 `null`。

## `sharge notes download`

```text
sharge notes download <note-id> --media <audio|image|video>
  [--file <path>] [--overwrite] [--dry-run]
```

Scope：`quick_notes:read`

默认保存当前目录：

```sh
sharge notes download 123 --media image --json
```

明确路径：

```sh
sharge notes download 123 \
  --media audio \
  --file ./note-123.m4a \
  --json
```

只有 `available_media_types` 中存在的类型才能下载。

成功返回 CLI 下载结果：

```json
{
  "filePath": "/absolute/path/note-123.m4a",
  "bytes": 123456,
  "mediaType": "audio/mp4",
  "sha256": "..."
}
```

详见[下载](../downloads.md)。

## 不存在的命令

```text
sharge notes create
```

Open API 明确禁止创建 Quick Note。CLI 不提供 alias 或兼容实现。
