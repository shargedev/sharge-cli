# Recordings 命令

Recordings 对应录音、Voice Recording、闪极录音和 Loomos Recording。

v1 全部只读：列表、搜索、富详情和音频下载。不支持上传、转录提交、修改、删除、重试或重新总结。

Scope：所有命令都要求 `voicemaster:read`。

## 列表对象

| 字段 | 类型/说明 |
| --- | --- |
| `recording_id` | integer，规范资源 ID |
| `voice_id` | string/null，普通业务字段 |
| `recording_type` | `ordinary\|call\|app_related` |
| `title` | string/null |
| `summary` | string/null |
| `timestamp` | integer |
| `duration_minutes` | number/null |
| `location` | string/null |
| `status_code` | integer/null |
| `has_summary` | boolean |
| `audio_download_path` | string/null |
| `created_at` / `updated_at` | datetime |

## `sharge recordings list`

```text
sharge recordings list
  [--cursor <id>]
  [--page-size <1..50>]
  [--direction <forward|backward>]
  [--start-date <YYYY-MM-DD>]
  [--end-date <YYYY-MM-DD>]
  [--recording-type <ordinary|call|app_related>]
  [--sort-by <created_at|updated_at|timestamp|id>]
  [--sort-order <asc|desc>]
  [--timezone <iana>]
```

Defaults：

| Option | 默认 |
| --- | --- |
| `page-size` | `20` |
| `direction` | `forward` |
| `sort-by` | `timestamp` |
| `sort-order` | `desc` |

`start-date` 不能晚于 `end-date`。日期按 resolved timezone 解释。

```sh
sharge recordings list \
  --page-size 20 \
  --start-date 2026-07-01 \
  --end-date 2026-07-31 \
  --recording-type ordinary \
  --sort-by timestamp \
  --sort-order desc \
  --timezone Asia/Shanghai \
  --json
```

`data`：

```json
{
  "items": [],
  "next_cursor": 456,
  "prev_cursor": null,
  "has_more": true
}
```

一次只读取一页。cursor 原样使用：

- `direction=forward` 续页使用 `next_cursor`；
- `direction=backward` 续页使用 `prev_cursor`；
- 文本输出的“下一页”命令会保留原日期、类型、排序、方向和 timezone。

```sh
sharge recordings list \
  --cursor 456 \
  --direction forward \
  --page-size 20 \
  --json
```

重复执行安全。

## `sharge recordings search`

```text
sharge recordings search <keyword>
  [--limit <1..50>]
  [--recording-type <ordinary|call|app_related>]
  [--language <language>]
  [--summary-template-id <id>]
```

默认 `limit=20`。

```sh
sharge recordings search "项目复盘" \
  --limit 20 \
  --language zh \
  --json
```

结果对象在列表字段外增加：

| 字段 | 说明 |
| --- | --- |
| `language` | 命中内容语言 |
| `summary_template_id` | 对应总结模板 |
| `matched_fields` | `title` 和/或 `summary` |
| `matched_texts` | 命中字段到文本的映射 |

`data` 是数组，不使用 cursor。重复执行安全。

`--recording-type`、`--language` 和 `--summary-template-id` 都是精确筛选条件。
如果后端为了兼容旧数据而返回不同筛选值的回退条目，CLI 会丢弃该条目。

## `sharge recordings get`

```text
sharge recordings get <recording-id>
```

```sh
sharge recordings get 456 --json
```

返回富详情，包含列表字段和：

- `evaluate_time`：评估时间戳或 `null`；

### Transcript

```json
{
  "transcript": {
    "recording_id": 456,
    "status_code": 0,
    "text": "完整转写文本",
    "segments": [
      {
        "start_time": 0.0,
        "end_time": 2.5,
        "speaker": "speaker_1",
        "text": "分段文本"
      }
    ]
  }
}
```

### Overviews

`overviews` 是按语言组织的动态字典。每个 overview 包含：

- `title`；
- `abstract`；
- `duration_seconds`；
- `summaries` 动态字典；
- `keywords`；
- `mind_map`；
- `chapters`；
- `has_calendar`。

CLI 不转换动态字典键。

### Speakers 与 highlights

`speaker_map` 是 speaker ID 到 `{speaker_id, name}` 的映射。

`highlights` 包含：

- `at_ms`；
- `duration_ms`；
- `text`；
- `media_type`：`audio|image|video|quick_note|ai_note`。

重复执行安全。详情可能很大，Agent 应使用 `--json --jq` 选择需要内容。

## `sharge recordings download`

```text
sharge recordings download <recording-id>
  [--file <path>] [--overwrite] [--dry-run]
```

默认当前目录：

```sh
sharge recordings download 456 --json
```

明确路径：

```sh
sharge recordings download 456 \
  --file ./meeting.m4a \
  --json
```

成功：

```json
{
  "filePath": "/absolute/path/meeting.m4a",
  "bytes": 1048576,
  "mediaType": "audio/mp4",
  "sha256": "..."
}
```

下载可能跟随可信短期 redirect；跨 origin 不转发 API Key。详见[下载](../downloads.md)。

## 不支持

不存在：

```text
sharge recordings create
sharge recordings update
sharge recordings delete
sharge recordings retry
sharge recordings transcribe
```
