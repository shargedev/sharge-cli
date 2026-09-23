---
title: Configuration
description: Settings, environment variables, base URL, timezone, and local logs.
---

# Configuration

## Settings directory

Sharge CLI uses a fixed directory:

```text
~/.sharge/
├── settings.json
├── sharge.log
├── sharge.log.1
└── ...
```

There is no custom settings path. On POSIX, the directory uses `0700` permissions and settings/log files use `0600`; Windows uses equivalent current-user ACLs. The CLI rejects symlinks for settings and logs and repairs overly broad permissions when safe.

## settings.json

The file can hold the installation ID, active base URL and key, timezone, and one previous URL/key pair. Keys are stored in plain text in this protected local file. Do not commit, sync, or copy it to an untrusted location. Updates use a temporary file in the same directory and an atomic rename.

## Environment variables and precedence

| Variable | Used when |
| --- | --- |
| `SHARGE_API_KEY` | Settings has no key |
| `SHARGE_BASE_URL` | Settings has no base URL |
| `SHARGE_TIMEZONE` | Settings has no timezone |

Precedence:

```text
API key:  settings.json apiKey > SHARGE_API_KEY
Base URL: settings.json baseUrl > SHARGE_BASE_URL > https://ai.shargetech.com
Timezone: --timezone > settings.json timezone > SHARGE_TIMEZONE > system timezone
```

Invalid settings fail immediately; the CLI does not silently use a lower-priority source. There is no `SHARGE_SETTINGS_FILE`, `SHARGE_YES`, or environment switch for retries or full pagination.

## Base URL

The built-in default is the China production origin `https://ai.shargetech.com`. For overseas use, set the base URL before login:

```sh
sharge config set base-url https://app.loomos.ai/
sharge config show
sharge login
```

The CLI stores and shows this as `https://app.loomos.ai`, without the trailing slash. A base URL must be an HTTPS origin without credentials, path, query, or fragment. An explicit localhost development origin may use HTTP. There is no per-invocation `--base-url` option.

To remove a saved base URL and return to the environment variable or built-in default:

```sh
sharge config unset base-url
```

Custom URLs display the environment name `custom`; the built-in URL displays `default`.

## Previous credential cache

API keys are tied to a base URL. When switching URLs, the CLI can restore a key from one cached previous URL. Otherwise it moves the current key to that single cache slot, clears the active key, and requires login for the new URL. This is not a named-profile system or a permanent multi-environment key store. A cached key that receives `401` fails immediately.

## Timezone

```sh
sharge config set timezone America/Los_Angeles
sharge config unset timezone
```

Use an IANA timezone such as `Asia/Shanghai`, `America/Los_Angeles`, or `Europe/London`. Invalid values fail before network access. Business requests send an offset-aware `X-Client-Date`; JSON `meta.timezone` and `meta.clientDate` show the values used.

## Configure an API key manually

Browser login is recommended. If manual configuration is necessary, set `SHARGE_API_KEY` or edit the protected settings file. The key must start with `lms-`; JWTs are not accepted. Never pass a key as a command argument; there is no `config set api-key`.

## Config commands

```text
sharge config show
sharge config set <base-url|timezone> <value>
sharge config unset <base-url|timezone>
```

`config show --json` returns the resolved value and source, environment name, settings path, redacted key summary, whether a previous credential exists and its base URL, and the log path. It never returns the complete key.

## Logs

Each run appends redacted JSON Lines to `~/.sharge/sharge.log`. Find or clear the file with:

```sh
sharge logs path
sharge logs clear --yes
```

Logs rotate at 5 MiB, retaining the current file and four older files. Logging errors do not fail business commands. Logs include the run ID, command path, configuration source, HTTP method/path/status, request ID, duration, and error type. They exclude keys, Authorization, polling tokens, raw arguments, `--input` bodies, request/response bodies, product content, and signed download or authorization URLs.

`--debug` writes diagnostics to stderr: Chinese text in text mode or JSON Lines in JSON mode.
