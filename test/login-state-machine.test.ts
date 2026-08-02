import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

const SCOPES = [
  "quick_notes:read",
  "quick_notes:write",
  "calendar:read",
  "calendar:write",
  "voicemaster:read",
  "ai_daily:read",
];

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (value: string) => {
        stdout += value;
      },
      stderr: (value: string) => {
        stderr += value;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function setupHome(baseUrl: string) {
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-login-state-"));
  cleanupPaths.push(homeDir);
  await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
  await writeFile(
    join(homeDir, ".sharge", "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_state",
      baseUrl,
    })}\n`,
    { mode: 0o600 },
  );
  return homeDir;
}

async function runTerminalStatus(status: string, statusCode = 200) {
  const server = createServer((request, response) => {
    const polling = request.url?.endsWith("/poll") ?? false;
    response.writeHead(polling ? statusCode : 201, {
      "Content-Type": "application/json",
      "X-Request-Id": `req_${status}`,
    });
    response.end(
      JSON.stringify({
        code: 0,
        message: "ok",
        data: polling
          ? {
              status,
              key: null,
              key_id: null,
              scopes: null,
              expires_at: null,
            }
          : {
              authorization_id: `auth_${status}`,
              polling_token: `poll-${status}-secret`,
              verification_uri: "https://example.test/authorize",
              verification_uri_complete: `https://example.test/authorize?authorization_id=auth_${status}&user_code=TERM-2345`,
              user_code: "TERM-2345",
              expires_in: 600,
              poll_interval: 1,
            },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
  const capture = captureIo();
  try {
    const exitCode = await main(
      ["node", "sharge", "login", "--no-browser", "--json"],
      {
        env: {},
        homeDir,
        cwd: homeDir,
        platform: process.platform,
        sleep: async () => {},
      },
      capture.io,
    );
    return {
      exitCode,
      stdout: capture.stdout(),
      stderr: capture.stderr(),
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("login state machine", () => {
  it("rejects an unsupported scope before using the network", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-login-scope-fast-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "login",
          "--scope",
          "unknown:read",
          "--no-browser",
          "--json",
        ],
        {
          env: { SHARGE_BASE_URL: `http://127.0.0.1:${address.port}` },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(2);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: { type: "INVALID_INPUT", field: "--scope" },
      });
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("advertises repeatable scopes and every terminal recovery error offline", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-login-help-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      ["node", "sharge", "login", "--help", "--json"],
      {
        env: {},
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(capture.stdout()).data).toMatchObject({
      options: expect.arrayContaining([
        expect.objectContaining({
          name: "--scope",
          repeatable: true,
          enum: SCOPES,
        }),
        expect.objectContaining({
          name: "--timeout",
          default: null,
          description: expect.stringContaining("服务端授权有效期"),
        }),
      ]),
      timeout: null,
      sideEffects: expect.arrayContaining([
        "create_authorization_session",
        "open_browser",
        "rotate_api_key",
        "update_settings",
      ]),
      errors: expect.arrayContaining([
        "AUTHORIZATION_DENIED",
        "AUTHORIZATION_EXPIRED",
        "AUTHORIZATION_CONSUMED",
        "AUTHORIZATION_SUPERSEDED",
        "CANCELLED",
      ]),
    });
    expect(capture.stderr()).toBe("");
  });

  it("uses Retry-After after processing before polling again", async () => {
    const statuses = ["pending", "processing", "approved"];
    const server = createServer((request, response) => {
      const polling = request.url?.endsWith("/poll") ?? false;
      const status = polling ? statuses.shift() : undefined;
      response.writeHead(polling ? 200 : 201, {
        "Content-Type": "application/json",
        ...(status === "processing" ? { "Retry-After": "4" } : {}),
      });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: polling
            ? status === "approved"
              ? {
                  status,
                  key: "lms-processing-secret",
                  key_id: 101,
                  scopes: SCOPES,
                  expires_at: null,
                }
              : { status }
            : {
                authorization_id: "auth_processing",
                polling_token: "poll-processing-secret",
                verification_uri: "https://example.test/authorize",
                verification_uri_complete:
                  "https://example.test/authorize?authorization_id=auth_processing&user_code=PROC-2345",
                user_code: "PROC-2345",
                expires_in: 600,
                poll_interval: 2,
              },
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
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const waits: number[] = [];
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "login", "--no-browser", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          sleep: async (milliseconds) => {
            waits.push(milliseconds);
          },
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(waits).toEqual([2_000, 2_000, 4_000]);
      expect(
        capture
          .stderr()
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).event),
      ).toEqual([
        "authorization.created",
        "authorization.pending",
        "authorization.processing",
        "credential.saved",
        "authorization.approved",
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        data: { keyId: 101 },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("stops immediately when authorization is denied", async () => {
    const result = await runTerminalStatus("denied");

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        type: "AUTHORIZATION_DENIED",
        retryable: false,
        nextActions: [{ command: "sharge login --force" }],
      },
      meta: { requestId: "req_denied", httpStatus: 200 },
    });
    expect(
      result.stderr
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).event),
    ).toEqual(["authorization.created", "authorization.denied"]);
  });

  it("stops immediately when authorization has expired", async () => {
    const result = await runTerminalStatus("expired", 410);

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        type: "AUTHORIZATION_EXPIRED",
        retryable: false,
        nextActions: [{ command: "sharge login --force" }],
      },
      meta: { httpStatus: 410 },
    });
    expect(
      result.stderr
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).event),
    ).toEqual(["authorization.created", "authorization.expired"]);
  });

  it("stops immediately when the one-time credential was already consumed", async () => {
    const result = await runTerminalStatus("consumed", 410);

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        type: "AUTHORIZATION_CONSUMED",
        retryable: false,
        nextActions: [{ command: "sharge login --force" }],
      },
      meta: { httpStatus: 410 },
    });
    expect(
      result.stderr
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).event),
    ).toEqual(["authorization.created", "authorization.consumed"]);
  });

  it("stops immediately when a newer session superseded this installation", async () => {
    const result = await runTerminalStatus("superseded", 410);

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        type: "AUTHORIZATION_SUPERSEDED",
        retryable: false,
        nextActions: [{ command: "sharge login --force" }],
      },
      meta: { httpStatus: 410 },
    });
    expect(
      result.stderr
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).event),
    ).toEqual(["authorization.created", "authorization.superseded"]);
  });

  it("treats poll 429 as protocol slow-down and waits Retry-After", async () => {
    let polls = 0;
    const server = createServer((request, response) => {
      const polling = request.url?.endsWith("/poll") ?? false;
      polls += polling ? 1 : 0;
      const rateLimited = polling && polls === 1;
      response.writeHead(rateLimited ? 429 : polling ? 200 : 201, {
        "Content-Type": "application/json",
        ...(rateLimited ? { "Retry-After": "3" } : {}),
      });
      response.end(
        JSON.stringify(
          rateLimited
            ? { code: 429, message: "poll slowly", data: null }
            : {
                code: 0,
                message: "ok",
                data: polling
                  ? {
                      status: "approved",
                      key: "lms-rate-limit-secret",
                      key_id: 102,
                      scopes: SCOPES,
                      expires_at: null,
                    }
                  : {
                      authorization_id: "auth_rate_limit",
                      polling_token: "poll-rate-limit-secret",
                      verification_uri: "https://example.test/authorize",
                      verification_uri_complete:
                        "https://example.test/authorize?authorization_id=auth_rate_limit&user_code=SLOW-2345",
                      user_code: "SLOW-2345",
                      expires_in: 600,
                      poll_interval: 1,
                    },
              },
        ),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const waits: number[] = [];
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "login", "--no-browser", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          sleep: async (milliseconds) => {
            waits.push(milliseconds);
          },
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(polls).toBe(2);
      expect(waits).toEqual([1_000, 3_000]);
      expect(
        capture
          .stderr()
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).event),
      ).toEqual([
        "authorization.created",
        "authorization.processing",
        "credential.saved",
        "authorization.approved",
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("treats repeated --scope values as the complete canonical target set", async () => {
    let createBody: Record<string, unknown> | undefined;
    const server = createServer((request, response) => {
      let rawBody = "";
      request.on("data", (chunk) => {
        rawBody += String(chunk);
      });
      request.on("end", () => {
        const polling = request.url?.endsWith("/poll") ?? false;
        if (!polling) {
          createBody = JSON.parse(rawBody);
        }
        response.writeHead(polling ? 200 : 201, {
          "Content-Type": "application/json",
        });
        response.end(
          JSON.stringify({
            code: 0,
            message: "ok",
            data: polling
              ? {
                  status: "approved",
                  key: "lms-scoped-secret",
                  key_id: 103,
                  scopes: ["quick_notes:read", "calendar:read"],
                  expires_at: null,
                }
              : {
                  authorization_id: "auth_scoped",
                  polling_token: "poll-scoped-secret",
                  verification_uri: "https://example.test/authorize",
                  verification_uri_complete:
                    "https://example.test/authorize?authorization_id=auth_scoped&user_code=SCOP-2345",
                  user_code: "SCOP-2345",
                  expires_in: 600,
                  poll_interval: 1,
                },
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "login",
          "--scope",
          "calendar:read",
          "--scope",
          "quick_notes:read",
          "--no-browser",
          "--json",
        ],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          sleep: async () => {},
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(createBody?.scopes).toEqual(["quick_notes:read", "calendar:read"]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        data: {
          scopes: ["quick_notes:read", "calendar:read"],
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("uses an explicit timeout as a total login deadline", async () => {
    let polls = 0;
    const server = createServer((request, response) => {
      const polling = request.url?.endsWith("/poll") ?? false;
      polls += polling ? 1 : 0;
      response.writeHead(polling ? 200 : 201, {
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: polling
            ? { status: "pending" }
            : {
                authorization_id: "auth_timeout",
                polling_token: "poll-timeout-secret",
                verification_uri: "https://example.test/authorize",
                verification_uri_complete:
                  "https://example.test/authorize?authorization_id=auth_timeout&user_code=TIME-2345",
                user_code: "TIME-2345",
                expires_in: 600,
                poll_interval: 2,
              },
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
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const waits: number[] = [];
    let now = 0;
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "login",
          "--timeout",
          "3s",
          "--no-browser",
          "--json",
        ],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          now: () => now,
          sleep: async (milliseconds) => {
            waits.push(milliseconds);
            now += milliseconds;
            if (now > 3_000) {
              throw new Error("test loop exceeded expected deadline");
            }
          },
        },
        capture.io,
      );

      expect(exitCode).toBe(8);
      expect(polls).toBe(1);
      expect(waits).toEqual([2_000, 1_000]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: false,
        error: {
          type: "TIMEOUT",
          retryable: true,
          nextActions: [{ command: "sharge login --force" }],
        },
      });
      expect(
        capture
          .stderr()
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).event),
      ).toEqual([
        "authorization.created",
        "authorization.pending",
        "authorization.expired",
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("returns 130 on cancellation without writing a partial credential", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(201, {
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: {
            authorization_id: "auth_cancel",
            polling_token: "poll-cancel-secret",
            verification_uri: "https://example.test/authorize",
            verification_uri_complete:
              "https://example.test/authorize?authorization_id=auth_cancel&user_code=STOP-2345",
            user_code: "STOP-2345",
            expires_in: 600,
            poll_interval: 2,
          },
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
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const controller = new AbortController();
    const capture = captureIo();

    try {
      const execution = main(
        ["node", "sharge", "login", "--no-browser", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          signal: controller.signal,
          sleep: async (_milliseconds, signal) =>
            await new Promise<void>((_resolve, reject) => {
              signal?.addEventListener(
                "abort",
                () => {
                  const error = new Error("cancelled");
                  error.name = "AbortError";
                  reject(error);
                },
                { once: true },
              );
            }),
        },
        capture.io,
      );
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (capture.stderr().includes("authorization.created")) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      controller.abort();
      const exitCode = await execution;

      expect(exitCode).toBe(130);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: false,
        error: {
          type: "CANCELLED",
          retryable: false,
        },
      });
      const settings = JSON.parse(
        await readFile(join(homeDir, ".sharge", "settings.json"), "utf8"),
      );
      expect(settings.apiKey).toBeUndefined();
      expect(capture.stdout()).not.toContain("poll-cancel-secret");
      expect(capture.stderr()).not.toContain("poll-cancel-secret");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("--force skips the existing credential check and rotates through authorization", async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? "");
      const polling = request.url?.endsWith("/poll") ?? false;
      response.writeHead(polling ? 200 : 201, {
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: polling
            ? {
                status: "approved",
                key: "lms-force-new-secret",
                key_id: 104,
                scopes: SCOPES,
                expires_at: null,
              }
            : {
                authorization_id: "auth_force",
                polling_token: "poll-force-secret",
                verification_uri: "https://example.test/authorize",
                verification_uri_complete:
                  "https://example.test/authorize?authorization_id=auth_force&user_code=TURN-2345",
                user_code: "TURN-2345",
                expires_in: 600,
                poll_interval: 1,
              },
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
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const homeDir = await setupHome(baseUrl);
    const settingsPath = join(homeDir, ".sharge", "settings.json");
    await writeFile(
      settingsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_state",
        baseUrl,
        apiKey: "lms-force-old-secret",
      })}\n`,
      { mode: 0o600 },
    );
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "login", "--force", "--no-browser", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          sleep: async () => {},
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(paths).toEqual([
        "/ai/open-platform/cli-authorizations",
        "/ai/open-platform/cli-authorizations/auth_force/poll",
      ]);
      expect(JSON.parse(await readFile(settingsPath, "utf8")).apiKey).toBe(
        "lms-force-new-secret",
      );
      expect(capture.stdout()).not.toContain("lms-force-old-secret");
      expect(capture.stdout()).not.toContain("lms-force-new-secret");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
