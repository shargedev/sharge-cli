---
title: Agent guide
description: A recommended flow for agents to discover commands, build input, execute safely, and recover from errors.
---

# Agent guide

This guide helps an agent without repository context find the right command through an installed Skill or the CLI, then plan, execute, and recover with the fewest safe steps.

## 1. Short safe execution loop

### 1.1 Decide whether help is needed

The installed CLI's help is the authoritative machine contract for that version, but help is not a fixed prerequisite for every task.

| Task | Recommended path |
| --- | --- |
| Known stable read with explicit input | Run it directly with `--json` |
| Write, delete, download, structured input, or dry run | Read that command's `--help --json` once |
| Namespace unknown | Read root `sharge --help --json` |
| Installed Skill explicitly rules out a capability | Explain that it is unsupported and was not attempted |
| Namespace known but action unclear | Read namespace help |
| Argument error or possibly outdated Skill | Follow the error envelope and read the specific command help |

Do not mechanically run root, namespace, and command help in sequence. Each help call should answer a real unresolved question. For example, a clear search can run directly:

```sh
sharge notes search "launch plan" --json
```

Before updating an item, read the specific contract:

```sh
sharge notes update --help --json
```

Inspect the relevant arguments, options, required scopes, input schema, side effects, `destructive`, dry-run support, and retry safety.

### 1.2 Generate input

For a complex write, generate a template and do not mix business flags with `--input`:

```sh
sharge calendar create --generate-input > request.json
```

### 1.3 Preview locally

```sh
sharge calendar create --input @request.json --dry-run --json
```

A dry run does not log in, use the network, write files, or change remote state.

### 1.4 Execute

```sh
sharge calendar create --input @request.json --json
```

Use the exit code, `ok`, `error.type`, and structured fields to decide what happened. Do not parse Chinese `message` text for logic.

### 1.5 Recover

When an error contains `nextActions`, prefer their complete commands, after checking that they still fit the user's task.

## 2. Do not guess

Do not guess aliases, argument names, implicit dates, cursors, credential sources, scopes, write outcomes after timeouts, delete confirmation, or download filenames.

| Information | Source |
| --- | --- |
| Known stable read | Validated example in the relevant Skill |
| Complete command and argument contract | Appropriate `--help --json` |
| Write schema | `--help --json` or `--generate-input` |
| Current identity | `auth status --json` |
| Scope catalog | `auth scopes --json` |
| Active configuration | `config show --json` |
| Next page | Pagination fields in the current response |
| Download path | Successful `data.filePath` |
| Failure details | Error envelope, request ID, and local logs |

## 3. Output

Commands default to text. Agents should request JSON:

```sh
sharge notes list --json
sharge notes list --json --jq '.data.items[] | {id, title}'
```

`--jq` changes successful stdout; errors still return a complete error envelope.

## 4. Input

Use flags for a few scalar fields:

```sh
sharge notes update 123 --title "New title" --content "New content" --json
```

Use `--input` for nested, nullable, or reusable requests:

```sh
sharge calendar create --input @event.json --json
```

Only `--input -` reads stdin:

```sh
printf '%s\n' '{"title":"Update","content":null}' |
  sharge notes update 123 --input - --json
```

Commands without `--input -` do not wait for stdin.

## 5. Write safety

Consider a dry run for every write, especially Calendar create/update, recurring-instance edits, batch todo status, Notes update, and deletes. A dry run validates local input and produces a request plan. Remote resources, permissions, and conflicts remain `unverified`.

Actual deletion requires `--yes`:

```sh
sharge notes delete 123 --yes --json
```

Without `--yes`, the CLI fails locally without sending a request.

If a write times out or the network disconnects after sending, it may return `outcome: "unknown"` and `retryable: false`. Read the corresponding resource before deciding what to do. The backend has no general idempotency-key protocol.

## 6. No automatic retries

Each business command sends one business request. The CLI does not retry network errors, timeouts, `429`, or `5xx`. An agent may call again only when all conditions hold:

1. `retryable` is `true`.
2. Help says repeat execution is safe.
3. There is no unknown outcome, or a read has resolved it.
4. A retry still matches the user's intent.

Login polling and download redirects are protocol steps, not automatic business retries.

## 7. Pagination

Each list call reads one page:

```sh
sharge recordings list --page-size 20 --json
sharge recordings list --cursor 456 --direction forward --page-size 20 --json
```

Use `data.next_cursor`, `data.prev_cursor`, and `data.has_more` from the response. There is no universal `--all`; each product keeps its own query model.

## 8. Insufficient scope

Business commands do not open a browser. A `SCOPE_REQUIRED` error provides `requiredScopes` and a complete reauthorization command in `nextActions`. `login --scope` specifies the entire desired scope set, so keep existing scopes that are still needed.

## 9. Time

- Datetimes must be RFC 3339 with an offset.
- Months must be explicit `YYYY-MM` values.
- Diary identifiers must be explicit `YYYYMMDD` dates.
- v1 does not parse natural-language time.
- Do not transform cursors, identifiers, or local dates into UTC.

```sh
sharge calendar list \
  --start 2026-07-30T09:00:00+08:00 \
  --end 2026-07-30T18:00:00+08:00 \
  --timezone Asia/Shanghai \
  --json
```

## 10. Downloads

If `--file` is omitted, read the actual absolute path from `data.filePath`:

```sh
sharge recordings download 456 --json
```

Do not infer a filename from the resource ID. The server filename and a collision suffix can change it.

## 11. Logs and diagnostics

Use `runId` to correlate an invocation with local logs:

```sh
sharge logs path
sharge notes list --json --debug
```

stdout remains the final envelope; debug JSON Lines go to stderr. Logs exclude API keys and raw business request and response bodies.

## 12. Agent checklist

Before execution:

- [ ] Read JSON help only for a real uncertainty, risky operation, or capability discovery.
- [ ] Specify time, month, and pagination boundaries; do not preflight stable reads just to check scopes.
- [ ] Choose flags or `--input` for a write, without mixing them.
- [ ] Generate a template and dry run complex writes.
- [ ] Include `--yes` for deletion.

After execution:

- [ ] Check the process exit code and `ok`.
- [ ] Do not parse Chinese messages for logic.
- [ ] Use response cursors for continuation.
- [ ] Use returned `filePath` for downloads.
- [ ] Resolve unknown outcomes with a read before another write.
