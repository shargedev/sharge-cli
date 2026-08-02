import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
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
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-calendar-delete-"));
  cleanupPaths.push(homeDir);
  await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
  await writeFile(
    join(homeDir, ".sharge", "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_calendar_delete",
      baseUrl,
      apiKey: "lms-calendar-delete-secret",
    })}\n`,
    { mode: 0o600 },
  );
  return homeDir;
}

async function startServer(
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
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? undefined : JSON.parse(raw);
}

function ok(response: ServerResponse, data: unknown) {
  response.writeHead(200, {
    "Content-Type": "application/json",
    "X-Request-Id": "req_calendar_delete",
  });
  response.end(JSON.stringify({ code: 0, message: "ok", data }));
}

const deleteResult = {
  action: "future",
  created_events: [],
  updated_events: [{ id: 123 }],
  deleted_events: [{ id: 124 }],
};

describe("calendar delete and todo status commands", () => {
  it("builds a zero-network delete dry-run without --yes or credentials", async () => {
    let requests = 0;
    const server = await startServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-delete-dry-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "delete",
          "123",
          "--type",
          "future",
          "--instance-id",
          "opaque/value:+_",
          "--dry-run",
          "--json",
        ],
        {
          env: {
            SHARGE_BASE_URL: server.baseUrl,
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
        command: "calendar.delete",
        data: {
          method: "DELETE",
          path: "/open-api/v1/ai-calendar/events/123?type=future&instance_id=opaque%2Fvalue%3A%2B_",
          body: null,
          requiredScopes: ["calendar:write"],
          sideEffects: [
            "delete_calendar_items",
            "delete_calendar_instances",
            "cancel_calendar_alarms",
          ],
          retrySafe: false,
        },
      });
    } finally {
      await server.close();
    }
  });

  it("requires --yes only for a real delete", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-delete-confirm-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      ["node", "sharge", "calendar", "delete", "123", "--json"],
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
        field: "--yes",
        nextActions: [
          {
            command: "sharge calendar delete 123 --type all --yes --json",
          },
        ],
      },
    });
  });

  it("keeps the opaque instance ID in the copyable --yes recovery command", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-delete-confirm-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        "delete",
        "123",
        "--type",
        "current",
        "--instance-id",
        "opaque/value:'quoted'",
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
        field: "--yes",
        nextActions: [
          {
            command:
              "sharge calendar delete 123 --type current --instance-id 'opaque/value:'\\''quoted'\\''' --yes --json",
          },
        ],
      },
    });
  });

  it.each([
    [
      "current without instance",
      ["--type", "current", "--dry-run"],
      "--instance-id",
    ],
    [
      "future without instance",
      ["--type", "future", "--dry-run"],
      "--instance-id",
    ],
    [
      "all with instance",
      ["--type", "all", "--instance-id", "opaque", "--dry-run"],
      "--instance-id",
    ],
  ])("fast-fails delete %s", async (_name, args, field) => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-delete-invalid-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      ["node", "sharge", "calendar", "delete", "123", ...args, "--json"],
      {
        env: { SHARGE_BASE_URL: "http://127.0.0.1:1" },
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
        field,
        nextActions: [{ command: "sharge calendar delete --help --json" }],
      },
    });
  });

  it("sends one real DELETE and preserves opaque instance ID in the query", async () => {
    const requests: Array<{
      method?: string;
      url?: string;
      authorization?: string;
      body?: unknown;
    }> = [];
    const server = await startServer(async (request, response) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: await requestBody(request),
      });
      ok(response, deleteResult);
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "delete",
          "123",
          "--type",
          "future",
          "--instance-id",
          "opaque/value:+_",
          "--yes",
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
      expect(requests).toEqual([
        {
          method: "DELETE",
          url: "/open-api/v1/ai-calendar/events/123?type=future&instance_id=opaque%2Fvalue%3A%2B_",
          authorization: "Bearer lms-calendar-delete-secret",
          body: undefined,
        },
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        command: "calendar.delete",
        data: deleteResult,
      });
    } finally {
      await server.close();
    }
  });

  it("maps repeated todo flags to the backend body and deduplicates IDs", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-todo-dry-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        "todos",
        "set-status",
        "--event-id",
        "101",
        "--event-id",
        "101",
        "--event-id",
        "102",
        "--status",
        "completed",
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

    expect(exitCode).toBe(0);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      command: "calendar.todos.set-status",
      data: {
        method: "PATCH",
        path: "/open-api/v1/ai-calendar/todos/status",
        body: {
          completed_ids: [101, 102],
          uncompleted_ids: [],
        },
        retrySafe: false,
      },
    });
  });

  it("loads product input and maps uncompleted status to the backend body", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sharge-todo-input-"));
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-todo-home-"));
    cleanupPaths.push(cwd, homeDir);
    await writeFile(
      join(cwd, "status.json"),
      '{"event_ids":[201,202],"status":"uncompleted"}\n',
    );
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        "todos",
        "set-status",
        "--input",
        "@status.json",
        "--dry-run",
        "--json",
      ],
      {
        env: {
          SHARGE_BASE_URL: "http://127.0.0.1:1",
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
        homeDir,
        cwd,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(capture.stdout()).data.body).toEqual({
      completed_ids: [],
      uncompleted_ids: [201, 202],
    });
  });

  it("renders an offline raw todo status template", async () => {
    const capture = captureIo();
    const exitCode = await main(
      ["node", "sharge", "calendar", "todos", "set-status", "--generate-input"],
      {
        env: {},
        homeDir: tmpdir(),
        cwd: tmpdir(),
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(capture.stdout())).toEqual({
      event_ids: [],
      status: "completed",
    });
  });

  it.each([
    ["empty IDs", '{"event_ids":[],"status":"completed"}', "--event-id"],
    ["zero ID", '{"event_ids":[0],"status":"completed"}', "--event-id"],
    ["bad status", '{"event_ids":[1],"status":"done"}', "--status"],
    [
      "unknown field",
      '{"event_ids":[1],"status":"completed","completed_ids":[1]}',
      "--input",
    ],
  ])("fast-fails todo input with %s", async (_name, input, field) => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-todo-invalid-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        "todos",
        "set-status",
        "--input",
        input,
        "--dry-run",
        "--json",
      ],
      {
        env: { SHARGE_BASE_URL: "http://127.0.0.1:1" },
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
        field,
        nextActions: [
          {
            command: "sharge calendar todos set-status --help --json",
          },
        ],
      },
    });
  });

  it("sends one real todo PATCH and returns the backend result", async () => {
    const requests: Array<{ method?: string; url?: string; body?: unknown }> =
      [];
    const server = await startServer(async (request, response) => {
      requests.push({
        method: request.method,
        url: request.url,
        body: await requestBody(request),
      });
      ok(response, {
        completed_ids: [301, 302],
        uncompleted_ids: [],
      });
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "todos",
          "set-status",
          "--event-id",
          "301",
          "--event-id",
          "302",
          "--status",
          "completed",
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
      expect(requests).toEqual([
        {
          method: "PATCH",
          url: "/open-api/v1/ai-calendar/todos/status",
          body: {
            completed_ids: [301, 302],
            uncompleted_ids: [],
          },
        },
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        data: {
          completed_ids: [301, 302],
          uncompleted_ids: [],
        },
      });
    } finally {
      await server.close();
    }
  });

  it.each([
    [
      "delete",
      ["calendar", "delete", "123", "--yes", "--json"],
      "sharge calendar get 123 --json",
    ],
    [
      "todo status",
      [
        "calendar",
        "todos",
        "set-status",
        "--event-id",
        "301",
        "--event-id",
        "302",
        "--status",
        "completed",
        "--json",
      ],
      'for id in 301 302; do sharge calendar get "$id" --json; done',
    ],
  ])("returns one-shot unknown outcome for %s", async (_name, args, nextCommand) => {
    let requests = 0;
    const server = await startServer((_request, response) => {
      requests += 1;
      response.socket?.destroy();
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", ...args],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(8);
      expect(requests).toBe(1);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          retryable: false,
          outcome: "unknown",
          nextActions: [{ command: nextCommand }],
        },
      });
    } finally {
      await server.close();
    }
  });

  it("exposes delete and todo status contracts through JSON help", async () => {
    const deleteCapture = captureIo();
    const todoCapture = captureIo();
    const runtime = {
      env: {},
      homeDir: tmpdir(),
      cwd: tmpdir(),
      platform: process.platform,
    };

    expect(
      await main(
        ["node", "sharge", "calendar", "delete", "--help", "--json"],
        runtime,
        deleteCapture.io,
      ),
    ).toBe(0);
    expect(
      await main(
        [
          "node",
          "sharge",
          "calendar",
          "todos",
          "set-status",
          "--help",
          "--json",
        ],
        runtime,
        todoCapture.io,
      ),
    ).toBe(0);

    expect(JSON.parse(deleteCapture.stdout()).data).toMatchObject({
      command: "calendar.delete",
      destructive: true,
      dryRun: true,
      retrySafe: false,
      requiredScopes: ["calendar:write"],
    });
    expect(JSON.parse(todoCapture.stdout()).data).toMatchObject({
      command: "calendar.todos.set-status",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["event_ids", "status"],
      },
      dryRun: true,
      retrySafe: false,
      requiredScopes: ["calendar:write"],
    });
  });
});
