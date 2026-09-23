---
title: JSON contract
description: JSON envelopes, machine-readable help, structured input templates, and jq behavior.
---

# JSON contract

## Enable JSON

All commands default to text. Machine callers must request JSON explicitly:

```sh
sharge notes list --json
```

There is no `--output json`, default NDJSON mode, or automatic TTY-based switching.

## Success envelope

```json
{
  "schemaVersion": "1",
  "ok": true,
  "command": "notes.list",
  "data": { "items": [], "has_more": false, "next_cursor": null },
  "warnings": [],
  "meta": {
    "runId": "run_...",
    "requestId": "req_...",
    "timezone": "America/Los_Angeles",
    "clientDate": "2026-07-30T18:00:00-07:00"
  }
}
```

`schemaVersion` is a string, `ok` is the success signal, `command` is canonical, `warnings` is always an array, and `meta.runId` is always present. `requestId` is `null` when no network request occurred. Successful envelopes have no `error`.

## Error envelope

```json
{
  "schemaVersion": "1",
  "ok": false,
  "command": "calendar.create",
  "data": null,
  "warnings": [],
  "error": {
    "type": "INVALID_INPUT",
    "message": "start_time 必须包含显式时区。",
    "retryable": false,
    "field": "start_time",
    "path": "$.start_time",
    "nextActions": [{ "description": "使用带 offset 的 RFC 3339 时间", "command": "sharge calendar create --generate-input" }]
  },
  "meta": { "runId": "run_...", "requestId": null, "httpStatus": null }
}
```

Failures write one complete envelope to stdout, exit nonzero, and set `data` to `null`. stderr is used only for debug or login status events. Messages remain Chinese in the current CLI; agents should use `type`, `field`, `path`, `requiredScopes`, `retryable`, `outcome`, and the exit code for logic.

## Field naming

```text
CLI envelope, help, and errors: camelCase
Open API business data: original field names, usually snake_case
--input: original OpenAPI names
flags: kebab-case
```

For example, `--start-time` maps to `start_time`. The CLI does not recursively rename business objects, so opaque dictionary keys and future fields remain intact. CLI-created download results use fields such as `filePath`, `bytes`, `mediaType`, and `sha256`.

## JSON help

```sh
sharge calendar create --help --json
```

Help uses a normal success envelope. Its `data` includes the command description, required scopes, arguments, options, input and output schemas, network use, side effects, `destructive`, `dryRun`, `retrySafe`, pagination, errors, and examples. Root help lists all commands; namespace and command help narrow that scope. JSON help works offline without login.

## Structured input

Write commands accept inline JSON, a file, or stdin with the same schema:

```sh
sharge notes update 123 --input '{"title":"Title"}' --json
sharge notes update 123 --input @update.json --json
sharge notes update 123 --input - --json
```

Business flags and `--input` are mutually exclusive. Control flags such as `--dry-run`, `--timeout 30s`, and `--json` can accompany `--input`. Unknown fields fail locally before a request.

## Input templates

```sh
sharge calendar create --generate-input > event.json
```

The template is raw JSON suitable for `--input @event.json`, without an envelope. Generation does not log in or use the network and cannot be combined with `--json`, `--jq`, business flags, or `--input`.

## Dry-run JSON

```sh
sharge notes update 123 --input '{"title":"New title"}' --dry-run --json
```

The plan includes HTTP method, resolved base URL and path, redacted body, required scopes, side effects, retry safety, and remote conditions marked `unverified`. It does not verify credentials or remote resources. Text mode shows the same plan fields. For a delete, `body` is `null`. URLs contain no credentials; schema-marked secrets are redacted, while ordinary business fields remain visible for review.

## `--jq`

```sh
sharge notes list --json --jq '.data.items[] | {id, title}'
sharge notes list --json --jq '.data.next_cursor'
```

`--jq` requires `--json` and filters the complete success envelope. Successful stdout then uses the jq result rather than an envelope; errors still return a full error envelope. The expression is validated before network access, and no system `jq` installation is required.

## stdout and stderr

```text
Business result or final envelope -> stdout
Text errors                      -> stderr
Debug and login status events    -> stderr
Persistent logs                  -> ~/.sharge/sharge.log
Downloaded binary                -> file
```

stdout never mixes progress, warning text, debug messages, logs, or binary data into results.

## Schema version

`schemaVersion: "1"` covers the CLI envelope only. The CLI version and fixed OpenAPI contract determine business data schemas. Breaking envelope changes require a version bump; adding optional fields does not.
