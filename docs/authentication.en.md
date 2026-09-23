---
title: Authentication
description: Browser login, API keys, scopes, cached credentials, and logout.
---

# Authentication

Sharge CLI uses an Open Platform API key for business API calls. The browser may use a Loomos JWT to confirm a person's identity, but the JWT is never given to the CLI.

## Credential sources

The CLI accepts an API key from `~/.sharge/settings.json` or `SHARGE_API_KEY`, in that order. If a settings key receives `401`, the CLI fails rather than silently trying the environment variable as another identity.

There is no `--api-key` flag, JWT authentication, system Keychain integration, or custom settings path. A `Bearer ` prefix on an `lms-...` key is normalized away before it is stored.

## Browser login

For overseas use, select the base URL first:

```sh
sharge config set base-url https://app.loomos.ai/
sharge login
```

By default login requests all currently supported scopes:

| Scope | Access |
| --- | --- |
| `quick_notes:read` | Read and search AI Live Photo items; download media |
| `quick_notes:write` | Update title/content and delete AI Live Photo items |
| `calendar:read` | Read and search Calendar |
| `calendar:write` | Create, update, and delete Calendar items; set todo status |
| `voicemaster:read` | Read, search, and download Recordings |
| `ai_daily:read` | Read and search AI Diary entries |

The CLI creates an authorization session, attempts to open the complete URL returned by the server, and displays a visual `user_code`. After the person approves the scopes, the CLI polls at the server's interval, claims the key once, saves it, and only then reports success.

If a browser cannot open automatically:

```sh
sharge login --no-browser
```

Open the complete URL from the CLI. The code is for visual comparison with the browser page; do not type it into the terminal.

## Limit scopes

Repeat `--scope` to specify the **complete desired scope set**:

```sh
sharge login --scope quick_notes:read --scope calendar:read
```

This requests only those two scopes. If a business command later reports `SCOPE_REQUIRED`, its `nextActions` includes a full reauthorization command combining existing and newly required scopes. Keep any existing scopes you still need.

## Idempotence and key rotation

An ordinary `sharge login --json` can return `data.changed: false` without opening a browser when the saved credential is valid and covers the requested scopes. Force a new authorization and key rotation with:

```sh
sharge login --force
```

When only `SHARGE_API_KEY` is set, an explicit login still starts browser authorization so the CLI can save a credential in settings.

## JSON login

```sh
sharge login --json
```

stdout contains one final envelope. stderr carries JSON Lines status events, without human-readable text or repeated polling updates. Events do not contain the polling token or API key. Persistent logs do not store the complete authorization URL.

## One-time key claim

An API key can be claimed only once. If the process stops after claiming it but before saving it, run `sharge login --force` to start a new authorization. A denied, expired, consumed, or superseded authorization also stops the current login; start again when needed.

## Business commands never log in implicitly

Without a credential, a command such as `sharge notes list --json` returns `AUTH_REQUIRED` with a `sharge login` next action. It exits without opening a browser.

## Check identity and scopes

```sh
sharge auth status --json
sharge auth scopes --json
```

`auth status` reports the credential source, settings path, base URL, user ID, authentication type, scopes, key metadata, client/installation information, expiry and last-use times, and server time. It never prints the complete key. `auth scopes` returns the scope catalog with each scope's `granted` status.

## Logout

```sh
sharge logout
```

Logout removes the active and previous cached keys from settings, retaining the installation ID, base URL, and timezone. It does not revoke a server-side key and does not require `--yes`. If `SHARGE_API_KEY` remains set, the CLI warns that the environment credential is still active. Revoke remote keys in the Open Platform UI.

## Login after installation

After installing the CLI and optional Skills, explicitly run `sharge login`. An agent should use `sharge login --no-browser`, pass the complete URL to a person, and wait for browser approval. A failed login does not uninstall the CLI or Skills; fix the problem and run login again.
