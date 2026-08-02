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
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-write-"));
  cleanupPaths.push(homeDir);
  await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
  await writeFile(
    join(homeDir, ".sharge", "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_notes_write",
      baseUrl,
      apiKey: "lms-notes-write-secret",
    })}\n`,
    { mode: 0o600 },
  );
  return homeDir;
}

describe("notes write commands", () => {
  it("builds a validated update dry-run plan without credentials or network", async () => {
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
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-write-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "update",
          "123",
          "--input",
          '{"title":"新的标题"}',
          "--dry-run",
          "--json",
        ],
        {
          env: {
            SHARGE_BASE_URL: `http://127.0.0.1:${address.port}`,
            SHARGE_TIMEZONE: "Asia/Shanghai",
          },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requests).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "notes.update",
        data: {
          method: "PATCH",
          url: `http://127.0.0.1:${address.port}/open-api/v1/user-memory/quick-notes/123`,
          path: "/open-api/v1/user-memory/quick-notes/123",
          body: { title: "新的标题" },
          requiredScopes: ["quick_notes:write"],
          sideEffects: ["update_quick_note", "update_related_calendar_events"],
          retrySafe: false,
          unverified: ["resource_exists", "resource_owned_by_current_user"],
        },
        meta: { requestId: null },
      });
      expect(capture.stderr()).toBe("");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("loads @file input relative to cwd and preserves explicit null", async () => {
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
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-file-"));
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-file-cwd-"));
    cleanupPaths.push(homeDir, cwd);
    await writeFile(
      join(cwd, "update.json"),
      '{"title":null,"content":"来自文件"}\n',
    );
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "update",
          "123",
          "--input",
          "@update.json",
          "--dry-run",
          "--json",
        ],
        {
          env: {
            SHARGE_BASE_URL: `http://127.0.0.1:${address.port}`,
            SHARGE_TIMEZONE: "Asia/Shanghai",
          },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requests).toBe(0);
      expect(JSON.parse(capture.stdout()).data.body).toEqual({
        title: null,
        content: "来自文件",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("reads stdin only when --input - is explicit", async () => {
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
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-stdin-"));
    cleanupPaths.push(homeDir);
    let stdinReads = 0;

    try {
      const flagsCapture = captureIo();
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "update",
            "123",
            "--title",
            "flags title",
            "--dry-run",
            "--json",
          ],
          {
            env: {
              SHARGE_BASE_URL: `http://127.0.0.1:${address.port}`,
              SHARGE_TIMEZONE: "Asia/Shanghai",
            },
            homeDir,
            cwd: homeDir,
            platform: process.platform,
            readStdin: async () => {
              stdinReads += 1;
              throw new Error("unexpected stdin read");
            },
          },
          flagsCapture.io,
        ),
      ).toBe(0);

      const stdinCapture = captureIo();
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "update",
            "123",
            "--input",
            "-",
            "--dry-run",
            "--json",
          ],
          {
            env: {
              SHARGE_BASE_URL: `http://127.0.0.1:${address.port}`,
              SHARGE_TIMEZONE: "Asia/Shanghai",
            },
            homeDir,
            cwd: homeDir,
            platform: process.platform,
            readStdin: async () => {
              stdinReads += 1;
              return '{"content":"来自 stdin"}';
            },
          },
          stdinCapture.io,
        ),
      ).toBe(0);

      expect(stdinReads).toBe(1);
      expect(requests).toBe(0);
      expect(JSON.parse(flagsCapture.stdout()).data.body).toEqual({
        title: "flags title",
      });
      expect(JSON.parse(stdinCapture.stdout()).data.body).toEqual({
        content: "来自 stdin",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects mixed business flags and --input before network access", async () => {
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
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-mixed-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "update",
          "123",
          "--title",
          "flags title",
          "--input",
          '{"content":"input content"}',
          "--dry-run",
          "--json",
        ],
        {
          env: {
            SHARGE_BASE_URL: `http://127.0.0.1:${address.port}`,
            SHARGE_TIMEZONE: "Asia/Shanghai",
          },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(2);
      expect(requests).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "INVALID_INPUT",
          field: "--input",
          nextActions: [{ command: "sharge notes update --help --json" }],
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("reports the JSON path, expected field set, and actual type for unknown input", async () => {
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
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-schema-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "update",
          "123",
          "--input",
          '{"title":"ok","unexpected":42}',
          "--dry-run",
          "--json",
        ],
        {
          env: {
            SHARGE_BASE_URL: `http://127.0.0.1:${address.port}`,
            SHARGE_TIMEZONE: "Asia/Shanghai",
          },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(2);
      expect(requests).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "INVALID_INPUT",
          field: "--input",
          path: "$.unexpected",
          expected: "known field: title or content",
          actual: "number",
          nextActions: [{ command: "sharge notes update --help --json" }],
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("reports the exact path and type mismatch for a known input field", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-type-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "notes",
        "update",
        "123",
        "--input",
        '{"title":42}',
        "--dry-run",
        "--json",
      ],
      {
        env: {
          SHARGE_BASE_URL: "http://127.0.0.1:1",
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      error: {
        type: "INVALID_INPUT",
        field: "--input",
        path: "$.title",
        expected: "string",
        actual: "number",
      },
      meta: { requestId: null },
    });
  });

  it("rejects an update with no title or content", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-empty-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "notes",
        "update",
        "123",
        "--input",
        "{}",
        "--dry-run",
        "--json",
      ],
      {
        env: {
          SHARGE_BASE_URL: "http://127.0.0.1:1",
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      error: {
        type: "INVALID_INPUT",
        field: "--input",
        path: "$",
        expected: "at least one of: title or content",
        actual: "object",
      },
    });
  });

  it("reports malformed JSON as a precise local input error", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-json-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "notes",
        "update",
        "123",
        "--input",
        '{"title":',
        "--dry-run",
        "--json",
      ],
      {
        env: {
          SHARGE_BASE_URL: "http://127.0.0.1:1",
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      error: {
        type: "INVALID_INPUT",
        field: "--input",
        path: "$",
        expected: "valid JSON",
        actual: "invalid JSON",
      },
    });
  });

  it("generates a raw offline update template without credentials", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-template-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      ["node", "sharge", "notes", "update", "123", "--generate-input"],
      {
        env: {},
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(capture.stdout()).toBe('{\n  "title": "",\n  "content": ""\n}\n');
    expect(capture.stderr()).toBe("");
  });

  it("rejects --generate-input when combined with JSON output", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-template-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "notes",
        "update",
        "123",
        "--generate-input",
        "--json",
      ],
      {
        env: {},
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      error: {
        type: "INVALID_INPUT",
        field: "--generate-input",
      },
    });
  });

  it("sends one authenticated PATCH and preserves the backend DTO", async () => {
    const requests: Array<{
      method: string | undefined;
      url: string | undefined;
      authorization: string | undefined;
      clientDate: string | undefined;
      userAgent: string | undefined;
      body: string;
    }> = [];
    const note = {
      id: 123,
      title: "新标题",
      content: null,
      status: "success",
      future_backend_field: { preserved: true },
    };
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        requests.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          clientDate: request.headersDistinct["x-client-date"]?.[0],
          userAgent: request.headers["user-agent"],
          body,
        });
        response.writeHead(200, {
          "Content-Type": "application/json",
          "X-Request-Id": "req_notes_update",
        });
        response.end(JSON.stringify({ code: 0, message: "ok", data: note }));
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
          "notes",
          "update",
          "123",
          "--input",
          '{"title":"新标题","content":null}',
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        method: "PATCH",
        url: "/open-api/v1/user-memory/quick-notes/123",
        authorization: "Bearer lms-notes-write-secret",
        body: '{"title":"新标题","content":null}',
      });
      expect(requests[0].clientDate).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/,
      );
      expect(requests[0].userAgent).toContain("sharge-cli/");
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "notes.update",
        data: note,
        meta: {
          requestId: "req_notes_update",
          timezone: "Asia/Shanghai",
        },
      });
      expect(capture.stderr()).toBe("");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("does not resend an update when the write outcome is unknown", async () => {
    let requests = 0;
    const server = createServer((_request, _response) => {
      requests += 1;
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
          "notes",
          "update",
          "123",
          "--title",
          "可能已更新",
          "--timeout",
          "1s",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(8);
      expect(requests).toBe(1);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: false,
        command: "notes.update",
        error: {
          type: "TIMEOUT",
          retryable: false,
          outcome: "unknown",
          nextActions: [{ command: "sharge notes get 123 --json" }],
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("builds a delete dry-run plan without --yes, credentials, or network", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-delete-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      ["node", "sharge", "notes", "delete", "123", "--dry-run", "--json"],
      {
        env: {
          SHARGE_BASE_URL: "http://127.0.0.1:1",
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      ok: true,
      command: "notes.delete",
      data: {
        method: "DELETE",
        url: "http://127.0.0.1:1/open-api/v1/user-memory/quick-notes/123",
        path: "/open-api/v1/user-memory/quick-notes/123",
        body: null,
        requiredScopes: ["quick_notes:write"],
        sideEffects: ["delete_quick_note", "delete_related_calendar_events"],
        retrySafe: false,
        unverified: ["resource_exists", "resource_owned_by_current_user"],
      },
    });
  });

  it("rejects a real delete without --yes before network access", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-delete-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      ["node", "sharge", "notes", "delete", "123", "--json"],
      {
        env: {
          SHARGE_API_KEY: "lms-notes-write-secret",
          SHARGE_BASE_URL: "http://127.0.0.1:1",
        },
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      error: {
        type: "INVALID_INPUT",
        field: "--yes",
        nextActions: [{ command: "sharge notes delete 123 --yes --json" }],
      },
    });
  });

  it("sends one confirmed DELETE and returns null data", async () => {
    const requests: Array<{
      method: string | undefined;
      url: string | undefined;
      authorization: string | undefined;
    }> = [];
    const server = createServer((request, response) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
      });
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_notes_delete",
      });
      response.end(JSON.stringify({ code: 0, message: "ok", data: null }));
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
        ["node", "sharge", "notes", "delete", "123", "--yes", "--json"],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requests).toEqual([
        {
          method: "DELETE",
          url: "/open-api/v1/user-memory/quick-notes/123",
          authorization: "Bearer lms-notes-write-secret",
        },
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "notes.delete",
        data: null,
        meta: {
          requestId: "req_notes_delete",
          timezone: "Asia/Shanghai",
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("fully describes the Notes write surface offline", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-help-"));
    cleanupPaths.push(homeDir);
    const runtime = {
      env: {},
      homeDir,
      cwd: homeDir,
      platform: process.platform,
    };

    const namespace = captureIo();
    expect(
      await main(
        ["node", "sharge", "notes", "--help", "--json"],
        runtime,
        namespace.io,
      ),
    ).toBe(0);
    expect(JSON.parse(namespace.stdout()).data.commands).toEqual(
      expect.arrayContaining([
        {
          command: "notes.update",
          path: ["notes", "update"],
          description: "修改 Quick Note 的标题和/或正文",
        },
        {
          command: "notes.delete",
          path: ["notes", "delete"],
          description: "不可恢复地删除一条 Quick Note",
        },
      ]),
    );

    const updateHelp = captureIo();
    expect(
      await main(
        ["node", "sharge", "notes", "update", "--help", "--json"],
        runtime,
        updateHelp.io,
      ),
    ).toBe(0);
    expect(JSON.parse(updateHelp.stdout()).data).toMatchObject({
      command: "notes.update",
      requiredScopes: ["quick_notes:write"],
      network: true,
      destructive: false,
      dryRun: true,
      retrySafe: false,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          title: { anyOf: [{ type: "string" }, { type: "null" }] },
          content: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
      examples: [
        "sharge notes update 123 --title '新标题' --json",
        "sharge notes update 123 --input @update.json --dry-run --json",
        "sharge notes update 123 --generate-input",
      ],
    });
    expect(JSON.parse(updateHelp.stdout()).data.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "--input",
          exclusiveWith: ["--title", "--content", "--generate-input"],
        }),
        expect.objectContaining({
          name: "--generate-input",
          exclusiveWith: ["--title", "--content", "--input", "--json", "--jq"],
        }),
      ]),
    );

    const deleteHelp = captureIo();
    expect(
      await main(
        ["node", "sharge", "notes", "delete", "--help", "--json"],
        runtime,
        deleteHelp.io,
      ),
    ).toBe(0);
    expect(JSON.parse(deleteHelp.stdout()).data).toMatchObject({
      command: "notes.delete",
      requiredScopes: ["quick_notes:write"],
      network: true,
      destructive: true,
      dryRun: true,
      retrySafe: false,
      inputSchema: null,
      outputSchema: {
        anyOf: [{ type: "null" }, expect.any(Object)],
      },
      examples: [
        "sharge notes delete 123 --yes --json",
        "sharge notes delete 123 --dry-run --json",
      ],
    });
  });

  it("does not validate configured credentials during update or delete dry run", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-dry-auth-"));
    cleanupPaths.push(homeDir);
    await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
    await writeFile(
      join(homeDir, ".sharge", "settings.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_dry_invalid_key",
        apiKey: "invalid-settings-key",
      })}\n`,
      { mode: 0o600 },
    );
    const runtime = {
      env: {
        SHARGE_API_KEY: "this-is-not-an-api-key",
        SHARGE_BASE_URL: "https://ai.shargetech.com",
        SHARGE_TIMEZONE: "Asia/Shanghai",
      },
      homeDir,
      cwd: homeDir,
      platform: process.platform,
    };

    const updateCapture = captureIo();
    expect(
      await main(
        [
          "node",
          "sharge",
          "notes",
          "update",
          "123",
          "--title",
          "dry only",
          "--dry-run",
          "--json",
        ],
        runtime,
        updateCapture.io,
      ),
    ).toBe(0);
    expect(JSON.parse(updateCapture.stdout()).ok).toBe(true);

    const deleteCapture = captureIo();
    expect(
      await main(
        ["node", "sharge", "notes", "delete", "123", "--dry-run", "--json"],
        runtime,
        deleteCapture.io,
      ),
    ).toBe(0);
    expect(JSON.parse(deleteCapture.stdout()).ok).toBe(true);
  });

  it("prints every dry-run plan field in text mode", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-dry-text-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "notes",
        "update",
        "123",
        "--title",
        "text plan",
        "--dry-run",
      ],
      {
        env: {
          SHARGE_BASE_URL: "https://ai.shargetech.com",
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(0);
    for (const expected of [
      "method: PATCH",
      "url: https://ai.shargetech.com/open-api/v1/user-memory/quick-notes/123",
      "path: /open-api/v1/user-memory/quick-notes/123",
      'body: {"title":"text plan"}',
      "requiredScopes: quick_notes:write",
      "sideEffects: update_quick_note, update_related_calendar_events",
      "retrySafe: false",
      "unverified: resource_exists, resource_owned_by_current_user",
      "未发送网络请求。",
    ]) {
      expect(capture.stdout()).toContain(expected);
    }
  });

  it("rejects credential-bearing base URLs without echoing credentials", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-dry-url-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "notes",
        "update",
        "123",
        "--title",
        "dry only",
        "--dry-run",
        "--json",
      ],
      {
        env: {
          SHARGE_BASE_URL: "https://dry-user:dry-pass@example.com",
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      error: {
        type: "INVALID_INPUT",
        field: "baseUrl",
      },
    });
    expect(capture.stdout()).not.toContain("dry-user");
    expect(capture.stdout()).not.toContain("dry-pass");
    expect(capture.stderr()).not.toContain("dry-user");
    expect(capture.stderr()).not.toContain("dry-pass");
  });

  it("does not resend a confirmed delete when its outcome is unknown", async () => {
    let requests = 0;
    const server = createServer((_request, _response) => {
      requests += 1;
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
          "notes",
          "delete",
          "123",
          "--yes",
          "--timeout",
          "1s",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(8);
      expect(requests).toBe(1);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: false,
        command: "notes.delete",
        error: {
          type: "TIMEOUT",
          retryable: false,
          outcome: "unknown",
          nextActions: [{ command: "sharge notes get 123 --json" }],
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
