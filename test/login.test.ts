import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { browserCommand, type CliRuntime } from "../src/runtime/context.js";

const DEFAULT_SCOPES = [
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

async function requestBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
  }
  return JSON.parse(body);
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

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

describe("browser login happy path", () => {
  it("passes a complete Windows authorization URL as one explorer argument", () => {
    const url =
      "https://example.test/authorize?authorization_id=auth_1&user_code=ABCD-2345";

    expect(browserCommand("win32", url)).toEqual({
      file: "explorer.exe",
      arguments: [url],
    });
  });

  it("creates, polls, atomically saves, and keeps secrets out of JSON streams", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-login-happy-"));
    cleanupPaths.push(homeDir);
    const requests: Array<{
      path: string;
      authorization?: string;
      body: unknown;
    }> = [];
    let pollCount = 0;
    const server = await listen((request, response) => {
      void requestBody(request).then((body) => {
        requests.push({
          path: request.url ?? "",
          authorization: request.headers.authorization,
          body,
        });
        response.writeHead(request.url?.endsWith("/poll") ? 200 : 201, {
          "Content-Type": "application/json",
          "X-Request-Id": `req_${requests.length}`,
        });
        if (!request.url?.endsWith("/poll")) {
          response.end(
            JSON.stringify({
              code: 0,
              message: "ok",
              data: {
                authorization_id: "auth_happy",
                polling_token: "polling-super-secret",
                verification_uri:
                  "https://auth.example.test/open-platform/authorize",
                verification_uri_complete:
                  "https://auth.example.test/open-platform/authorize?authorization_id=auth_happy&user_code=D9TF-20X4",
                user_code: "D9TF-20X4",
                expires_in: 600,
                poll_interval: 2,
              },
            }),
          );
          return;
        }
        pollCount += 1;
        response.end(
          JSON.stringify({
            code: 0,
            message: "ok",
            data:
              pollCount === 1
                ? { status: "pending" }
                : {
                    status: "approved",
                    key: "lms-login-new-secret",
                    key_id: 91,
                    scopes: DEFAULT_SCOPES,
                    expires_at: "2027-07-31T00:00:00Z",
                  },
          }),
        );
      });
    });
    const waits: number[] = [];
    const runtime: CliRuntime = {
      env: {},
      homeDir,
      cwd: homeDir,
      platform: process.platform,
      deviceName: "test-device",
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    };
    const configDir = join(homeDir, ".sharge");
    await mkdir(configDir, { mode: 0o700 });
    await writeFile(
      join(configDir, "settings.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_happy",
        baseUrl: server.baseUrl,
        timezone: "Asia/Shanghai",
      })}\n`,
      { mode: 0o600 },
    );
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "login", "--no-browser", "--json"],
        runtime,
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(waits).toEqual([2_000, 2_000]);
      expect(requests).toHaveLength(3);
      expect(requests[0]).toMatchObject({
        path: "/ai/open-platform/cli-authorizations",
        authorization: undefined,
        body: {
          client_id: "sharge-cli",
          installation_id: "install_happy",
          client_info: {
            device_name: "test-device",
          },
          scopes: DEFAULT_SCOPES,
        },
      });
      expect(
        Object.keys(
          (
            requests[0]?.body as {
              client_info: Record<string, unknown>;
            }
          ).client_info,
        ).sort(),
      ).toEqual(["arch", "device_name", "os", "version"]);
      expect(requests[1]).toMatchObject({
        path: "/ai/open-platform/cli-authorizations/auth_happy/poll",
        authorization: undefined,
        body: { polling_token: "polling-super-secret" },
      });

      const output = JSON.parse(capture.stdout());
      expect(output).toMatchObject({
        ok: true,
        command: "login",
        data: {
          changed: true,
          keyId: 91,
          scopes: DEFAULT_SCOPES,
          expiresAt: "2027-07-31T00:00:00Z",
        },
      });
      expect(capture.stdout()).not.toContain("lms-login-new-secret");
      expect(capture.stdout()).not.toContain("polling-super-secret");
      const events = capture
        .stderr()
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events.map((event) => event.event)).toEqual([
        "authorization.created",
        "authorization.pending",
        "credential.saved",
        "authorization.approved",
      ]);
      expect(events[0]).toMatchObject({
        authorizationId: "auth_happy",
        userCode: "D9TF-20X4",
        verificationUriComplete:
          "https://auth.example.test/open-platform/authorize?authorization_id=auth_happy&user_code=D9TF-20X4",
        expiresIn: 600,
      });
      expect(capture.stderr()).not.toContain("lms-login-new-secret");
      expect(capture.stderr()).not.toContain("polling-super-secret");

      const settingsPath = join(configDir, "settings.json");
      const settings = JSON.parse(await readFile(settingsPath, "utf8"));
      expect(settings).toMatchObject({
        schemaVersion: 1,
        installationId: "install_happy",
        baseUrl: server.baseUrl,
        apiKey: "lms-login-new-secret",
      });
      if (process.platform !== "win32") {
        expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await server.close();
    }
  });

  it("opens the complete server URL by default and never needs terminal input", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-login-browser-"));
    cleanupPaths.push(homeDir);
    const opened: string[] = [];
    const server = await listen((request, response) => {
      void requestBody(request).then(() => {
        response.writeHead(request.url?.endsWith("/poll") ? 200 : 201, {
          "Content-Type": "application/json",
        });
        response.end(
          JSON.stringify({
            code: 0,
            message: "ok",
            data: request.url?.endsWith("/poll")
              ? {
                  status: "approved",
                  key: "lms-browser-secret",
                  key_id: 92,
                  scopes: DEFAULT_SCOPES,
                  expires_at: null,
                }
              : {
                  authorization_id: "auth_browser",
                  polling_token: "poll-browser-secret",
                  verification_uri: "https://example.test/authorize",
                  verification_uri_complete:
                    "https://example.test/authorize?authorization_id=auth_browser&user_code=ABCD-2345",
                  user_code: "ABCD-2345",
                  expires_in: 600,
                  poll_interval: 1,
                },
          }),
        );
      });
    });
    await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
    await writeFile(
      join(homeDir, ".sharge", "settings.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_browser",
        baseUrl: server.baseUrl,
      })}\n`,
      { mode: 0o600 },
    );
    const runtime: CliRuntime = {
      env: {},
      homeDir,
      cwd: homeDir,
      platform: process.platform,
      openExternal: async (url) => {
        opened.push(url);
        return true;
      },
      sleep: async () => {},
    };
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "login"],
        runtime,
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(opened).toEqual([
        "https://example.test/authorize?authorization_id=auth_browser&user_code=ABCD-2345",
      ]);
      expect(capture.stdout()).toContain("登录完成");
      expect(capture.stderr()).toContain(
        "https://example.test/authorize?authorization_id=auth_browser&user_code=ABCD-2345",
      );
      expect(capture.stderr()).toContain("核对码：ABCD-2345");
      expect(capture.stderr()).toContain("已尝试在默认浏览器中打开授权页面");
    } finally {
      await server.close();
    }
  });

  it("is idempotent when the settings credential already covers target scopes", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-login-idempotent-"));
    cleanupPaths.push(homeDir);
    let requests = 0;
    const server = await listen((_request, response) => {
      requests += 1;
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_existing",
      });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: {
            user_id: "user_existing",
            scopes: DEFAULT_SCOPES,
          },
        }),
      );
    });
    await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
    await writeFile(
      join(homeDir, ".sharge", "settings.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_existing",
        baseUrl: server.baseUrl,
        apiKey: "lms-existing-secret",
      })}\n`,
      { mode: 0o600 },
    );
    let browserCalls = 0;
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "login", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          openExternal: async () => {
            browserCalls += 1;
            return true;
          },
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requests).toBe(1);
      expect(browserCalls).toBe(0);
      expect(capture.stderr()).toBe("");
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "login",
        data: {
          changed: false,
          scopes: DEFAULT_SCOPES,
        },
        meta: {
          requestId: "req_existing",
        },
      });
    } finally {
      await server.close();
    }
  });

  it("redacts the polling token if a server error message echoes it", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-login-redact-"));
    cleanupPaths.push(homeDir);
    const pollingToken = "polling-token-that-must-never-be-rendered";
    const server = await listen((request, response) => {
      void requestBody(request).then(() => {
        response.writeHead(request.url?.endsWith("/poll") ? 400 : 201, {
          "Content-Type": "application/json",
        });
        response.end(
          JSON.stringify(
            request.url?.endsWith("/poll")
              ? {
                  code: 400,
                  message: `invalid ${pollingToken}`,
                  data: null,
                }
              : {
                  code: 0,
                  message: "ok",
                  data: {
                    authorization_id: "auth_redact",
                    polling_token: pollingToken,
                    verification_uri: "https://example.test/authorize",
                    verification_uri_complete:
                      "https://example.test/authorize?authorization_id=auth_redact&user_code=SAFE-2345",
                    user_code: "SAFE-2345",
                    expires_in: 600,
                    poll_interval: 1,
                  },
                },
          ),
        );
      });
    });
    await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
    await writeFile(
      join(homeDir, ".sharge", "settings.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_redact",
        baseUrl: server.baseUrl,
      })}\n`,
      { mode: 0o600 },
    );
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

      expect(exitCode).toBe(2);
      expect(capture.stdout()).not.toContain(pollingToken);
      expect(capture.stderr()).not.toContain(pollingToken);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: false,
        error: {
          type: "INVALID_INPUT",
          message: expect.stringContaining("[REDACTED]"),
        },
      });
    } finally {
      await server.close();
    }
  });

  it("does not report success when the one-time key cannot be atomically saved", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-login-save-fail-"));
    cleanupPaths.push(homeDir);
    const runtime: CliRuntime = {
      env: {},
      homeDir,
      cwd: homeDir,
      platform: process.platform,
      sleep: async () => {},
    };
    const server = await listen((request, response) => {
      void requestBody(request).then(() => {
        const polling = request.url?.endsWith("/poll") ?? false;
        if (polling) {
          runtime.env.SHARGE_INTERNAL_TEST_FAIL_SETTINGS_RENAME = "1";
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
                  key: "lms-claimed-but-unsaved-secret",
                  key_id: 93,
                  scopes: DEFAULT_SCOPES,
                  expires_at: null,
                }
              : {
                  authorization_id: "auth_save_fail",
                  polling_token: "poll-save-fail-secret",
                  verification_uri: "https://example.test/authorize",
                  verification_uri_complete:
                    "https://example.test/authorize?authorization_id=auth_save_fail&user_code=FAIL-2345",
                  user_code: "FAIL-2345",
                  expires_in: 600,
                  poll_interval: 1,
                },
          }),
        );
      });
    });
    const configDir = join(homeDir, ".sharge");
    const settingsPath = join(configDir, "settings.json");
    await mkdir(configDir, { mode: 0o700 });
    const originalSettings = {
      schemaVersion: 1,
      installationId: "install_save_fail",
      baseUrl: server.baseUrl,
      timezone: "Asia/Shanghai",
    };
    await writeFile(settingsPath, `${JSON.stringify(originalSettings)}\n`, {
      mode: 0o600,
    });
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "login", "--no-browser", "--json"],
        runtime,
        capture.io,
      );

      expect(exitCode).toBe(1);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: false,
        command: "login",
        error: { type: "INTERNAL_ERROR" },
      });
      expect(capture.stdout()).not.toContain("lms-claimed-but-unsaved-secret");
      expect(capture.stderr()).not.toContain("lms-claimed-but-unsaved-secret");
      expect(capture.stderr()).not.toContain("credential.saved");
      expect(capture.stderr()).not.toContain("authorization.approved");
      expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual(
        originalSettings,
      );
      expect(
        (await readdir(configDir)).some((name) => name.includes(".tmp-")),
      ).toBe(false);
    } finally {
      delete runtime.env.SHARGE_INTERNAL_TEST_FAIL_SETTINGS_RENAME;
      await server.close();
    }
  });
});

describe("logout", () => {
  it("removes file credentials locally but preserves installation and configuration", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-logout-"));
    cleanupPaths.push(homeDir);
    await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
    const settingsPath = join(homeDir, ".sharge", "settings.json");
    await writeFile(
      settingsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_logout",
        baseUrl: "https://ai.shargetech.com",
        timezone: "Asia/Shanghai",
        apiKey: "lms-active-secret",
        previousCredential: {
          baseUrl: "https://auth.example.test",
          apiKey: "lms-previous-secret",
        },
      })}\n`,
      { mode: 0o600 },
    );
    const capture = captureIo();

    const exitCode = await main(
      ["node", "sharge", "logout", "--json"],
      {
        env: { SHARGE_API_KEY: "lms-env-still-active" },
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      ok: true,
      command: "logout",
      data: {
        changed: true,
        settingsCredentialRemoved: true,
        previousCredentialRemoved: true,
        environmentCredentialActive: true,
      },
      warnings: [
        {
          type: "ENVIRONMENT_CREDENTIAL_ACTIVE",
          message: "SHARGE_API_KEY 环境变量仍然有效；logout 只删除文件凭证。",
          nextActions: [
            {
              description: "清除当前 shell 中的环境变量凭证",
              command: "unset SHARGE_API_KEY",
            },
          ],
        },
      ],
    });
    expect(capture.stdout()).not.toContain("lms-active-secret");
    expect(capture.stdout()).not.toContain("lms-previous-secret");
    expect(capture.stdout()).not.toContain("lms-env-still-active");
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
      schemaVersion: 1,
      installationId: "install_logout",
      baseUrl: "https://ai.shargetech.com",
      timezone: "Asia/Shanghai",
    });
  });
});
