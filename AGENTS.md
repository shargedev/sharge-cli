# sharge CLI contributor guide

## Repository purpose

`sharge` is the official agent-first CLI for Sharge Open Platform. It is built with TypeScript and Node.js and exposes authentication, Notes, Calendar, Recordings, and Diary commands.

The current public surface is documented in [`README.md`](./README.md) and [`docs/`](./docs/README.md). Do not document or expose a command until it is implemented and present in CLI help.

## Sources of truth

- [`src/cli/definitions.ts`](./src/cli/definitions.ts) is the single command definition used for parsing and text/JSON help.
- [`src/cli.ts`](./src/cli.ts) owns dispatch, envelopes, rendering, and invocation logging.
- [`contracts/openapi-v1.json`](./contracts/openapi-v1.json) is the fixed OpenAPI contract used during development and CI.
- [`docs/commands/`](./docs/commands/README.md) defines public command behavior for users.
- [`test/`](./test) contains executable behavior and regression contracts.

If public behavior changes, update user documentation first, then tests and implementation.

## Public documentation

文档是给外部看的，不要对齐内部实现细节！文档不是代码，是给人看的！

## Architecture

- `src/index.ts`: process entry and exit-code assignment.
- `src/cli/`: command definitions and help metadata.
- `src/runtime/`: settings, config resolution, input, output, files, downloads, and logging.
- `src/api/`: one-shot HTTP transport, OpenAPI operation adapters, and download streaming.
- `src/commands/`: authentication, system, Notes, Calendar, Recordings, and Diary behavior.
- `skills/`: installable Agent Skills for the implemented command surface.
- `scripts/validate-skills.mjs`: Skill structure, safety, help, and scenario validation.
- `e2e/`: isolated Agent Runtime end-to-end runner.

Keep `src/cli.ts` focused on wiring. Put product behavior in the owning command module and shared system behavior in `runtime` or `api`.

## Public invariants

- Default output is Chinese text in TTYs and pipes; JSON requires explicit `--json`.
- JSON success and error envelopes use `schemaVersion: "1"`.
- stdout contains results; text diagnostics and errors use stderr. JSON errors stay on stdout.
- Business commands never log in, retry, paginate, or read stdin implicitly.
- Only `--input -` reads stdin.
- Writes use one-shot requests; network or timeout failures report unknown outcome and are not retried.
- Destructive execution requires `--yes`; writes support zero-network `--dry-run` where documented.
- Credentials accept `lms-...` only and must never appear in output, logs, fixtures, or examples.
- Settings and logs are permission-hardened, atomic where applicable, symlink-safe, rotated, and redacted.
- Downloads never write binary data to stdout or forward Authorization across origins.
- Backend DTO fields and opaque IDs/cursors are preserved without lossy conversion.
- `--help` and `--help --json` must remain offline and come from the same command definition.

## Development workflow

Before editing, read the relevant user document, command definition, implementation, and focused tests.

Use test-driven changes for public behavior:

1. Add a focused failing test through the public CLI boundary.
2. Implement the smallest behavior that makes it pass.
3. Refactor from green.
4. Run focused checks, then the full static and test suite.

Do not add compatibility aliases, a second schema registry, automatic retries, automatic full pagination, or undocumented commands.

## Local commands

```sh
npm ci
npm run build
node dist/index.js --help
node dist/index.js --help --json
```

Required verification:

```sh
npm run lint
npm run typecheck
npm test
npm run contract:test
npm run skills:validate
npm run build
npm pack --dry-run --json
```

## End-to-end tests

E2E requires a local `ai_glass` checkout. Pass its location explicitly; never commit a contributor-specific path:

```sh
SHARGE_AI_GLASS_ROOT=/absolute/path/to/ai_glass npm run e2e
```

`SHARGE_AGENT_RUNTIME` may override the runtime executable. Otherwise the runner uses `$SHARGE_AI_GLASS_ROOT/.agent/bin/agent`.

The runner creates a unique Runtime and isolated HOME/cwd. Success cleans generated state. Failure stops the Runtime and prints retained evidence locations for local diagnosis; do not commit those results.

## Agent Skills

The five repository Skills are installed from GitHub with the standard Skills CLI:

```sh
npx skills add shargedev/sharge-cli -y -g
```

Validate them after changing `skills/`, CLI help, or command safety behavior:

```sh
npm run skills:validate
```

The npm tarball contains the CLI only. Skills remain in `skills/` so `npx skills` can discover and install them from the repository.
