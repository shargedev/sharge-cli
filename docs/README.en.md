---
title: Sharge CLI documentation
description: Public user documentation, guarantees, and command entry points for sharge CLI.
---

# Sharge CLI documentation

`sharge` is the official command-line client for Sharge Open Platform. It is designed for agents, while keeping login, configuration, and troubleshooting clear for people.

The CLI covers four product areas:

| Namespace | Product |
| --- | --- |
| `notes` | AI Live Photo |
| `calendar` | Calendar |
| `recordings` | Recordings |
| `diary` | AI Diary |

These names describe the products. Executable commands always use the namespaces in the table.

## Start here

- [Quick start](./getting-started.en.md): install, log in, and read your first data.
- [Agent guide](./agent-guide.en.md): discover commands, provide input, recover from errors, and execute safely.
- [Authentication](./authentication.en.md): browser login, API keys, scopes, and logout.
- [Configuration](./configuration.en.md): settings, environment variables, base URL, timezone, and logs.
- [JSON contract](./json-contract.en.md): envelopes, JSON help, `--input`, templates, and `--jq`.
- [Errors and exit codes](./errors.en.md): stable error types, recovery actions, and unknown outcomes.
- [Downloads](./downloads.en.md): file paths, collisions, overwrites, redirects, and checksums.
- [Command reference](./commands/README.en.md): commands, arguments, scopes, schemas, and examples.

## Shortest path

```sh
# 1. Discover commands
sharge --help

# 2. Select the overseas Open Platform before login
sharge config set base-url https://app.loomos.ai/

# 3. Log in
sharge login

# 4. Check identity
sharge auth status --json

# 5. Read one page of AI Live Photo items
sharge notes list --limit 20 --json
```

Agents should prefer machine-readable help:

```sh
sharge --help --json
sharge notes --help --json
sharge notes list --help --json
```

## Guarantees

- Text output defaults to Chinese. Structured output requires explicit `--json`.
- Text help, JSON help, input schemas, and input templates work offline.
- Business commands do not log in implicitly or retry requests automatically.
- List commands read one page per call.
- Only `--input -` reads stdin.
- Write commands support zero-network `--dry-run`.
- Delete commands require `--yes` and do not show an interactive confirmation.
- JSON success and error responses use stable envelopes.
- stdout does not mix results with logs, progress, or binary data.
- API keys cannot be passed as command-line arguments. Local logs are redacted and rotated.

## Command overview

```text
sharge
├── login
├── logout
├── version
├── doctor
├── auth status|scopes
├── config show|set|unset
├── logs path|clear
├── notes list|search|get|update|delete|download
├── calendar month|list|search|get|create|update|delete
├── calendar todos set-status
├── recordings list|search|get|download
└── diary list|search|get
```

The Open API does not support creating AI Live Photo items, so `sharge notes create` does not exist. The current `diary` commands expose daily entries only, not weekly or monthly reports.

## stdout and stderr

| Mode | stdout | stderr |
| --- | --- | --- |
| Plain-text success | Chinese business result | Empty |
| Plain-text failure | Empty | Chinese error and next action |
| `--json` success | One success envelope | Empty unless `--debug` is used |
| `--json` failure | One error envelope | Empty unless `--debug` is used |
| `login --json` | One final envelope | JSON Lines status events |
| Download | Path text or JSON envelope | Debug diagnostics |

## Example values

Replace placeholder IDs, dates, times, and months with values for your task. `lms-REDACTED` represents a redacted API key; never put a real key into a command or document.
