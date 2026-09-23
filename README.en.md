# sharge CLI

[简体中文](./README.md) | English

[![npm version](https://img.shields.io/npm/v/@sharge/cli.svg)](https://www.npmjs.com/package/@sharge/cli)
[![CI](https://github.com/shargedev/sharge-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/shargedev/sharge-cli/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

The official command-line client for Sharge Open Platform. It is designed for AI agents and provides a clear login, configuration, and troubleshooting experience for people.

It covers AI Live Photo, Calendar, Recordings, and AI Diary, with machine-readable help, a stable JSON contract, explicit dry runs, safe downloads, and actionable errors.

[Website](https://shargedev.github.io/sharge-cli/en/) · [Documentation](https://shargedev.github.io/sharge-cli/en/docs/) · [Quick start](#install-and-quick-start) · [Agent quick start](#agent-quick-start) · [Capabilities](#capabilities) · [Commands](#command-overview) · [Safety](#safety-and-risks) · [Repository documentation](./docs/README.en.md)

## Why use sharge

- **Agent-first:** Every command level offers `--help --json` with arguments, schemas, scopes, side effects, errors, and examples.
- **Predictable output:** Text output defaults to Chinese. A stable `schemaVersion: "1"` JSON envelope requires explicit `--json`.
- **Controlled execution:** Business commands do not log in, retry, or paginate implicitly. Destructive operations require `--yes`.
- **Previewable writes:** Write commands support zero-network `--dry-run`; you can generate a JSON input template offline before sending a complex request.
- **Safe downloads:** Media is written only to local files, with safe naming, collision handling, atomic replacement, and SHA-256 verification.
- **Actionable errors:** Errors include stable types, exit codes, retry and outcome semantics, and next steps you can run directly.

## Capabilities

| Area | Capabilities |
| --- | --- |
| AI Live Photo (`notes`) | List, search, view details, update, delete, and download media |
| Calendar (`calendar`) | Month view, date-range reads, search, details, create, update, delete, and todo status |
| Recordings (`recordings`) | List, search, rich details, and audio download |
| AI Diary (`diary`) | Read by month, search, and view diary details |
| Authentication and configuration | Browser login, scopes, diagnostics, configuration, and redacted logs |

## Install and quick start

### Requirements

- Node.js 20 or newer;
- npm.

### Quick start for people

Set the overseas Open Platform base URL before logging in:

```sh
npm install --global @sharge/cli@latest
sharge config set base-url https://app.loomos.ai/
sharge login
```

Login attempts to open a browser. If you have no graphical environment or the browser does not open automatically, run:

```sh
sharge login --no-browser
```

After authorization, check the installation and your identity:

```sh
sharge version
sharge auth status
sharge --help
```

If an AI agent will use sharge, also install the Skills provided by this repository:

```sh
npx skills add shargedev/sharge-cli -y -g
```

### Build from source

```sh
git clone git@github.com:shargedev/sharge-cli.git
cd sharge-cli
npm ci
npm run build
npm link
```

## Agent quick start

Some authorization steps require a person to use a browser. An agent should install the CLI and Skills in this order:

```sh
# 1. Install the CLI
npm install --global @sharge/cli@latest

# 2. Set the overseas Open Platform base URL
sharge config set base-url https://app.loomos.ai/

# 3. Install all sharge Skills for the current user's agent
npx skills add shargedev/sharge-cli -y -g

# 4. Start login and give the complete URL from the output to the person
sharge login --no-browser

# 5. After the person authorizes access, verify the identity
sharge auth status --json
```

Then request JSON explicitly. Read the help for a specific command when the task warrants it:

```sh
# 1. Read one page of AI Live Photo items
sharge notes list --limit 20 --json

# 2. Read the machine contract before the first write
sharge calendar create --help --json

# 3. Generate input and preview the write
sharge calendar create --generate-input > calendar-create.json
sharge calendar create --input @calendar-create.json --dry-run --json

# 4. Execute after a person confirms the plan
sharge calendar create --input @calendar-create.json --json
```

If you do not know which namespace contains a capability, start with the machine-readable command catalog:

```sh
sharge --help --json
sharge calendar --help --json
sharge calendar create --help --json
```

Do not guess arguments or blindly retry writes. A network or timeout error may return `outcome: "unknown"`; read the resource first to determine its final state.

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

Common examples:

```sh
sharge notes search "launch plan" --json

sharge calendar list \
  --start 2026-08-03T00:00:00+08:00 \
  --end 2026-08-04T00:00:00+08:00 \
  --json

sharge recordings search "project retrospective" --limit 10 --json
sharge diary list 2026-08 --json
```

For complete arguments, the CLI's JSON help is the authoritative machine contract:

```sh
sharge <namespace> <command> --help --json
```

## Output, pagination, and write contract

- Text output defaults to Chinese in both terminals and pipes.
- `--json` writes both success and error envelopes to stdout; plain-text errors go to stderr.
- `--jq` filters only successful envelopes and requires `--json`.
- List and search commands read one page at a time; use the opaque cursor from the response to request another page explicitly.
- Each write command sends one request and does not retry automatically.
- Only `--input -` reads stdin; other invocations do not wait for input implicitly.
- Downloads never write binary data to stdout.

See the [JSON contract](./docs/json-contract.en.md), [errors and exit codes](./docs/errors.en.md), and [download contract](./docs/downloads.en.md).

## Authentication and configuration

The CLI's built-in Open Platform URL is `https://ai.shargetech.com`. For overseas use, set the base URL to `https://app.loomos.ai/` before logging in. The CLI reads configuration from `~/.sharge/settings.json` or environment variables, with settings taking precedence. Use `sharge config show` to check the active URL.

```sh
sharge config set base-url https://app.loomos.ai/
sharge config show
sharge login --scope quick_notes:read --scope calendar:read
sharge auth status --json
sharge auth scopes --json
sharge config show
sharge doctor --json
```

API keys must begin with `lms-...`. They are neither supplied as command-line arguments nor printed in full. The CLI stores the base URL without the trailing slash, so `config show` displays `https://app.loomos.ai`. After changing the base URL, log in again if needed and verify your login status.

See [authentication](./docs/authentication.en.md) and [configuration](./docs/configuration.en.md).

## Agent Skills

The repository provides five Agent Skills in [`skills/`](./skills), aligned with the current CLI:

- `sharge-core`
- `sharge-notes`
- `sharge-calendar`
- `sharge-recordings`
- `sharge-diary`

They use the CLI's `--help --json` as the source of truth for commands. The following check validates structure, links, safety coverage, and command consistency:

```sh
npm run skills:validate
```

Skills are distributed from the source repository and are not included in the CLI's npm tarball:

```sh
# Install all Skills globally
npx skills add shargedev/sharge-cli -y -g

# List the Skills available in the repository
npx skills add shargedev/sharge-cli --list
```

## Safety and risks

After browser authorization, the CLI accesses data as the current user within the granted scopes. Before giving an agent access, request only the permissions needed for the task and review plans involving writes, deletes, or file replacement.

- Repeat `--scope` to request only the permissions needed for the task.
- Preview writes with `--dry-run`; destructive operations such as deletion require explicit `--yes`.
- After a timeout or network error during a write, check `outcome` and read the resource before retrying.
- Do not put API keys in command lines, prompts, logs, issues, or chat messages.
- Local settings and JSONL logs are stored in `~/.sharge/`; logs are redacted and rotated automatically.
- Download redirects do not forward Authorization to a different origin.
- The CLI does not collect product usage telemetry; diagnostics are written only to redacted local logs.

## Documentation

The reference documents are available in English:

| Document | Contents |
| --- | --- |
| [Quick start](./docs/getting-started.en.md) | Install, log in, and make the first read |
| [Agent guide](./docs/agent-guide.en.md) | Safe invocation, input, recovery, and pagination |
| [Command reference](./docs/commands/README.en.md) | Commands, arguments, scopes, and examples |
| [JSON contract](./docs/json-contract.en.md) | Envelopes, JSON help, input schemas, and jq |
| [Errors and exit codes](./docs/errors.en.md) | Stable errors, unknown outcomes, and nextActions |
| [Downloads](./docs/downloads.en.md) | Paths, name collisions, overwrites, redirects, and checksums |

## Development and contribution

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run contract:test
npm run skills:validate
npm run build
npm pack --dry-run --json
```

Before reporting a problem or suggestion, search existing [issues](https://github.com/shargedev/sharge-cli/issues). You can contribute code through a [pull request](https://github.com/shargedev/sharge-cli/pulls). For changes to public commands, input/output, or safety behavior, update `docs/` and add tests first.

See the [contribution guide](./CONTRIBUTING.md), [security policy](./SECURITY.md), [changelog](./CHANGELOG.md), and [MIT License](./LICENSE).
