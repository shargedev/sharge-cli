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
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-calendar-write-"));
  cleanupPaths.push(homeDir);
  await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
  await writeFile(
    join(homeDir, ".sharge", "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_calendar_write",
      baseUrl,
      apiKey: "lms-calendar-write-secret",
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
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function ok(
  response: ServerResponse,
  data: unknown,
  status = 200,
  requestId = "req_calendar_write",
) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
  });
  response.end(JSON.stringify({ code: 0, message: "ok", data }));
}

const completeCreate = {
  title: "项目例会",
  description: null,
  location: null,
  timezone: "Asia/Shanghai",
  type: "event",
  start_time: "2026-08-03T10:00:00+08:00",
  end_time: "2026-08-03T11:00:00+08:00",
  is_all_day: false,
  rrule: "FREQ=WEEKLY;COUNT=4",
  enable_alarm: true,
  trigger_seconds: -900,
  trigger_description: null,
};

describe("calendar write commands", () => {
  it("builds the create tracer dry-run with a complete normalized body and zero network", async () => {
    let requests = 0;
    const server = await startServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-calendar-dry-"));
    const cwd = await mkdtemp(join(tmpdir(), "sharge-calendar-input-"));
    cleanupPaths.push(homeDir, cwd);
    await writeFile(join(cwd, "event.json"), JSON.stringify(completeCreate));
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "create",
          "--input",
          "@event.json",
          "--dry-run",
          "--json",
        ],
        {
          env: {
            SHARGE_BASE_URL: server.baseUrl,
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
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "calendar.create",
        data: {
          method: "POST",
          url: `${server.baseUrl}/open-api/v1/ai-calendar/events`,
          path: "/open-api/v1/ai-calendar/events",
          body: completeCreate,
          requiredScopes: ["calendar:write"],
          sideEffects: [
            "create_calendar_item",
            "create_calendar_instances",
            "schedule_calendar_alarm",
          ],
          retrySafe: false,
          unverified: ["calendar_business_rules"],
        },
      });
      expect(capture.stderr()).toBe("");
    } finally {
      await server.close();
    }
  });

  it("materializes documented defaults for create flags", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-calendar-defaults-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        "create",
        "--title",
        "待办",
        "--type",
        "todo",
        "--start-time",
        "2026-08-03T10:00:00Z",
        "--trigger-seconds",
        "-900",
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
    expect(JSON.parse(capture.stdout()).data.body).toEqual({
      title: "待办",
      description: null,
      location: null,
      timezone: null,
      type: "todo",
      start_time: "2026-08-03T10:00:00Z",
      end_time: null,
      is_all_day: false,
      rrule: null,
      enable_alarm: null,
      trigger_seconds: -900,
      trigger_description: null,
    });
  });

  it.each([
    "+08:00",
    "-05:00",
    "UTC+8:00",
    "UTC-05:00",
  ])("accepts backend-supported event timezone offset %s", async (eventTimezone) => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-calendar-offset-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        "create",
        "--title",
        "offset timezone",
        "--start-time",
        "2026-08-03T10:00:00Z",
        "--event-timezone",
        eventTimezone,
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
    expect(JSON.parse(capture.stdout()).data.body.timezone).toBe(eventTimezone);
  });

  it("sends a real create request once and preserves the response DTO", async () => {
    const requests: Array<{
      method: string | undefined;
      url: string | undefined;
      body: unknown;
      authorization: string | undefined;
    }> = [];
    const responseData = {
      id: "9007199254740993",
      ...completeCreate,
      excluded_dates: null,
      source_type: "manual",
      source_id: null,
      completed: null,
      created_at: "2026-07-31T12:00:00+08:00",
      updated_at: "2026-07-31T12:00:00+08:00",
      future_field: { preserved: true },
    };
    const server = await startServer(async (request, response) => {
      requests.push({
        method: request.method,
        url: request.url,
        body: await requestBody(request),
        authorization: request.headers.authorization,
      });
      ok(response, responseData, 201);
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "create",
          "--input",
          JSON.stringify(completeCreate),
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
          method: "POST",
          url: "/open-api/v1/ai-calendar/events",
          body: completeCreate,
          authorization: "Bearer lms-calendar-write-secret",
        },
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "calendar.create",
        data: responseData,
        meta: { requestId: "req_calendar_write" },
      });
    } finally {
      await server.close();
    }
  });

  it("sends a complete PUT update and passes an opaque instance ID unchanged", async () => {
    let received: { method?: string; url?: string; body?: unknown } | undefined;
    const update = {
      ...completeCreate,
      title: "单次调整",
      action: "instance",
      instance_id: "opaque/instance:+_值",
    };
    const responseData = {
      action: "instance",
      created_events: [],
      updated_events: [{ id: 123, title: "单次调整" }],
      deleted_events: [],
    };
    const server = await startServer(async (request, response) => {
      received = {
        method: request.method,
        url: request.url,
        body: await requestBody(request),
      };
      ok(response, responseData);
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "update",
          "123",
          "--input",
          JSON.stringify(update),
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
      expect(received).toEqual({
        method: "PUT",
        url: "/open-api/v1/ai-calendar/events/123",
        body: update,
      });
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "calendar.update",
        data: responseData,
      });
    } finally {
      await server.close();
    }
  });

  it("defaults omitted update action and instance ID after requiring all Create fields", async () => {
    const homeDir = await mkdtemp(
      join(tmpdir(), "sharge-calendar-update-defaults-"),
    );
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        "update",
        "123",
        "--input",
        JSON.stringify(completeCreate),
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
    expect(JSON.parse(capture.stdout()).data.body).toEqual({
      ...completeCreate,
      action: "all",
      instance_id: null,
    });
  });

  it("maps update flags to a complete resetting PUT body", async () => {
    const homeDir = await mkdtemp(
      join(tmpdir(), "sharge-calendar-update-flags-"),
    );
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        "update",
        "123",
        "--title",
        "flags replacement",
        "--type",
        "todo",
        "--start-time",
        "2026-08-04T09:00:00Z",
        "--trigger-seconds",
        "-900",
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
    expect(JSON.parse(capture.stdout()).data.body).toEqual({
      title: "flags replacement",
      description: null,
      location: null,
      timezone: null,
      type: "todo",
      start_time: "2026-08-04T09:00:00Z",
      end_time: null,
      is_all_day: false,
      rrule: null,
      enable_alarm: null,
      trigger_seconds: -900,
      trigger_description: null,
      action: "all",
      instance_id: null,
    });
  });

  it("renders the replacement ID for a successful all update in text mode", async () => {
    const replacement = {
      id: 456,
      title: "replacement",
    };
    const server = await startServer((_request, response) => {
      ok(response, {
        action: "all",
        created_events: [replacement],
        updated_events: [],
        deleted_events: [{ id: 123, title: "old" }],
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
          "update",
          "123",
          "--input",
          JSON.stringify(completeCreate),
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
      expect(capture.stdout()).toContain("新建=#456");
      expect(capture.stdout()).toContain("更新=无");
      expect(capture.stdout()).toContain("删除=#123");
      expect(capture.stdout()).not.toBe("已更新 Calendar #123（all）。\n");
    } finally {
      await server.close();
    }
  });

  it.each([
    [
      "missing instance",
      {
        ...completeCreate,
        action: "future",
        instance_id: null,
      },
      "--instance-id",
    ],
    [
      "instance supplied for all",
      {
        ...completeCreate,
        action: "all",
        instance_id: "opaque",
      },
      "--instance-id",
    ],
    [
      "unknown field",
      {
        ...completeCreate,
        action: "all",
        instance_id: null,
        unexpected: true,
      },
      "--input",
    ],
    [
      "bad datetime",
      {
        ...completeCreate,
        start_time: "2026-08-03T10:00:00",
        action: "all",
        instance_id: null,
      },
      "--start-time",
    ],
    [
      "unsupported rrule",
      {
        ...completeCreate,
        rrule: "FREQ=HOURLY",
        action: "all",
        instance_id: null,
      },
      "--rrule",
    ],
  ])("rejects %s before config or network", async (_label, input, field) => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-calendar-invalid-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        "update",
        "123",
        "--input",
        JSON.stringify(input),
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
      command: "calendar.update",
      error: {
        type: "INVALID_INPUT",
        field,
        nextActions: [{ command: "sharge calendar update --help --json" }],
      },
    });
  });

  it("rejects incomplete update input instead of applying OpenAPI defaults", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-calendar-partial-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        "update",
        "123",
        "--input",
        '{"title":"危险的局部更新","start_time":"2026-08-03T10:00:00Z"}',
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
        field: "--input",
        path: "$.description",
      },
    });
  });

  it("renders an offline raw update template with every PUT field", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-calendar-template-"));
    cleanupPaths.push(homeDir);
    let stdinReads = 0;
    const capture = captureIo();

    const exitCode = await main(
      ["node", "sharge", "calendar", "update", "123", "--generate-input"],
      {
        env: {},
        homeDir,
        cwd: homeDir,
        platform: process.platform,
        readStdin: async () => {
          stdinReads += 1;
          return "";
        },
      },
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(stdinReads).toBe(0);
    expect(JSON.parse(capture.stdout())).toEqual({
      title: "",
      description: null,
      location: null,
      timezone: null,
      type: "event",
      start_time: "",
      end_time: null,
      is_all_day: false,
      rrule: null,
      enable_alarm: null,
      trigger_seconds: 0,
      trigger_description: null,
      action: "all",
      instance_id: null,
    });
  });

  it("returns unknown outcome without retry and points create to search", async () => {
    let requests = 0;
    const server = await startServer((_request, response) => {
      requests += 1;
      response.socket?.destroy();
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "create",
          "--title",
          "唯一标题-unknown",
          "--start-time",
          "2026-08-03T10:00:00Z",
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

      expect(exitCode).toBe(8);
      expect(requests).toBe(1);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "NETWORK_ERROR",
          retryable: false,
          outcome: "unknown",
          nextActions: [
            {
              command: "sharge calendar search '唯一标题-unknown' --json",
            },
          ],
        },
      });
    } finally {
      await server.close();
    }
  });

  it("points an all-update unknown outcome to the replacement title, not the deleted ID", async () => {
    let requests = 0;
    const server = await startServer((_request, response) => {
      requests += 1;
      response.socket?.destroy();
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();
    const update = {
      ...completeCreate,
      title: "替换后的唯一标题",
      action: "all",
      instance_id: null,
    };

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "update",
          "123",
          "--input",
          JSON.stringify(update),
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

      expect(exitCode).toBe(8);
      expect(requests).toBe(1);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          outcome: "unknown",
          retryable: false,
          nextActions: [
            {
              command: "sharge calendar search '替换后的唯一标题' --json",
            },
          ],
        },
      });
    } finally {
      await server.close();
    }
  });

  it("exposes static input/output contracts and safe examples through help JSON", async () => {
    const capture = captureIo();
    expect(
      await main(
        ["node", "sharge", "calendar", "update", "--help", "--json"],
        {
          env: {},
          homeDir: tmpdir(),
          cwd: tmpdir(),
          platform: process.platform,
        },
        capture.io,
      ),
    ).toBe(0);

    const data = JSON.parse(capture.stdout()).data;
    expect(data).toMatchObject({
      command: "calendar.update",
      requiredScopes: ["calendar:write"],
      network: true,
      dryRun: true,
      retrySafe: false,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "description",
          "location",
          "timezone",
          "type",
          "start_time",
          "end_time",
          "is_all_day",
          "rrule",
          "enable_alarm",
          "trigger_seconds",
          "trigger_description",
        ],
      },
    });
    expect(data.examples).toContain(
      "sharge calendar update 123 --input @update.json --dry-run --json",
    );
    expect(data.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "--title", default: null }),
        expect.objectContaining({ name: "--type", default: "event" }),
        expect.objectContaining({ name: "--is-all-day", default: "false" }),
        expect.objectContaining({ name: "--trigger-seconds", default: "0" }),
        expect.objectContaining({
          name: "--action",
          default: "all",
          enum: ["all", "instance", "future"],
        }),
        expect.objectContaining({ name: "--input" }),
        expect.objectContaining({ name: "--generate-input" }),
        expect.objectContaining({ name: "--dry-run" }),
      ]),
    );
  });
});
