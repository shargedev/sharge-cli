---
title: AI Live Photo commands
description: List, search, read, update, delete, and download media from AI Live Photo items.
---

# AI Live Photo commands

The `notes` namespace accesses AI Live Photo items. The Open API supports reading, searching, updating titles/content, deleting, and downloading media. It does not support creation.

## Data fields

Business objects keep their original OpenAPI names:

| Field | Meaning |
| --- | --- |
| `id` | Integer ID, or decimal string beyond JavaScript's safe integer range |
| `title` / `content` | Nullable text |
| `status` | `pending`, `processing`, `success`, or `failed` |
| `location`, `longitude`, `latitude` | Nullable location and coordinates |
| `has_calendar_events` | Whether Calendar items are linked |
| `available_media_types` | Available `audio`, `image`, or `video` |
| `media_downloads` | Media type to download path |
| `matched_fields`, `matched_title`, `matched_content` | Search matches |
| `created_at`, `updated_at` | RFC 3339 timestamps |

## `sharge notes list`

```text
sharge notes list [--cursor <id>] [--limit <1..100>]
                  [--created-at-start <rfc3339>]
                  [--created-at-end <rfc3339>]
```

Requires `quick_notes:read`. `--cursor` defaults to `0`; `--limit` defaults to `20`. Both timestamps need offsets, and the start cannot be after the end.

```sh
sharge notes list --limit 20 \
  --created-at-start 2026-07-01T00:00:00+08:00 \
  --created-at-end 2026-08-01T00:00:00+08:00 --json
```

`data` contains `items`, `has_more`, and `next_cursor`. Safe-range IDs/cursors are integers; larger values are lossless decimal strings. Treat cursors as opaque and pass them back unchanged. One call reads one page. Repeating the read is safe.

## `sharge notes search`

```text
sharge notes search <query> [--cursor <id>] [--limit <1..100>]
                    [--created-at-start <rfc3339>]
                    [--created-at-end <rfc3339>]
```

Requires `quick_notes:read`. Searches title and content. It uses the same pagination as `list`, and matching items may include `matched_fields`, `matched_title`, and `matched_content`.

```sh
sharge notes search "launch plan" --limit 20 --json
```

## `sharge notes get`

```sh
sharge notes get 123 --json
```

Requires `quick_notes:read`. `data` is one complete item. Repeating the read is safe.

## `sharge notes update`

```text
sharge notes update <note-id>
  [--title <title>] [--content <content>]
  [--input <json|@file|->]
  [--generate-input] [--dry-run]
```

Requires `quick_notes:write`. Provide at least one of `title` or `content`. Do not mix business flags with `--input`.

```sh
sharge notes update 123 --title "New title" --content "New content" --json
sharge notes update 123 --input '{"title":null}' --json
sharge notes update 123 --generate-input
sharge notes update 123 --input @update.json --dry-run --json
```

Use `--input` to clear a field to `null`. A successful write returns the complete updated item. Related business objects may also change. After a timeout or network error with unknown outcome, read the item before another write.

## `sharge notes delete`

```text
sharge notes delete <note-id> [--yes] [--dry-run]
```

Requires `quick_notes:write`. Real deletion requires `--yes`; dry run does not. Deletion may remove related Calendar items, cannot be undone, and is unsafe to repeat. Successful `data` is `null`.

```sh
sharge notes delete 123 --dry-run --json
sharge notes delete 123 --yes --json
```

## `sharge notes download`

```text
sharge notes download <note-id> --media <audio|image|video>
  [--file <path>] [--overwrite] [--dry-run]
```

Requires `quick_notes:read`. Only media listed in `available_media_types` can be downloaded. Without `--file`, the CLI saves into the current directory. The JSON result includes `filePath`, `bytes`, `mediaType`, and `sha256`.

```sh
sharge notes download 123 --media image --json
sharge notes download 123 --media audio --file ./note-123.m4a --json
```

See [Downloads](../downloads.en.md) for path and overwrite rules.

## Unsupported command

`sharge notes create` does not exist. The Open API explicitly does not permit creating AI Live Photo items.
