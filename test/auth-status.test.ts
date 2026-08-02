import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("auth status", () => {
  it("returns AUTH_REQUIRED before network access when no key is configured", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-auth-required-"));
    cleanupPaths.push(homeDir);
    let stdout = "";

    const exitCode = await main(
      ["node", "sharge", "auth", "status", "--json"],
      {
        env: {},
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      {
        stdout: (value) => {
          stdout += value;
        },
        stderr: () => {},
      },
    );

    expect(exitCode).toBe(3);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      command: "auth.status",
      error: {
        type: "AUTH_REQUIRED",
        retryable: false,
        nextActions: [{ command: "sharge login" }],
      },
      meta: {
        requestId: null,
        httpStatus: null,
      },
    });
  });

  it("performs one authenticated request and preserves OpenAPI data", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-auth-status-"));
    cleanupPaths.push(homeDir);
    const configDir = join(homeDir, ".sharge");
    await mkdir(configDir, { mode: 0o700 });

    const requests: Array<{
      method?: string;
      url?: string;
      authorization?: string;
      clientDate?: string;
      userAgent?: string;
    }> = [];
    const server = createServer((request, response) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        clientDate: request.headers["x-client-date"] as string | undefined,
        userAgent: request.headers["user-agent"],
      });
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_auth_status",
      });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: {
            user_id: "user_e2e",
            auth_type: "api_key",
            scopes: ["calendar:read"],
            scope_mode: "api_key_snapshot",
            api_key: {
              id: 42,
              key_prefix: "lms-status",
            },
            server_time: "2026-07-31T02:00:00Z",
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
    await writeFile(
      join(configDir, "settings.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_test",
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "lms-auth-status-secret",
        timezone: "Asia/Shanghai",
      })}\n`,
      { mode: 0o600 },
    );

    let stdout = "";
    let stderr = "";
    try {
      const exitCode = await main(
        ["node", "sharge", "auth", "status", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        {
          stdout: (value) => {
            stdout += value;
          },
          stderr: (value) => {
            stderr += value;
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        method: "GET",
        url: "/open-api/v1/auth/status",
        authorization: "Bearer lms-auth-status-secret",
      });
      expect(requests[0]?.clientDate).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
      );
      expect(requests[0]?.userAgent).toMatch(/^sharge-cli\/\d+\.\d+\.\d+/);

      expect(JSON.parse(stdout)).toMatchObject({
        schemaVersion: "1",
        ok: true,
        command: "auth.status",
        data: {
          credential: {
            source: "settings",
            settingsPath: join(configDir, "settings.json"),
            keyPrefix: "lms-auth…",
            baseUrl: `http://127.0.0.1:${address.port}`,
            environment: "custom",
          },
          auth: {
            user_id: "user_e2e",
            auth_type: "api_key",
            scopes: ["calendar:read"],
            scope_mode: "api_key_snapshot",
          },
        },
        meta: {
          requestId: "req_auth_status",
          timezone: "Asia/Shanghai",
          clientDate: expect.stringMatching(/[+-]\d{2}:\d{2}$/),
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("uses the explicit timezone for X-Client-Date and response meta", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-auth-timezone-"));
    cleanupPaths.push(homeDir);
    const configDir = join(homeDir, ".sharge");
    await mkdir(configDir, { mode: 0o700 });
    let clientDate = "";
    const server = createServer((request, response) => {
      clientDate = String(request.headers["x-client-date"]);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_timezone",
      });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: { user_id: "user_timezone" },
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
    await writeFile(
      join(configDir, "settings.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_timezone",
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "lms-timezone-secret",
        timezone: "Asia/Shanghai",
      })}\n`,
      { mode: 0o600 },
    );
    let stdout = "";
    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "auth",
          "status",
          "--json",
          "--timezone",
          "America/Los_Angeles",
        ],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        {
          stdout: (value) => {
            stdout += value;
          },
          stderr: () => {},
        },
      );

      expect(exitCode).toBe(0);
      expect(clientDate).toMatch(/-0[78]:00$/);
      expect(JSON.parse(stdout).meta).toMatchObject({
        timezone: "America/Los_Angeles",
        clientDate: clientDate,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("maps a 401 response to CREDENTIAL_INVALID without retrying", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-auth-invalid-"));
    cleanupPaths.push(homeDir);
    const configDir = join(homeDir, ".sharge");
    await mkdir(configDir, { mode: 0o700 });
    let requestCount = 0;
    const server = createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(401, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_invalid",
      });
      response.end(
        JSON.stringify({ code: 401, message: "Invalid token", data: null }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    await writeFile(
      join(configDir, "settings.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_test",
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "lms-invalid-secret",
      })}\n`,
      { mode: 0o600 },
    );
    let stdout = "";
    try {
      const exitCode = await main(
        ["node", "sharge", "auth", "status", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        {
          stdout: (value) => {
            stdout += value;
          },
          stderr: () => {},
        },
      );
      expect(exitCode).toBe(3);
      expect(requestCount).toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({
        error: {
          type: "CREDENTIAL_INVALID",
          retryable: false,
          nextActions: [{ command: "sharge login --force" }],
        },
        meta: {
          requestId: "req_invalid",
          httpStatus: 401,
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
