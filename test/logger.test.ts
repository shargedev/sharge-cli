import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { appendInvocationLog } from "../src/runtime/logger.js";

describe("persistent CLI logger", () => {
  it("records redacted request and response events for network commands", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-network-log-"));
    const configDir = join(homeDir, ".sharge");
    await mkdir(configDir, { mode: 0o700 });
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_logged",
      });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: { user_id: "user_log", scopes: [] },
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const secret = "lms-network-log-secret";
    await writeFile(
      join(configDir, "settings.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_log",
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: secret,
      })}\n`,
      { mode: 0o600 },
    );

    try {
      const exitCode = await main(
        ["node", "sharge", "auth", "status", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        { stdout: () => {}, stderr: () => {} },
      );
      expect(exitCode).toBe(0);
      const contents = await readFile(join(configDir, "sharge.log"), "utf8");
      expect(contents).not.toContain(secret);
      const events = contents
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events.map((event) => event.event)).toEqual([
        "start",
        "request",
        "response",
        "end",
      ]);
      expect(Date.parse(events[0].timestamp)).toBeLessThanOrEqual(
        Date.parse(events[1].timestamp),
      );
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "request",
            method: "GET",
            path: "/open-api/v1/auth/status",
          }),
          expect.objectContaining({
            event: "response",
            status: 200,
            requestId: "req_logged",
            durationMs: expect.any(Number),
          }),
        ]),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("correlates the envelope runId and never writes configured secrets", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-logger-"));
    const secret = "lms-never-log-this-secret";
    let stdout = "";
    let stderr = "";

    try {
      const exitCode = await main(
        ["node", "sharge", "version", "--json"],
        {
          env: {
            SHARGE_API_KEY: secret,
          },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        {
          stdout: (value: string) => {
            stdout += value;
          },
          stderr: (value: string) => {
            stderr += value;
          },
        },
      );

      expect(exitCode).toBe(0);
      const envelope = JSON.parse(stdout);
      const logContents = await readFile(
        join(homeDir, ".sharge", "sharge.log"),
        "utf8",
      );
      expect(logContents).not.toContain(secret);
      const events = logContents
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        event: "start",
        runId: envelope.meta.runId,
        cliVersion: expect.any(String),
        command: "version",
        optionNames: ["--json"],
        config: {
          baseUrl: {
            value: "https://ai.shargetech.com",
            source: "default",
            environment: "default",
          },
          credential: {
            source: "env",
            keyPrefix: "lms-neve…",
          },
          timezone: {
            source: "system",
          },
        },
      });
      expect(events[1]).toMatchObject({
        event: "end",
        runId: envelope.meta.runId,
        command: "version",
        exitCode: 0,
        durationMs: expect.any(Number),
      });
      expect(stderr).toBe("");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("rotates to four history files and keeps POSIX permissions private", async () => {
    if (process.platform === "win32") {
      return;
    }
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-log-rotate-"));
    const runtime = {
      env: {},
      homeDir,
      cwd: homeDir,
      platform: process.platform,
    };

    try {
      for (let index = 0; index < 7; index += 1) {
        const result = await appendInvocationLog(
          runtime,
          {
            runId: `run_${index}`,
            command: "version",
            exitCode: 0,
          },
          { maxBytes: 1 },
        );
        expect(result.written).toBe(true);
      }

      const configDir = join(homeDir, ".sharge");
      expect((await readdir(configDir)).sort()).toEqual([
        "settings.json",
        "sharge.log",
        "sharge.log.1",
        "sharge.log.2",
        "sharge.log.3",
        "sharge.log.4",
      ]);
      for (const name of await readdir(configDir)) {
        const path = join(configDir, name);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      }
      expect((await stat(configDir)).mode & 0o777).toBe(0o700);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("downgrades a log symlink failure and reports it only with JSON debug", async () => {
    if (process.platform === "win32") {
      return;
    }
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-log-symlink-"));
    const configDir = join(homeDir, ".sharge");
    const outsideLog = join(homeDir, "outside.log");
    let stdout = "";
    let stderr = "";

    try {
      await writeFile(outsideLog, "unchanged\n");
      await appendInvocationLog(
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        {
          runId: "run_prepare",
          command: "version",
          exitCode: 0,
        },
      );
      await rm(join(configDir, "sharge.log"));
      await symlink(outsideLog, join(configDir, "sharge.log"));

      const exitCode = await main(
        ["node", "sharge", "version", "--json", "--debug"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        {
          stdout: (value: string) => {
            stdout += value;
          },
          stderr: (value: string) => {
            stderr += value;
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        ok: true,
        command: "version",
      });
      const diagnostics = stderr
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "CLI_COMPLETE", exitCode: 0 }),
          expect.objectContaining({ type: "LOG_WRITE_FAILED" }),
        ]),
      );
      expect(await readFile(outsideLog, "utf8")).toBe("unchanged\n");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("emits a machine-readable success diagnostic when JSON debug is enabled", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-log-debug-"));
    let stderr = "";

    try {
      const exitCode = await main(
        ["node", "sharge", "version", "--json", "--debug"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        {
          stdout: () => {},
          stderr: (value: string) => {
            stderr += value;
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(JSON.parse(stderr)).toMatchObject({
        type: "CLI_COMPLETE",
        command: "version",
        exitCode: 0,
        durationMs: expect.any(Number),
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
