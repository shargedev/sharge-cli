---
title: Calendar commands
description: Read, search, create, update, delete, and set todo status in Calendar.
---

# Calendar commands

All datetimes need explicit offsets. v1 accepts structured time, not natural language. Reads never infer today, the current month, or a time range. `month` needs `YYYY-MM`; `list` needs both `--start` and `--end`; `search` searches titles only and has no time-range filter. `--timezone` must be an IANA name and controls the local boundary of month views and `X-Client-Date`.

`--source-type` defaults to `all` and accepts `all`, `manual`, `quick_note`, or `audio_recorded`. These are Open API values; the CLI does not rename them.

## Business objects

Calendar events keep their OpenAPI fields, including `id`, `title`, `type` (`event` or `todo`), nullable description/location, offset-aware `start_time` and `end_time`, `is_all_day`, `timezone`, `rrule`, `excluded_dates`, alarm fields, `source_type`, `source_id`, nullable `completed`, and creation/update times.

An instance has `instance_id`, `event_id`, original and actual start/end times, `trigger_start_time`, `is_cancelled`, and timestamps. IDs within JavaScript's safe integer range are JSON integers; larger decimal IDs are lossless strings. Do not convert IDs to floating-point numbers.

## `sharge calendar month`

```text
sharge calendar month <YYYY-MM>
  [--source-type <all|manual|quick_note|audio_recorded>]
  [--timezone <iana>]
```

Requires `calendar:read`. The CLI accepts years `1970..2100` and months `01..12`; invalid values fail before network access.

```sh
sharge calendar month 2026-07 --timezone America/Los_Angeles --source-type all --json
```

`data.dates` maps days to instances, `data.events` maps event IDs to parent objects, and `data.has_new_instances` signals changes. JSON preserves dynamic keys, snake_case fields, and newly added backend fields. Text summarizes events/todos; use JSON for full objects and instances. Repeating the read is safe.

## `sharge calendar list`

```text
sharge calendar list --start <rfc3339> --end <rfc3339>
  [--source-type <all|manual|quick_note|audio_recorded>]
  [--timezone <iana>]
```

Requires `calendar:read`. `end` must be after `start`, both need offsets, and the actual UTC interval cannot exceed 31 days. `--timezone` does not change the offsets in `--start` or `--end`. These checks happen before network access.

```sh
sharge calendar list \
  --start 2026-07-30T00:00:00-07:00 \
  --end 2026-08-01T00:00:00-07:00 \
  --source-type all --json
```

`data` contains `events` and `instances` arrays. JSON preserves Open API fields. Repeating the read is safe.

## `sharge calendar search`

```text
sharge calendar search <keyword>
  [--source-type <all|manual|quick_note|audio_recorded>]
  [--limit <1..100>]
```

Requires `calendar:read`; default limit is `30`. A trimmed keyword cannot be empty. The Open API searches titles of the current user's formal events/todos, excluding drafts. It does not accept `--start` or `--end` here.

```sh
sharge calendar search "review" --limit 20 --json
```

`data` is an array of events with `matched_title`. Repeating the search is safe.

## `sharge calendar get`

```sh
sharge calendar get 123 --json
```

Requires `calendar:read`. The ID must be a positive integer. This calls the details endpoint directly and returns a formal event or todo with original Open API fields. Drafts and items not owned by the current user return `NOT_FOUND`. Repeating the read is safe.

Read failures include `INVALID_INPUT` (exit `2`), `AUTH_REQUIRED` (`3`), `SCOPE_REQUIRED` (`4`), `NOT_FOUND` (`5`), `RATE_LIMITED` (`7`), network/timeout/server errors (`8`), and `CANCELLED` (`130`). Check the error's `nextActions`; the CLI does not expand a range or send a second query automatically.

## Create/update input fields

| JSON field | Flag | Rule |
| --- | --- | --- |
| `title` | `--title` | Required, 1–255 characters |
| `description` | `--description` | Nullable, default `null` |
| `location` | `--location` | Nullable, at most 255 characters; default `null` |
| `timezone` | `--event-timezone` | Nullable IANA name or UTC offset; default `null` |
| `type` | `--type` | `event` (default) or `todo` |
| `start_time` | `--start-time` | Required, with offset |
| `end_time` | `--end-time` | Nullable, with offset; default `null` |
| `is_all_day` | `--is-all-day` | Explicit `true`/`false`; default `false` |
| `rrule` | `--rrule` | Nullable RFC 5545 rule; default `null` |
| `enable_alarm` | `--enable-alarm` | Nullable explicit `true`/`false`; default `null` |
| `trigger_seconds` | `--trigger-seconds` | Default `0`, minimum `-864000` |
| `trigger_description` | `--trigger-description` | Nullable, at most 255 characters; default `null` |

Flags cannot express `null`; omitted optional flags receive the defaults above. Use `--input` when every nullable field needs review. Unknown fields and datetimes without offsets fail locally. The CLI checks that an RRULE has a supported `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`; the server validates further combinations. `--event-timezone` is an event field, while global `--timezone` controls this invocation's date semantics.

## `sharge calendar create`

```text
sharge calendar create <business flags...>
sharge calendar create --input <json|@file|->
```

Requires `calendar:write`. For a simple event:

```sh
sharge calendar create \
  --title "Project meeting" --type event \
  --start-time 2026-08-03T10:00:00-07:00 \
  --end-time 2026-08-03T11:00:00-07:00 \
  --event-timezone America/Los_Angeles --json
```

For a structured request, use the complete fields above:

```sh
sharge calendar create --generate-input > event.json
sharge calendar create --input @event.json --dry-run --json
sharge calendar create --input @event.json --json
```

Template generation is offline raw JSON, without a success envelope. `--input`, business flags, and `--generate-input` are mutually exclusive. A dry run shows the final POST URL, normalized body, scope, side effects, `retrySafe: false`, and unverified preconditions without a key or network request. Success returns the new event; created items have `source_type: "manual"`.

Creation has no server idempotency key. After a timeout or network error with unknown outcome, search by a unique title and, if needed, list the explicit time range before deciding whether to create again.

## `sharge calendar update`

```text
sharge calendar update <event-id> <complete business flags...>
sharge calendar update <event-id> --input <json|@file|->
```

Requires `calendar:write`. This is a **complete PUT**, not a partial patch. The request contains all create fields plus `action` (`all`, `instance`, or `future`; default `all`) and `instance_id` (default `null`, required for `instance`/`future`). For `all`, `instance_id` must be absent or null. It is an opaque server ID; pass it unchanged.

An `--input` request must include the complete create field set. When using flags, omitted optional fields reset to their documented defaults rather than retaining old server values. First run `calendar get`, build a full input object, dry run to inspect the final body, then PUT:

```sh
sharge calendar get 123 --json
sharge calendar update 123 --input @event-update.json --dry-run --json
sharge calendar update 123 --input @event-update.json --json
```

Success returns an action with `created_events`, `updated_events`, and `deleted_events`. The original `source_type` and `source_id` are retained; alarms and revisions may change. PUT has no server idempotency key. After an unknown outcome, search by the updated unique title; `action=all` may have replaced the old event ID. For `instance`/`future`, also list an explicit time range covering the target instance before another write.

## `sharge calendar delete`

```text
sharge calendar delete <event-id>
  [--type <all|current|future>]
  [--instance-id <id>] --yes
```

Requires `calendar:write`. `all` (default) deletes the event/series and takes no instance ID. `current` deletes one instance; `future` deletes it and later instances. Those two require an opaque server-provided instance ID.

```sh
sharge calendar delete 123 --type all --yes --json
sharge calendar delete 123 --type future --instance-id instance_... --dry-run --json
sharge calendar delete 123 --type future --instance-id instance_... --yes --json
```

Dry run needs neither `--yes` nor a key and makes no network request. Actual deletion always needs `--yes`; there is no interactive prompt. It is irreversible and unsafe to repeat. On an unknown outcome, get the series; for `current`/`future`, also list the original instance range before another write.

## `sharge calendar todos set-status`

```text
sharge calendar todos set-status
  --event-id <id>... --status <completed|uncompleted>
  [--input <json|@file|->]
```

Requires `calendar:write`. Repeat `--event-id` for a batch or pass `{"event_ids":[101,102],"status":"completed"}` to `--input`. IDs must be positive; duplicates are removed locally. The targets must be todos, and status must be `completed` or `uncompleted`.

```sh
sharge calendar todos set-status \
  --event-id 101 --event-id 102 --status completed --json
```

Dry run displays the actual backend request body. `--generate-input` produces an offline raw product JSON template and cannot be mixed with flags, `--input`, dry run, or JSON output. Success returns the backend result arrays. There is no server idempotency key; after an unknown outcome, get **every** todo in the batch and inspect its completed state before another write.
