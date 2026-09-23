---
title: Errors and exit codes
description: Stable error types, exit codes, recovery actions, and unknown outcomes.
---

# Errors and exit codes

## Read errors

In text mode, stdout is empty and stderr contains a Chinese error with a precise next step. In JSON mode, stdout contains one error envelope; stderr is reserved for debug or login status events. The process exits nonzero. Agents must check both the exit code and `ok`.

## Stable error fields

| Field | Meaning |
| --- | --- |
| `type` | Stable machine-readable error type |
| `message` | Chinese human-readable text; do not parse for logic |
| `retryable` | Whether an agent may consider retrying |
| `outcome` | Whether a write might have executed |
| `field` / `path` | Argument name or JSON path |
| `requiredScopes` | Missing scopes |
| `nextActions` | Copyable recovery commands |
| `httpStatus` | HTTP status |
| `requestId` | Server request correlation ID |

Check that a suggested `nextActions.command` still matches the user's intent before executing it.

## Exit codes

| Code | Meaning | Common types |
| --- | --- | --- |
| `0` | Success | — |
| `1` | Local file or internal CLI error | `FILE_IO_ERROR`, `INTERNAL_ERROR` |
| `2` | Command or input error | `INVALID_COMMAND`, `INVALID_INPUT`, `FILE_EXISTS` |
| `3` | Not logged in or invalid credential | `AUTH_REQUIRED`, `CREDENTIAL_INVALID`, `AUTHORIZATION_*` |
| `4` | Insufficient scope or permission | `SCOPE_REQUIRED`, `PERMISSION_DENIED` |
| `5` | Resource not found | `NOT_FOUND` |
| `6` | Conflict | `CONFLICT` |
| `7` | Rate limit | `RATE_LIMITED` |
| `8` | Temporary failure | `NETWORK_ERROR`, `TIMEOUT`, `SERVER_ERROR` |
| `130` | User cancellation | `CANCELLED` |

An HTTP status is not used directly as the process exit code.

## Common errors

- `INVALID_COMMAND`: Unknown command or unsupported option. Fails locally. Read the relevant `--help --json`; the CLI does not guess aliases.
- `INVALID_INPUT`: Bad type/enum, missing required field, mixed flags and `--input`, unknown JSON field, datetime without offset, invalid timezone, dry run on a read, or delete without `--yes`. Check `field`, `path`, and the suggested fix.
- `AUTH_REQUIRED`: No settings or environment key. Run `sharge login`; business commands do not open the browser.
- `CREDENTIAL_INVALID`: Selected key is invalid or expired. Settings do not fall back to an environment key; run `sharge login --force`.
- `AUTHORIZATION_DENIED`, `AUTHORIZATION_EXPIRED`, `AUTHORIZATION_CONSUMED`, `AUTHORIZATION_SUPERSEDED`: The login session stops. Start a new one with `sharge login --force` if needed.
- `SCOPE_REQUIRED`: Valid credential lacks a required scope. Read `requiredScopes` and the complete `nextActions.command`.
- `NOT_FOUND`: Resource does not exist or is not owned by the current user; the server does not distinguish these publicly.
- `CONFLICT`: Current resource state conflicts with the request. Read it before deciding the next step.
- `RATE_LIMITED`: Server returned `429`; the CLI does not automatically retry. Check any retry-after information.
- `NETWORK_ERROR`: Request did not complete reliably. Reads may be retried after checking; writes need `outcome` inspection.
- `TIMEOUT`: Total timeout reached. Ordinary requests default to `30s`, downloads to `10m`; login is bounded by authorization expiry.
- `SERVER_ERROR`: Server returned `5xx`; the CLI does not automatically retry.
- `FILE_EXISTS`: Explicit download path exists. Choose a different path or use `--overwrite` intentionally.
- `FILE_IO_ERROR`: Local write or atomic publication failed. Check disk space, permissions, and destination before trying another path.

## Unknown outcome

If a write is sent and a network error or timeout follows, its error may have `retryable: false` and `outcome: "unknown"`. Do not resend immediately:

1. Read the corresponding resource.
2. If the write happened, continue from its actual state.
3. If you confirm it did not happen, decide whether another submission fits the task.

For example, after a timed-out Calendar create, search the explicit time range and title to check for the item.

## No automatic retries

The CLI never retries network errors, timeouts, `429`, or `5xx` business requests. `retryable` is information for the agent. Retry a write only after confirming the first attempt did not execute or when command help explicitly declares repeat execution safe.

## Local logs

Each envelope's `meta.runId` maps to a local log entry. Find the log with `sharge logs path`. When asking for support, share the run ID, request ID, CLI version, error type, and a redacted excerpt. Do not share keys, full settings, or business data.
