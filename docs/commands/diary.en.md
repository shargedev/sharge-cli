---
title: AI Diary commands
description: Read by month, search, and inspect AI Diary entries.
---

# AI Diary commands

The `diary` namespace exposes daily entries only. It uses `report_type=daily` and has no weekly/monthly option, generation, retry, settings, or HTML output. All commands require `ai_daily:read`.

## `sharge diary list`

```text
sharge diary list <YYYY-MM>
```

```sh
sharge diary list 2026-07 --json
```

`data` is an array of entries with `identifier` (`YYYYMMDD`), nonnegative `duration_seconds`, `extra.city`, `extra.keywords`, `extra.recording_count`, `title`, nullable `description`, nullable cover thumbnail and large URLs, `generated_at`, and `updated_at`. Specify a real month; the CLI does not assume the current one. Repeating the read is safe.

## `sharge diary search`

```text
sharge diary search <keyword> [--limit <1..100>]
```

`limit` defaults to `20`; keywords must be 1–200 characters. Search results add `matched_fields` (`title` and/or `body`), `matched_title`, and `matched_body_excerpt`. `data` is an array. Repeating the search is safe.

```sh
sharge diary search "San Francisco" --limit 20 --json
```

## `sharge diary get`

```text
sharge diary get <YYYYMMDD>
```

```sh
sharge diary get 20260730 --json
```

The identifier must be a real date; `20260230` fails locally. Details include fixed `report_type: "daily"`, identifier, status (`waiting`, `queued`, `processing`, `success`, `failed`, `cancelled`), timezone, period start/end, title, description, summary, duration, Markdown body, word count, and generation/update times. Details can exist before a body does, in which case `markdown` and `word_count` are `null`. Repeating the read is safe.

## Unsupported commands and fields

There are no weekly/monthly `get`, `generate`, `retry`, or `settings` commands. Results do not expose HTML, OSS keys, templates, rendering details, internal metadata, or retry information.
