---
title: Todos commands
description: Read and manage independent todos.
---

# Todos commands

A todo is something to finish: a title, optional start time, and completion state. It has no end time, repetition or reminder. Use Calendar for scheduled time slots, repetition and reminders.

IDs are decimal strings in flags and JSON, in the range 1..18446744073709551615. Never convert IDs to Number. Unsafe JSON numbers are rejected; write IDs as strings. Reads require `calendar:read`; writes require `calendar:write`.

## `sharge todos list`

```sh
sharge todos list --status unfinished --limit 20 --json
sharge todos list --status all --cursor 'opaque-cursor' --json
```

Reads exactly one page. Status is unfinished (default), completed or all. Limit is 1–100 (default 20). The first page omits cursor. Response: `{ items, next_cursor, has_more }`. Continue only with the exact returned cursor; no automatic pagination. No title or date filters.

## `sharge todos get`

```sh
sharge todos get 123 --json
```

Reads one todo. Missing or other users' IDs return `NOT_FOUND`. A todo contains `id`, `title`, nullable `start_time`, `timezone`, `completed`, `source_type`, `created_at`, and `updated_at`.

## `sharge todos create`

```sh
sharge todos create --title 'Prepare review' --json
sharge todos create --input '{"title":"Prepare review","start_time":"2026-11-12T10:00:00+08:00","timezone":"Asia/Shanghai"}' --dry-run --json
sharge todos create --generate-input
```

Title must contain 1–255 characters after trimming. Start time is optional and must carry an explicit RFC 3339 offset. Timezone accepts IANA or UTC offset. Omit start time when the user gives none. Success requires HTTP 201 and a complete todo receipt.

## `sharge todos update`

```sh
sharge todos update 123 --title 'Review today' --json
sharge todos update 123 --clear-start-time --json
sharge todos update 123 --input '{"start_time":null}' --dry-run --json
sharge todos update 123 --generate-input
```

Partial PATCH: supply at least title or start_time. `--start-time` and `--clear-start-time` are mutually exclusive. JSON null clears start_time. Omitted fields remain unchanged.

## `sharge todos complete`

```sh
sharge todos complete --todo-id 123 --todo-id 456 --completed true --json
sharge todos complete --input '{"ids":["123","456"],"completed":false}' --dry-run --json
sharge todos complete --generate-input
```

Accepts 1–100 IDs; duplicates are removed in input order. Completed must be true or false. Body IDs are encoded as exact JSON integers. Response `{ "changed_count": 0 }` is success: the count is the number actually changed, not the number requested. Already matching, missing and other users' todos are skipped.

## `sharge todos delete`

```sh
sharge todos delete --todo-id 123 --todo-id 456 --yes --json
sharge todos delete --input '{"ids":["123","456"]}' --dry-run --json
sharge todos delete --generate-input
```

Accepts 1–100 IDs with stable deduplication. Real irreversible deletion requires `--yes`. Success reports actual `changed_count`, including zero.

All writes accept `--input` inline, `@file` or `-` (explicit stdin), mutually exclusive with business flags. `--generate-input` is offline and used alone. `--dry-run` makes zero network requests, requires no credentials and shows the planned request. Writes are not retry-safe and never retry automatically. On an unknown outcome, create recovery uses `sharge todos list --json`; update, complete and delete use `sharge todos get <id> --json` for each affected ID. Verify the remote result before deciding what to do next.
