import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

describe("doctor", () => {
  it("reports malformed settings as a named failed check", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-doctor-settings-"));
    const configDir = join(homeDir, ".sharge");
    await mkdir(configDir, { mode: 0o700 });
    await writeFile(join(configDir, "settings.json"), "{not-json\n", {
      mode: 0o600,
    });
    let stdout = "";
    try {
      const exitCode = await main(
        ["node", "sharge", "doctor", "--json"],
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

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout);
      expect(envelope).toMatchObject({
        ok: true,
        command: "doctor",
        data: {
          healthy: false,
        },
      });
      expect(envelope.data.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "settings", status: "fail" }),
        ]),
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reports an unhealthy credential check and exits 3 without opening login", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-doctor-no-key-"));
    let stdout = "";
    try {
      const exitCode = await main(
        ["node", "sharge", "doctor", "--json"],
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
        ok: true,
        command: "doctor",
        data: {
          healthy: false,
          checks: expect.arrayContaining([
            {
              name: "credential",
              status: "fail",
              message: "尚未登录",
              nextActions: [{ command: "sharge login" }],
            },
          ]),
        },
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reports ordered local and Open Platform checks without mutating business data", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-doctor-"));
    const configDir = join(homeDir, ".sharge");
    await mkdir(configDir, { mode: 0o700 });
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-Id": `req_${requests.length}`,
      });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data:
            request.url === "/open-api/v1/auth/scopes"
              ? [{ scope: "calendar:read", granted: true }]
              : {
                  user_id: "user_doctor",
                  auth_type: "api_key",
                  scopes: ["calendar:read"],
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
        installationId: "install_doctor",
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "lms-doctor-secret",
        timezone: "Asia/Shanghai",
      })}\n`,
      { mode: 0o600 },
    );
    let stdout = "";
    try {
      const exitCode = await main(
        ["node", "sharge", "doctor", "--json"],
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
      expect(requests).toEqual([
        "/open-api/v1/auth/status",
        "/open-api/v1/auth/scopes",
      ]);
      expect(JSON.parse(stdout)).toMatchObject({
        command: "doctor",
        data: {
          healthy: true,
          checks: [
            { name: "runtime", status: "pass" },
            { name: "settings.directory", status: "pass" },
            { name: "settings", status: "pass" },
            { name: "settings.permissions", status: "pass" },
            { name: "config", status: "pass" },
            { name: "timezone", status: "pass" },
            { name: "credential", status: "pass" },
            { name: "logs", status: "pass" },
            { name: "network", status: "pass" },
            { name: "auth", status: "pass" },
            { name: "scopes", status: "pass" },
          ],
        },
        meta: {
          requestId: "req_2",
          timezone: "Asia/Shanghai",
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("keeps completed checks and reports an invalid credential as unhealthy", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-doctor-invalid-"));
    const configDir = join(homeDir, ".sharge");
    await mkdir(configDir, { mode: 0o700 });
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(401, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_doctor_invalid",
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
        installationId: "install_invalid",
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "lms-invalid-doctor",
      })}\n`,
      { mode: 0o600 },
    );
    let stdout = "";
    try {
      const exitCode = await main(
        ["node", "sharge", "doctor", "--json"],
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
      expect(requests).toBe(1);
      const envelope = JSON.parse(stdout);
      expect(envelope).toMatchObject({
        ok: true,
        data: { healthy: false },
      });
      expect(envelope.data.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "auth",
            status: "fail",
            nextActions: [{ command: "sharge login --force" }],
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

  it("keeps completed checks when the scopes request fails", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-doctor-scopes-"));
    const configDir = join(homeDir, ".sharge");
    await mkdir(configDir, { mode: 0o700 });
    let requests = 0;
    const server = createServer((request, response) => {
      requests += 1;
      if (request.url === "/open-api/v1/auth/scopes") {
        response.writeHead(503, {
          "Content-Type": "application/json",
          "X-Request-Id": "req_scopes_failed",
        });
        response.end(
          JSON.stringify({ code: 503, message: "Unavailable", data: null }),
        );
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_status_ok",
      });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: { user_id: "user_scopes" },
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
        installationId: "install_scopes_failure",
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "lms-scopes-failure",
      })}\n`,
      { mode: 0o600 },
    );
    let stdout = "";
    try {
      const exitCode = await main(
        ["node", "sharge", "doctor", "--json"],
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

      expect(requests).toBe(2);
      expect(exitCode).toBe(8);
      const envelope = JSON.parse(stdout);
      expect(envelope.data.healthy).toBe(false);
      expect(envelope.data.checks).toEqual(
        expect.arrayContaining([
          { name: "auth", status: "pass", message: "用户 user_scopes" },
          expect.objectContaining({ name: "scopes", status: "fail" }),
        ]),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("treats --timeout as one deadline across both network checks", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-doctor-deadline-"));
    const configDir = join(homeDir, ".sharge");
    await mkdir(configDir, { mode: 0o700 });
    const server = createServer((request, response) => {
      setTimeout(() => {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "X-Request-Id":
            request.url === "/open-api/v1/auth/scopes"
              ? "req_deadline_scopes"
              : "req_deadline_status",
        });
        response.end(
          JSON.stringify({
            code: 0,
            message: "ok",
            data:
              request.url === "/open-api/v1/auth/scopes"
                ? []
                : { user_id: "user_deadline" },
          }),
        );
      }, 700);
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
        installationId: "install_deadline",
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "lms-deadline-secret",
      })}\n`,
      { mode: 0o600 },
    );
    let stdout = "";
    const startedAt = performance.now();
    try {
      const exitCode = await main(
        ["node", "sharge", "doctor", "--json", "--timeout", "1s"],
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

      expect(exitCode).toBe(8);
      expect(performance.now() - startedAt).toBeLessThan(1_350);
      expect(JSON.parse(stdout).data.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "auth", status: "pass" }),
          expect.objectContaining({ name: "scopes", status: "fail" }),
        ]),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
