---
title: Recordings commands
description: List, search, read rich details, and download audio from Recordings.
---

# Recordings commands

The v1 `recordings` namespace is read-only: list, search, rich details, and audio download. It does not upload, submit transcripts, modify, delete, retry, or regenerate summaries. All commands require `voicemaster:read`.

## List item

Items preserve fields such as `recording_id` (integer resource ID), nullable `voice_id`, `recording_type` (`ordinary`, `call`, `app_related`), `title`, `summary`, `timestamp`, `duration_minutes`, `location`, `status_code`, `has_summary`, `audio_download_path`, `created_at`, and `updated_at`.

## `sharge recordings list`

```text
sharge recordings list
  [--cursor <id>] [--page-size <1..50>]
  [--direction <forward|backward>]
  [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>]
  [--recording-type <ordinary|call|app_related>]
  [--sort-by <created_at|updated_at|timestamp|id>]
  [--sort-order <asc|desc>] [--timezone <iana>]
```

Defaults are page size `20`, direction `forward`, sort field `timestamp`, and order `desc`. Start date cannot follow end date; dates use the resolved timezone.

```sh
sharge recordings list --page-size 20 \
  --start-date 2026-07-01 --end-date 2026-07-31 \
  --recording-type ordinary --sort-by timestamp --sort-order desc \
  --timezone America/Los_Angeles --json
```

`data` has `items`, `next_cursor`, `prev_cursor`, and `has_more`. One call reads one page. Use `next_cursor` for forward continuation or `prev_cursor` for backward continuation, passing cursors unchanged. Repeating the read is safe.

## `sharge recordings search`

```text
sharge recordings search <keyword> [--limit <1..50>]
  [--recording-type <ordinary|call|app_related>]
  [--language <language>] [--summary-template-id <id>]
```

`limit` defaults to `20`. Search results add `language`, `summary_template_id`, `matched_fields` (`title` and/or `summary`), and `matched_texts` to list fields. `data` is an array, without a cursor. Type, language, and template ID are exact filters; the CLI discards backend fallback items that do not match them. Repeating the search is safe.

```sh
sharge recordings search "project review" --limit 20 --language en --json
```

## `sharge recordings get`

```sh
sharge recordings get 456 --json
```

Rich details include list fields, nullable `evaluate_time`, a `transcript` with text and timed speaker segments, `overviews` grouped in a dynamic language dictionary, `speaker_map`, and `highlights`. Each overview may include title, abstract, duration, summaries, keywords, mind map, chapters, and `has_calendar`. Highlight media types include `audio`, `image`, `video`, `quick_note`, and `ai_note`. Dynamic dictionary keys are preserved. Details may be large; use `--json --jq` to select the needed fields. Repeating the read is safe.

## `sharge recordings download`

```text
sharge recordings download <recording-id>
  [--file <path>] [--overwrite] [--dry-run]
```

Without `--file`, the download goes to the current directory. JSON returns the final `filePath`, byte count, media type, and SHA-256.

```sh
sharge recordings download 456 --json
sharge recordings download 456 --file ./meeting.m4a --json
```

The download may follow a short-lived redirect, but never forwards the API key across origins. See [Downloads](../downloads.en.md).

## Unsupported commands

There are no `recordings create`, `update`, `delete`, `retry`, or `transcribe` commands.
