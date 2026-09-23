---
title: System commands
description: Version, login, doctor, authentication, configuration, and logs commands.
---

# System, authentication, configuration, and logs commands

## `sharge version`

Prints the CLI version without login or network access. `--json` returns `data.version`. Repeating it is safe.

```sh
sharge version
sharge version --json
```

## `sharge login`

```text
sharge login [--scope <scope>...] [--force] [--no-browser]
             [--timeout <duration>] [--json] [--debug]
```

For overseas use, configure `https://app.loomos.ai/` before login. A repeated `--scope` specifies the complete desired set; without it, login requests all current scopes: `quick_notes:read`, `quick_notes:write`, `calendar:read`, `calendar:write`, `voicemaster:read`, and `ai_daily:read`.

`--force` rotates the key even if the current one is valid. `--no-browser` prints the complete URL without opening it. `--timeout` can shorten local waiting but cannot extend server expiry. With `--json`, stdout holds one final envelope and stderr has JSON Lines events. A valid settings credential covering the target scopes returns `data.changed: false`; completed authorization returns `changed: true`, key metadata, and scopes. Login may open a browser, create a server session, rotate a key, and save settings atomically. It has no `--input` or `--dry-run`.

See [Authentication](../authentication.en.md).

## `sharge logout`

```sh
sharge logout
sharge logout --json
```

Removes active and previous cached keys from settings while preserving installation ID, base URL, timezone, and the server-side key. It does not need `--yes`. JSON reports whether local credentials were removed. If `SHARGE_API_KEY` remains set, `environmentCredentialActive` is true and a warning suggests unsetting the variable.

## `sharge auth status`

```sh
sharge auth status
sharge auth status --json
```

Uses the selected valid credential for one status request. JSON combines the local credential source, settings path, redacted prefix, base URL/environment, and server identity: user ID, scopes, authentication type, key metadata, installation/client information, expiry, last use, and server time. The complete key is never returned.

## `sharge auth scopes`

```sh
sharge auth scopes
sharge auth scopes --json
```

Reads the complete scope catalog and current `granted` status in one request. Business fields remain in their Open API form.

## `sharge doctor`

```sh
sharge doctor
sharge doctor --json
sharge doctor --json --debug
```

Checks the CLI and Node versions, settings directory/permissions/schema, base URL, timezone, redacted key source, log writability, Open Platform connectivity, auth status, and scope catalog. It does not log in, rotate credentials, or modify business data. It may safely repair file permissions. JSON returns `healthy` and named checks with pass/fail status and possible next actions; required failures cause nonzero exit.

## `sharge config show`

```sh
sharge config show
sharge config show --json
```

Works offline. JSON reports the resolved base URL/source/environment, timezone/source, redacted key source/prefix, settings path, installation ID, previous credential presence/base URL, and log path. It never returns the full key.

## `sharge config set`

```text
sharge config set <base-url|timezone> <value>
```

```sh
sharge config set base-url https://app.loomos.ai/
sharge config set timezone America/Los_Angeles
```

Works offline and writes settings atomically. Changing the base URL may restore a cached credential or clear the active one and require login. There is no `config set api-key`.

## `sharge config unset`

```text
sharge config unset <base-url|timezone>
```

Removing a settings value exposes the environment variable or built-in default. A resulting URL switch follows the same credential cache rules.

## `sharge logs path`

```sh
sharge logs path
sharge logs path --json
```

Works offline without login. JSON returns `data.filePath`, the absolute path to the current log.

## `sharge logs clear`

```sh
sharge logs clear --yes
sharge logs clear --yes --json
```

Removes the current and rotated logs, but never settings. Missing `--yes` fails locally. JSON reports `cleared` and `removedFiles`.
