---
title: Command reference
description: Public sharge CLI commands, global options, and behavior.
---

# Command reference

Running `sharge` prints root text help and exits with code `0`. `sharge --help --json` returns the full machine-readable command catalog. Unknown commands return `INVALID_COMMAND` with exit code `2`.

## Global options

| Option | Behavior |
| --- | --- |
| `--help` | Offline text help; does not log in or access the network |
| `--json` | Stable JSON envelope |
| `--jq <expression>` | Filters a complete success envelope; requires `--json` |
| `--debug` | Writes local diagnostics to stderr |
| `--timeout <duration>` | Total timeout with an `s` or `m` suffix |
| `--timezone <iana>` | IANA timezone for this invocation |

Write commands also expose options as needed:

| Option | Behavior |
| --- | --- |
| `--input <json|@file|->` | OpenAPI JSON request body |
| `--generate-input` | Offline editable JSON template |
| `--dry-run` | Zero-network execution plan |
| `--yes` | Confirms a destructive operation |

Download commands may offer `--file <path>`, `--overwrite`, and `--dry-run`. There is no global `--api-key`, `--base-url`, `--retry`, or automatic all-pages option.

## Root commands

- [System, authentication, configuration, and logs](./system.en.md): `login`, `logout`, `version`, `doctor`, `auth status|scopes`, `config show|set|unset`, and `logs path|clear`.

## Product commands

- [AI Live Photo (`notes`)](./notes.en.md): `list`, `search`, `get`, `update`, `delete`, `download`.
- [Calendar](./calendar.en.md): `month`, `list`, `search`, `get`, `create`, `update`, `delete`, `todos set-status`.
- [Recordings](./recordings.en.md): `list`, `search`, `get`, `download`.
- [AI Diary](./diary.en.md): `list`, `search`, `get`.

## Scopes

| Namespace | Read | Write |
| --- | --- | --- |
| `notes` | `quick_notes:read` | `quick_notes:write` |
| `calendar` | `calendar:read` | `calendar:write` |
| `recordings` | `voicemaster:read` | Not supported |
| `diary` | `ai_daily:read` | Not supported |

## Network and repeat execution

Use each command's `--help --json` for its exact arguments, schemas, scopes, side effects, retry safety, and error types. Business commands do not log in, retry, or fetch extra pages implicitly. Writes send one request, so after a network failure or timeout check the resource before another write.
