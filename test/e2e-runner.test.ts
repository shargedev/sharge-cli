import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { mergeProcessOptions, runProcess } from "../e2e/helpers/run-cli.mjs";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("passes explicit string stdin to a child process", async () => {
  const result = await runProcess(
    [
      process.execPath,
      "-e",
      "let value=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(value));",
    ],
    {
      cwd: process.cwd(),
      stdin: '{"content":"stdin e2e"}',
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe('{"content":"stdin e2e"}');
  expect(result.stderr).toBe("");
});

it("lets a focused E2E case override the default process timeout", () => {
  expect(
    mergeProcessOptions(
      { timeoutMs: 15_000 },
      { cwd: "/tmp/e2e", timeoutMs: 5_000 },
    ),
  ).toMatchObject({
    cwd: "/tmp/e2e",
    timeoutMs: 15_000,
  });
});

it("requires the Agent Runtime repository path explicitly", async () => {
  const env = { ...process.env };
  delete env.SHARGE_AI_GLASS_ROOT;
  delete env.SHARGE_AGENT_RUNTIME;

  const result = await runProcess(
    [
      process.execPath,
      resolve(process.cwd(), "e2e", "run.mjs"),
      "--slice",
      "S01",
    ],
    {
      cwd: process.cwd(),
      env,
      timeoutMs: 10_000,
    },
  );

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("缺少 SHARGE_AI_GLASS_ROOT");
});

it("retains a failed Agent Runtime and prints actionable evidence", async () => {
  const fakeRoot = await mkdtemp(join(tmpdir(), "sharge-fake-runtime-"));
  cleanupPaths.push(fakeRoot);
  const fakeAgent = join(fakeRoot, "agent");
  const commandLog = join(fakeRoot, "commands.log");
  await writeFile(
    fakeAgent,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_AGENT_LOG"
if [ "$1" = "wait" ]; then
  printf '%s\\n' "synthetic wait failure" >&2
  exit 23
fi
exit 0
`,
    { mode: 0o700 },
  );
  await chmod(fakeAgent, 0o700);

  const result = await runProcess(
    [
      process.execPath,
      resolve(process.cwd(), "e2e", "run.mjs"),
      "--slice",
      "S06",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SHARGE_AI_GLASS_ROOT: fakeRoot,
        SHARGE_AGENT_RUNTIME: fakeAgent,
        FAKE_AGENT_LOG: commandLog,
      },
      timeoutMs: 10_000,
    },
  );

  expect(result.exitCode).not.toBe(0);
  const commands = (await readFile(commandLog, "utf8")).trim().split("\n");
  expect(commands.map((command) => command.split(" ")[0])).toEqual([
    "init",
    "up",
    "start",
    "wait",
    "down",
  ]);
  expect(commands.some((command) => command.startsWith("clean "))).toBe(false);

  const evidenceLine = result.stderr
    .split("\n")
    .find((line) => line.startsWith('{"event":"e2e.failure"'));
  expect(evidenceLine).toBeDefined();
  const evidence = JSON.parse(evidenceLine ?? "{}");
  expect(evidence).toMatchObject({
    event: "e2e.failure",
    slice: "S06",
    retained: true,
  });
  expect(evidence.runtimeId).toMatch(/^sharge-cli-s06-/);
  expect(evidence.runtimeRunDir).toBe(
    join(fakeRoot, ".agent", "runs", evidence.runtimeId),
  );
  expect(evidence.isolatedHome).toMatch(/^\/.*sharge-cli-e2e-/);
  expect(evidence.isolatedCwd).toMatch(/^\/.*sharge-cli-e2e-cwd-/);

  cleanupPaths.push(evidence.isolatedHome, evidence.isolatedCwd);
});

it("uses ALL as the default Agent Runtime integration run", async () => {
  const fakeRoot = await mkdtemp(join(tmpdir(), "sharge-fake-all-runtime-"));
  cleanupPaths.push(fakeRoot);
  const fakeAgent = join(fakeRoot, "agent");
  const commandLog = join(fakeRoot, "commands.log");
  await writeFile(
    fakeAgent,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_AGENT_LOG"
if [ "$1" = "init" ]; then
  printf '%s\\n' "synthetic integration init failure" >&2
  exit 24
fi
exit 0
`,
    { mode: 0o700 },
  );
  await chmod(fakeAgent, 0o700);

  const result = await runProcess(
    [process.execPath, resolve(process.cwd(), "e2e", "run.mjs")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SHARGE_AI_GLASS_ROOT: fakeRoot,
        SHARGE_AGENT_RUNTIME: fakeAgent,
        FAKE_AGENT_LOG: commandLog,
      },
      timeoutMs: 10_000,
    },
  );

  expect(result.exitCode).not.toBe(0);
  expect((await readFile(commandLog, "utf8")).trim()).toMatch(/^init /);
  const evidenceLine = result.stderr
    .split("\n")
    .find((line) => line.startsWith('{"event":"e2e.failure"'));
  expect(evidenceLine).toBeDefined();
  const evidence = JSON.parse(evidenceLine ?? "{}");
  expect(evidence).toMatchObject({
    event: "e2e.failure",
    slice: "ALL",
    retained: true,
  });
  expect(evidence.runtimeId).toMatch(/^sharge-cli-all-/);
  cleanupPaths.push(evidence.isolatedHome, evidence.isolatedCwd);
});

it("tracks the custom Open Platform server in the Agent Runtime web lifecycle", async () => {
  const source = await readFile(
    resolve(process.cwd(), "e2e", "run.mjs"),
    "utf8",
  );

  expect(source).toContain("/agent/logs/web.pid");
  expect(source).toContain(
    'await runLifecycle(["stop", "--id", runtimeId, "web"])',
  );
});
