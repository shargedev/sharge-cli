---
title: Quick start
description: Install sharge CLI and Agent Skills, log in, and read your first data.
---

# Quick start

## 1. Install

You need Node.js 20 or newer and npm. Install the CLI from npm:

```sh
npm install --global @sharge/cli@latest
```

If an AI agent will use sharge, install the five Skills from this repository for your user:

```sh
npx skills add shargedev/sharge-cli -y -g
```

For overseas use, select the Open Platform before logging in:

```sh
sharge config set base-url https://app.loomos.ai/
sharge config show
sharge login
```

Check that the command is available:

```sh
sharge version
sharge --help
```

When helping with installation, an agent should install the CLI and Skills, set the base URL, then run `sharge login --no-browser`. It should give the complete authorization URL to the person and let them confirm the browser page.

## 2. Log in

```sh
sharge login
```

The CLI attempts to open a browser and prints the complete authorization URL and a visual verification code. It waits quietly for authorization; it does not repeatedly print waiting messages.

If a browser cannot open automatically:

```sh
sharge login --no-browser
```

Open the complete URL from the CLI in any browser. Use the code only to confirm that the browser page matches this CLI session; do not type it back into the terminal.

Verify the login:

```sh
sharge auth status
sharge auth status --json
```

## 3. Read data

```sh
# Read one page of AI Live Photo items
sharge notes list --limit 20 --json

# Read a Calendar time range
sharge calendar list \
  --start 2026-07-30T00:00:00+08:00 \
  --end 2026-07-31T00:00:00+08:00 \
  --json

# Search Recordings
sharge recordings search "project review" --limit 10 --json

# Read AI Diary entries for a month
sharge diary list 2026-07 --json
```

## 4. Let the agent discover commands

Do not guess arguments. Start at the root help, then narrow down:

```sh
sharge --help --json
sharge calendar --help --json
sharge calendar create --help --json
```

Generate an input template offline and preview a write before execution:

```sh
sharge calendar create --generate-input > calendar-create.json
sharge calendar create --input @calendar-create.json --dry-run --json
sharge calendar create --input @calendar-create.json --json
```

Run the final command only after the plan is confirmed.

## 5. Read the next page

List commands do not automatically fetch all data. When a response has `has_more: true`, use its `next_cursor` explicitly:

```sh
sharge notes list --cursor 123 --limit 20 --json
```

A cursor is opaque. Do not calculate, modify, or guess the next one.

## 6. Switch environments

The CLI's built-in default is the China production origin, `https://ai.shargetech.com`. For overseas use:

```sh
sharge config set base-url https://app.loomos.ai/
sharge config show
sharge login
```

The CLI normalizes the trailing slash, so `config show` displays `https://app.loomos.ai`. API keys are tied to a base URL. Switching may restore one cached credential; log in if no credential is available for the selected URL.

## 7. Handle errors

Text errors go to stderr with a suggested next action. Agents should request JSON and inspect `error.type`, `error.retryable`, `error.outcome`, `error.requiredScopes`, `error.nextActions`, `meta.requestId`, and the process exit code.

```sh
sharge notes list --json
```

The CLI does not retry automatically. Decide whether to retry only after checking the operation's safety and the error fields.

## Next steps

- [Agent guide](./agent-guide.en.md)
- [Authentication](./authentication.en.md)
- [Command reference](./commands/README.en.md)
