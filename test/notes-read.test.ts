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
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-read-"));
  cleanupPaths.push(homeDir);
  await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
  await writeFile(
    join(homeDir, ".sharge", "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_notes_read",
      baseUrl,
      apiKey: "lms-notes-read-secret",
    })}\n`,
    { mode: 0o600 },
  );
  return homeDir;
}

describe("notes read commands", () => {
  it("requests exactly one list page and preserves the backend DTO", async () => {
    const requestedUrls: string[] = [];
    const page = {
      items: [
        {
          id: 102,
          title: "第二条",
          content: "正文",
          status: "success",
          location: null,
          longitude: null,
          latitude: null,
          has_calendar_events: false,
          available_media_types: [],
          media_downloads: {},
          matched_fields: [],
          matched_title: null,
          matched_content: null,
          created_at: "2026-07-31T04:00:00Z",
          updated_at: "2026-07-31T04:00:00Z",
          future_backend_field: { preserved: true },
        },
      ],
      has_more: true,
      next_cursor: 102,
      future_page_field: "preserved",
    };
    const server = createServer((request, response) => {
      requestedUrls.push(request.url ?? "");
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_notes_list",
      });
      response.end(JSON.stringify({ code: 0, message: "ok", data: page }));
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
        ["node", "sharge", "notes", "list", "--limit", "1", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requestedUrls).toEqual([
        "/open-api/v1/user-memory/quick-notes?limit=1",
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "notes.list",
        data: page,
        meta: { requestId: "req_notes_list" },
      });
      expect(capture.stderr()).toBe("");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("passes cursor and time filters once and prints a copyable next-page command", async () => {
    const requestedUrls: string[] = [];
    const server = createServer((request, response) => {
      requestedUrls.push(request.url ?? "");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: {
            items: [
              {
                id: 99,
                title: "分页闪记",
                content: null,
                status: "success",
                location: null,
                longitude: null,
                latitude: null,
                has_calendar_events: false,
                available_media_types: [],
                media_downloads: {},
                matched_fields: [],
                matched_title: null,
                matched_content: null,
                created_at: "2026-07-15T04:00:00Z",
                updated_at: "2026-07-15T04:00:00Z",
              },
            ],
            has_more: true,
            next_cursor: 99,
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
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "list",
          "--cursor",
          "120",
          "--limit",
          "1",
          "--created-at-start",
          "2026-07-01T00:00:00+08:00",
          "--created-at-end",
          "2026-08-01T00:00:00+08:00",
        ],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requestedUrls).toEqual([
        "/open-api/v1/user-memory/quick-notes?cursor=120&limit=1&created_at_start=2026-07-01T00%3A00%3A00%2B08%3A00&created_at_end=2026-08-01T00%3A00%3A00%2B08%3A00",
      ]);
      expect(capture.stdout()).toContain("#99 分页闪记 [success]");
      expect(capture.stdout()).toContain(
        "下一页：sharge notes list --cursor 99 --limit 1 --created-at-start '2026-07-01T00:00:00+08:00' --created-at-end '2026-08-01T00:00:00+08:00'",
      );
      expect(capture.stderr()).toBe("");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("preserves unsafe integer Note IDs and cursors as exact decimal strings", async () => {
    const requestedUrls: string[] = [];
    const server = createServer((request, response) => {
      requestedUrls.push(request.url ?? "");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        '{"code":0,"message":"ok","data":{"items":[{"id":9007199254740993,"title":"大 ID 闪记","content":"正文","status":"success","location":null,"longitude":null,"latitude":null,"has_calendar_events":false,"available_media_types":[],"media_downloads":{},"matched_fields":[],"matched_title":null,"matched_content":null,"created_at":"2026-07-15T04:00:00Z","updated_at":"2026-07-15T04:00:00Z"}],"has_more":true,"next_cursor":9007199254740993}}',
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
    const jsonCapture = captureIo();
    const textCapture = captureIo();

    try {
      expect(
        await main(
          ["node", "sharge", "notes", "list", "--limit", "1", "--json"],
          {
            env: {},
            homeDir,
            cwd: homeDir,
            platform: process.platform,
          },
          jsonCapture.io,
        ),
      ).toBe(0);
      expect(
        await main(
          ["node", "sharge", "notes", "list", "--limit", "1"],
          {
            env: {},
            homeDir,
            cwd: homeDir,
            platform: process.platform,
          },
          textCapture.io,
        ),
      ).toBe(0);

      const envelope = JSON.parse(jsonCapture.stdout());
      expect(envelope.data.items[0].id).toBe("9007199254740993");
      expect(envelope.data.next_cursor).toBe("9007199254740993");
      expect(textCapture.stdout()).toContain(
        "下一页：sharge notes list --cursor 9007199254740993 --limit 1",
      );
      expect(requestedUrls).toEqual([
        "/open-api/v1/user-memory/quick-notes?limit=1",
        "/open-api/v1/user-memory/quick-notes?limit=1",
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects an out-of-range page limit before using the network", async () => {
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
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "notes", "list", "--limit", "101", "--json"],
        {
          env: {},
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
          field: "--limit",
          nextActions: [{ command: "sharge notes list --help --json" }],
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects a non-integer cursor before using the network", async () => {
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
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "notes", "list", "--cursor", "1.5", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(2);
      expect(requests).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: { type: "INVALID_INPUT", field: "--cursor" },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects a datetime filter without an explicit offset", async () => {
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
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "list",
          "--created-at-start",
          "2026-07-01T00:00:00",
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
      expect(requests).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: { type: "INVALID_INPUT", field: "--created-at-start" },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects a reversed creation-time range before using the network", async () => {
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
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "list",
          "--created-at-start",
          "2026-08-01T00:00:00+08:00",
          "--created-at-end",
          "2026-07-01T00:00:00+08:00",
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
      expect(requests).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: { type: "INVALID_INPUT", field: "--created-at-start" },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("exposes search as a separate intent over one backend list page", async () => {
    const requestedUrls: string[] = [];
    const page = {
      items: [
        {
          id: 88,
          title: "发布计划",
          content: "正文",
          status: "success",
          location: null,
          longitude: null,
          latitude: null,
          has_calendar_events: false,
          available_media_types: [],
          media_downloads: {},
          matched_fields: ["title"],
          matched_title: "<mark>发布计划</mark>",
          matched_content: null,
          created_at: "2026-07-15T04:00:00Z",
          updated_at: "2026-07-15T04:00:00Z",
          future_search_field: "preserved",
        },
      ],
      has_more: true,
      next_cursor: 88,
    };
    const server = createServer((request, response) => {
      requestedUrls.push(request.url ?? "");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ code: 0, message: "ok", data: page }));
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
          "search",
          "发布 计划",
          "--limit",
          "1",
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

      expect(exitCode).toBe(0);
      expect(requestedUrls).toEqual([
        "/open-api/v1/user-memory/quick-notes?limit=1&search=%E5%8F%91%E5%B8%83+%E8%AE%A1%E5%88%92",
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "notes.search",
        data: page,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects a blank search query before using the network", async () => {
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
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "notes", "search", "   ", "--json"],
        {
          env: {},
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
          field: "query",
          nextActions: [{ command: "sharge notes search --help --json" }],
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("points invalid search filters to the search contract", async () => {
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
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "search",
          "发布计划",
          "--limit",
          "101",
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
      expect(requests).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "INVALID_INPUT",
          field: "--limit",
          nextActions: [{ command: "sharge notes search --help --json" }],
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("gets one Quick Note by positive ID and preserves the detail DTO", async () => {
    const requestedUrls: string[] = [];
    const note = {
      id: 77,
      title: "详情闪记",
      content: "完整正文",
      status: "success",
      location: "上海",
      longitude: 121.47,
      latitude: 31.23,
      has_calendar_events: true,
      available_media_types: ["image"],
      media_downloads: {
        image: "/open-api/v1/user-memory/quick-notes/77/media/image/download",
      },
      matched_fields: [],
      matched_title: null,
      matched_content: null,
      created_at: "2026-07-15T04:00:00Z",
      updated_at: "2026-07-16T04:00:00Z",
      future_detail_field: ["preserved"],
    };
    const server = createServer((request, response) => {
      requestedUrls.push(request.url ?? "");
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_notes_get",
      });
      response.end(JSON.stringify({ code: 0, message: "ok", data: note }));
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
        ["node", "sharge", "notes", "get", "77", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requestedUrls).toEqual([
        "/open-api/v1/user-memory/quick-notes/77",
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "notes.get",
        data: note,
        meta: { requestId: "req_notes_get" },
      });
      expect(capture.stderr()).toBe("");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects a non-positive Note ID before using the network", async () => {
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
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "notes", "get", "0", "--json"],
        {
          env: {},
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
          field: "note-id",
          nextActions: [{ command: "sharge notes get --help --json" }],
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("maps missing or cross-user Note details to NOT_FOUND with recovery", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(404, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_notes_missing",
      });
      response.end(
        JSON.stringify({
          code: 404,
          message: "Quick note not found",
          data: null,
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
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "notes", "get", "404", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(5);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "NOT_FOUND",
          retryable: false,
          nextActions: [
            {
              description: "重新列出当前用户的 Quick Note",
              command: "sharge notes list --json",
            },
          ],
        },
        meta: { requestId: "req_notes_missing", httpStatus: 404 },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("turns a scope denial into a complete current-union-required login command", async () => {
    const requestedUrls: string[] = [];
    const server = createServer((request, response) => {
      const url = request.url ?? "";
      requestedUrls.push(url);
      if (url === "/open-api/v1/auth/status") {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "X-Request-Id": "req_scope_status",
        });
        response.end(
          JSON.stringify({
            code: 0,
            message: "ok",
            data: { scopes: ["calendar:read"] },
          }),
        );
        return;
      }
      response.writeHead(403, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_notes_scope",
        "WWW-Authenticate": 'Bearer scope="quick_notes:read"',
      });
      response.end(
        JSON.stringify({
          code: 403,
          message: "Insufficient scope",
          data: null,
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
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "notes", "list", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(4);
      expect(requestedUrls).toEqual([
        "/open-api/v1/user-memory/quick-notes",
        "/open-api/v1/auth/status",
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "SCOPE_REQUIRED",
          requiredScopes: ["quick_notes:read"],
          nextActions: [
            {
              command:
                "sharge login --scope quick_notes:read --scope calendar:read",
            },
          ],
        },
        meta: { requestId: "req_notes_scope", httpStatus: 403 },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("uses one total timeout budget for the command and scope recovery", async () => {
    const requestedUrls: string[] = [];
    let now = 0;
    const server = createServer((request, response) => {
      const url = request.url ?? "";
      requestedUrls.push(url);
      if (url === "/open-api/v1/user-memory/quick-notes") {
        now = 1_000;
        response.writeHead(403, {
          "Content-Type": "application/json",
          "X-Request-Id": "req_notes_deadline",
        });
        response.end(
          JSON.stringify({
            code: 403,
            message: "Insufficient scope",
            data: null,
          }),
        );
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: { scopes: ["calendar:read"] },
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
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "notes", "list", "--timeout", "1s", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          now: () => now,
        },
        capture.io,
      );

      expect(exitCode).toBe(8);
      expect(requestedUrls).toEqual(["/open-api/v1/user-memory/quick-notes"]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "TIMEOUT",
          retryable: true,
          nextActions: [{ command: "sharge doctor --json" }],
        },
        meta: { requestId: "req_notes_deadline", httpStatus: 403 },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("preserves a timeout raised while fetching scopes after a denial", async () => {
    const requestedUrls: string[] = [];
    let now = 0;
    const server = createServer((request, response) => {
      const url = request.url ?? "";
      requestedUrls.push(url);
      if (url === "/open-api/v1/user-memory/quick-notes") {
        now = 980;
        response.writeHead(403, {
          "Content-Type": "application/json",
          "X-Request-Id": "req_notes_scope_timeout",
        });
        response.end(
          JSON.stringify({
            code: 403,
            message: "Insufficient scope",
            data: null,
          }),
        );
        return;
      }
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            message: "ok",
            data: { scopes: ["calendar:read"] },
          }),
        );
      }, 50);
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
        ["node", "sharge", "notes", "list", "--timeout", "1s", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          now: () => now,
        },
        capture.io,
      );

      expect(exitCode).toBe(8);
      expect(requestedUrls).toEqual([
        "/open-api/v1/user-memory/quick-notes",
        "/open-api/v1/auth/status",
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "TIMEOUT",
          retryable: true,
          nextActions: [{ command: "sharge doctor --json" }],
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("fully describes the implemented Notes read surface offline", async () => {
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
    expect(
      JSON.parse(namespace.stdout()).data.commands.filter(
        (command: { command: string }) =>
          ["notes.list", "notes.search", "notes.get"].includes(command.command),
      ),
    ).toEqual([
      {
        command: "notes.list",
        path: ["notes", "list"],
        description: "读取一页 Quick Note",
      },
      {
        command: "notes.search",
        path: ["notes", "search"],
        description: "按标题和正文搜索一页 Quick Note",
      },
      {
        command: "notes.get",
        path: ["notes", "get"],
        description: "按 ID 读取一条完整 Quick Note",
      },
    ]);

    const listHelp = captureIo();
    expect(
      await main(
        ["node", "sharge", "notes", "list", "--help", "--json"],
        runtime,
        listHelp.io,
      ),
    ).toBe(0);
    expect(JSON.parse(listHelp.stdout()).data).toMatchObject({
      requiredScopes: ["quick_notes:read"],
      outputSchema: {
        type: "object",
        required: ["items", "has_more", "next_cursor"],
        additionalProperties: true,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              required: [
                "id",
                "title",
                "content",
                "status",
                "location",
                "longitude",
                "latitude",
                "has_calendar_events",
                "available_media_types",
                "media_downloads",
                "created_at",
                "updated_at",
              ],
              properties: {
                id: {
                  anyOf: [{ type: "integer" }, { type: "string" }],
                },
                title: {
                  anyOf: [{ type: "string" }, { type: "null" }],
                },
                status: {
                  type: "string",
                  enum: ["pending", "processing", "success", "failed"],
                },
                available_media_types: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: ["audio", "image", "video"],
                  },
                },
              },
            },
          },
          has_more: { type: "boolean" },
          next_cursor: {
            anyOf: [{ type: "integer" }, { type: "string" }, { type: "null" }],
          },
        },
      },
      pagination: {
        type: "cursor",
        requestField: "cursor",
        nextField: "next_cursor",
        hasMoreField: "has_more",
        autoPaginate: false,
        defaultLimit: 20,
        maxLimit: 100,
      },
      errors: expect.arrayContaining([
        "AUTH_REQUIRED",
        "SCOPE_REQUIRED",
        "NOT_FOUND",
        "RATE_LIMITED",
        "TIMEOUT",
      ]),
    });

    const searchHelp = captureIo();
    expect(
      await main(
        ["node", "sharge", "notes", "search", "--help", "--json"],
        runtime,
        searchHelp.io,
      ),
    ).toBe(0);
    expect(JSON.parse(searchHelp.stdout()).data).toMatchObject({
      arguments: [
        {
          name: "query",
          description: "必填搜索词",
          required: true,
          variadic: false,
        },
      ],
      pagination: { autoPaginate: false },
    });

    const getHelp = captureIo();
    expect(
      await main(
        ["node", "sharge", "notes", "get", "--help", "--json"],
        runtime,
        getHelp.io,
      ),
    ).toBe(0);
    expect(JSON.parse(getHelp.stdout()).data.outputSchema).toMatchObject({
      type: "object",
      additionalProperties: true,
      required: [
        "id",
        "title",
        "content",
        "status",
        "location",
        "longitude",
        "latitude",
        "has_calendar_events",
        "available_media_types",
        "media_downloads",
        "created_at",
        "updated_at",
      ],
      properties: {
        id: { anyOf: [{ type: "integer" }, { type: "string" }] },
        media_downloads: {
          type: "object",
          additionalProperties: { type: "string" },
        },
        created_at: { type: "string", format: "date-time" },
      },
    });

    const create = captureIo();
    expect(
      await main(
        ["node", "sharge", "notes", "create", "--json"],
        runtime,
        create.io,
      ),
    ).toBe(2);
    expect(JSON.parse(create.stdout())).toMatchObject({
      error: { type: "INVALID_INPUT", field: "create" },
    });
  });
});
