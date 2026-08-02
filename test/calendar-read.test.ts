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
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-calendar-read-"));
  cleanupPaths.push(homeDir);
  await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
  await writeFile(
    join(homeDir, ".sharge", "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_calendar_read",
      baseUrl,
      apiKey: "lms-calendar-read-secret",
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

function ok(response: ServerResponse, data: unknown, requestId?: string) {
  response.writeHead(200, {
    "Content-Type": "application/json",
    ...(requestId ? { "X-Request-Id": requestId } : {}),
  });
  response.end(JSON.stringify({ code: 0, message: "ok", data }));
}

describe("calendar read commands", () => {
  it("uses an explicit month and preserves dynamic dictionaries and backend fields", async () => {
    const requests: Array<{ url: string; clientDate: string | undefined }> = [];
    const data = {
      dates: {
        "30": [
          {
            instance_id: "instance_seed",
            event_id: 123,
            actual_start_time: "2026-07-30T10:00:00+08:00",
            future_instance_field: { preserved: true },
          },
        ],
      },
      events: {
        "123": {
          id: 123,
          title: "项目评审",
          type: "event",
          start_time: "2026-07-30T10:00:00+08:00",
          source_type: "quick_note",
          future_event_field: ["preserved"],
        },
      },
      has_new_instances: false,
      future_month_field: "preserved",
    };
    const server = await startServer((request, response) => {
      requests.push({
        url: request.url ?? "",
        clientDate:
          typeof request.headers["x-client-date"] === "string"
            ? request.headers["x-client-date"]
            : undefined,
      });
      ok(response, data, "req_calendar_month");
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "month",
          "2026-07",
          "--timezone",
          "Asia/Shanghai",
          "--source-type",
          "quick_note",
          "--json",
        ],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          now: () => Date.parse("2026-07-31T04:05:06Z"),
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requests).toEqual([
        {
          url: "/open-api/v1/ai-calendar/events/monthly?year=2026&month=7&timezone=Asia%2FShanghai&source_type=quick_note",
          clientDate: "2026-07-31T12:05:06+08:00",
        },
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "calendar.month",
        data,
        meta: {
          requestId: "req_calendar_month",
          timezone: "Asia/Shanghai",
          clientDate: "2026-07-31T12:05:06+08:00",
        },
      });
      expect(capture.stderr()).toBe("");
    } finally {
      await server.close();
    }
  });

  it.each([
    "2026-7",
    "1969-12",
    "2026-13",
    "not-a-month",
  ])("rejects invalid month %s before loading credentials or networking", async (month) => {
    const capture = captureIo();
    const missingHome = join(tmpdir(), `missing-calendar-${Date.now()}`);

    const exitCode = await main(
      ["node", "sharge", "calendar", "month", month, "--json"],
      {
        env: {},
        homeDir: missingHome,
        cwd: missingHome,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      command: "calendar.month",
      error: {
        type: "INVALID_INPUT",
        field: "month",
        nextActions: [{ command: "sharge calendar month --help --json" }],
      },
    });
  });

  it("sends the resolved environment IANA timezone even without a flag", async () => {
    const requestedUrls: string[] = [];
    const server = await startServer((request, response) => {
      requestedUrls.push(request.url ?? "");
      ok(response, {
        dates: {},
        events: {},
        has_new_instances: false,
      });
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "calendar", "month", "2026-03", "--json"],
        {
          env: { SHARGE_TIMEZONE: "America/New_York" },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requestedUrls).toEqual([
        "/open-api/v1/ai-calendar/events/monthly?year=2026&month=3&timezone=America%2FNew_York",
      ]);
      expect(JSON.parse(capture.stdout()).meta.timezone).toBe(
        "America/New_York",
      );
    } finally {
      await server.close();
    }
  });

  it.each([
    ["month", ["month", "2026-07"]],
    [
      "list",
      [
        "list",
        "--start",
        "2026-07-01T00:00:00Z",
        "--end",
        "2026-07-02T00:00:00Z",
      ],
    ],
    ["search", ["search", "评审"]],
  ])("rejects invalid %s source type before loading config or networking", async (_command, commandArgs) => {
    const capture = captureIo();
    const missingHome = join(tmpdir(), `missing-calendar-${Date.now()}`);
    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        ...commandArgs,
        "--source-type",
        "typo",
        "--json",
      ],
      {
        env: {},
        homeDir: missingHome,
        cwd: missingHome,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      error: {
        type: "INVALID_INPUT",
        field: "--source-type",
        expected: "all|manual|quick_note|audio_recorded",
        actual: "typo",
      },
      meta: { requestId: null },
    });
  });

  it("lists one explicit UTC-bounded range without rewriting business DTOs", async () => {
    const requestedUrls: string[] = [];
    const data = {
      events: [
        {
          id: 201,
          title: "跨时区会议",
          type: "event",
          start_time: "2026-08-01T00:30:00+09:00",
          backend_extension: { color: "blue" },
        },
      ],
      instances: [
        {
          instance_id: "opaque-instance",
          event_id: 201,
          actual_start_time: "2026-08-01T00:30:00+09:00",
          backend_instance_extension: true,
        },
      ],
      backend_range_extension: [1, 2, 3],
    };
    const server = await startServer((request, response) => {
      requestedUrls.push(request.url ?? "");
      ok(response, data);
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "list",
          "--start",
          "2026-07-31T23:00:00+08:00",
          "--end",
          "2026-08-02T01:00:00+09:00",
          "--timezone",
          "Asia/Tokyo",
          "--source-type",
          "all",
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
        "/open-api/v1/ai-calendar/events?start=2026-07-31T23%3A00%3A00%2B08%3A00&end=2026-08-02T01%3A00%3A00%2B09%3A00&timezone=Asia%2FTokyo&source_type=all",
      ]);
      expect(JSON.parse(capture.stdout()).data).toEqual(data);
    } finally {
      await server.close();
    }
  });

  it("accepts a 31-date DST span when its actual UTC duration is below 31 days", async () => {
    const requestedUrls: string[] = [];
    const server = await startServer((request, response) => {
      requestedUrls.push(request.url ?? "");
      ok(response, { events: [], instances: [] });
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "list",
          "--start",
          "2026-03-01T00:00:00-05:00",
          "--end",
          "2026-04-01T00:00:00-04:00",
          "--timezone",
          "America/New_York",
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
        "/open-api/v1/ai-calendar/events?start=2026-03-01T00%3A00%3A00-05%3A00&end=2026-04-01T00%3A00%3A00-04%3A00&timezone=America%2FNew_York",
      ]);
    } finally {
      await server.close();
    }
  });

  it.each([
    {
      args: ["--start", "2026-08-01T00:00:00", "--end", "2026-08-02T00:00:00Z"],
      field: "--start",
    },
    {
      args: [
        "--start",
        "2026-02-30T00:00:00Z",
        "--end",
        "2026-03-01T00:00:00Z",
      ],
      field: "--start",
    },
    {
      args: [
        "--start",
        "2026-08-01T24:00:00Z",
        "--end",
        "2026-08-02T00:00:00Z",
      ],
      field: "--start",
    },
    {
      args: [
        "--start",
        "2026-08-02T00:00:00Z",
        "--end",
        "2026-08-01T00:00:00Z",
      ],
      field: "--end",
    },
    {
      args: [
        "--start",
        "2026-08-01T00:00:00Z",
        "--end",
        "2026-09-01T00:00:01Z",
      ],
      field: "--end",
    },
  ])("rejects an invalid explicit range before networking", async ({
    args,
    field,
  }) => {
    const capture = captureIo();
    const missingHome = join(tmpdir(), `missing-calendar-${Date.now()}`);
    const exitCode = await main(
      ["node", "sharge", "calendar", "list", ...args, "--json"],
      {
        env: {},
        homeDir: missingHome,
        cwd: missingHome,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      command: "calendar.list",
      error: {
        type: "INVALID_INPUT",
        field,
        nextActions: [{ command: "sharge calendar list --help --json" }],
      },
    });
  });

  it("searches formal titles with an explicit source type and bounded limit", async () => {
    const requestedUrls: string[] = [];
    const data = [
      {
        id: 301,
        title: "发布评审",
        type: "todo",
        matched_title: "<em>评审</em>",
        dynamic_search_field: "preserved",
      },
    ];
    const server = await startServer((request, response) => {
      requestedUrls.push(request.url ?? "");
      ok(response, data);
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "search",
          "  评审  ",
          "--source-type",
          "manual",
          "--limit",
          "20",
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
        "/open-api/v1/ai-calendar/events/search?keyword=%E8%AF%84%E5%AE%A1&source_type=manual&limit=20",
      ]);
      expect(JSON.parse(capture.stdout()).data).toEqual(data);
    } finally {
      await server.close();
    }
  });

  it.each([
    { keyword: "   ", limit: "30", field: "keyword" },
    { keyword: "评审", limit: "0", field: "--limit" },
    { keyword: "评审", limit: "101", field: "--limit" },
    { keyword: "评审", limit: "1.5", field: "--limit" },
  ])("rejects invalid search input before networking", async ({
    keyword,
    limit,
    field,
  }) => {
    const capture = captureIo();
    const missingHome = join(tmpdir(), `missing-calendar-${Date.now()}`);
    const exitCode = await main(
      [
        "node",
        "sharge",
        "calendar",
        "search",
        keyword,
        "--limit",
        limit,
        "--json",
      ],
      {
        env: {},
        homeDir: missingHome,
        cwd: missingHome,
        platform: process.platform,
      },
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      command: "calendar.search",
      error: {
        type: "INVALID_INPUT",
        field,
        nextActions: [{ command: "sharge calendar search --help --json" }],
      },
    });
  });

  it("gets one formal event by positive integer ID", async () => {
    const requestedUrls: string[] = [];
    const data = {
      id: 9007199254740993n.toString(),
      title: "大 ID 日程",
      type: "event",
      snake_case_extension: true,
    };
    const server = await startServer((request, response) => {
      requestedUrls.push(request.url ?? "");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        '{"code":0,"message":"ok","data":{"id":9007199254740993,"title":"大 ID 日程","type":"event","snake_case_extension":true}}',
      );
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "calendar", "get", "9007199254740993", "--json"],
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
        "/open-api/v1/ai-calendar/events/9007199254740993",
      ]);
      expect(JSON.parse(capture.stdout()).data).toEqual(data);
    } finally {
      await server.close();
    }
  });

  it("maps hidden, cross-user, or missing items to NOT_FOUND with a read recovery", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(404, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_calendar_hidden",
      });
      response.end(
        JSON.stringify({
          code: 404,
          message: "Calendar item not found",
          data: null,
        }),
      );
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "calendar", "get", "123", "--json"],
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
        command: "calendar.get",
        error: {
          type: "NOT_FOUND",
          retryable: false,
          nextActions: [{ command: "sharge calendar list --help --json" }],
        },
        meta: { requestId: "req_calendar_hidden", httpStatus: 404 },
      });
    } finally {
      await server.close();
    }
  });

  it("recovers a scope denial into a complete login command", async () => {
    const requestedUrls: string[] = [];
    const server = await startServer((request, response) => {
      const url = request.url ?? "";
      requestedUrls.push(url);
      if (url === "/open-api/v1/auth/status") {
        ok(response, { scopes: ["quick_notes:read"] });
        return;
      }
      response.writeHead(403, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_calendar_scope",
      });
      response.end(
        JSON.stringify({
          code: 403,
          message: "Insufficient scope",
          data: null,
        }),
      );
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "calendar", "month", "2026-07", "--json"],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(4);
      expect(requestedUrls).toEqual([
        "/open-api/v1/ai-calendar/events/monthly?year=2026&month=7&timezone=Asia%2FShanghai",
        "/open-api/v1/auth/status",
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "SCOPE_REQUIRED",
          requiredScopes: ["calendar:read"],
          nextActions: [
            {
              command:
                "sharge login --scope quick_notes:read --scope calendar:read",
            },
          ],
        },
        meta: { requestId: "req_calendar_scope", httpStatus: 403 },
      });
    } finally {
      await server.close();
    }
  });

  it("shares one total timeout budget with scope recovery", async () => {
    const requestedUrls: string[] = [];
    let now = 0;
    const server = await startServer((request, response) => {
      requestedUrls.push(request.url ?? "");
      now = 1_000;
      response.writeHead(403, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_calendar_deadline",
      });
      response.end(
        JSON.stringify({
          code: 403,
          message: "Insufficient scope",
          data: null,
        }),
      );
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "month",
          "2026-07",
          "--timeout",
          "1s",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          now: () => now,
        },
        capture.io,
      );

      expect(exitCode).toBe(8);
      expect(requestedUrls).toEqual([
        "/open-api/v1/ai-calendar/events/monthly?year=2026&month=7&timezone=Asia%2FShanghai",
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "TIMEOUT",
          retryable: true,
          nextActions: [{ command: "sharge doctor --json" }],
        },
        meta: { requestId: "req_calendar_deadline", httpStatus: 403 },
      });
    } finally {
      await server.close();
    }
  });

  it("preserves a timeout raised while fetching scopes after a denial", async () => {
    const requestedUrls: string[] = [];
    let now = 0;
    const server = await startServer((request, response) => {
      const url = request.url ?? "";
      requestedUrls.push(url);
      if (url.startsWith("/open-api/v1/ai-calendar/events/monthly")) {
        now = 980;
        response.writeHead(403, {
          "Content-Type": "application/json",
          "X-Request-Id": "req_calendar_scope_timeout",
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
      setTimeout(() => ok(response, { scopes: ["quick_notes:read"] }), 50);
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "calendar",
          "month",
          "2026-07",
          "--timeout",
          "1s",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
          now: () => now,
        },
        capture.io,
      );

      expect(exitCode).toBe(8);
      expect(requestedUrls).toEqual([
        "/open-api/v1/ai-calendar/events/monthly?year=2026&month=7&timezone=Asia%2FShanghai",
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
      await server.close();
    }
  });

  it("reports malformed Calendar DTOs as diagnosable server errors", async () => {
    const server = await startServer((_request, response) => {
      ok(
        response,
        {
          dates: { "30": [{ event_id: 123 }] },
          events: { "123": "not-an-event-object" },
          has_new_instances: false,
        },
        "req_calendar_malformed",
      );
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "calendar", "month", "2026-07", "--json"],
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(8);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        command: "calendar.month",
        error: {
          type: "SERVER_ERROR",
          retryable: false,
          nextActions: [{ command: "sharge doctor --json" }],
        },
        meta: {
          requestId: "req_calendar_malformed",
          httpStatus: 200,
        },
      });
    } finally {
      await server.close();
    }
  });

  it("fully describes the Calendar read surface offline", async () => {
    const missingHome = join(tmpdir(), `missing-calendar-${Date.now()}`);
    for (const command of ["month", "list", "search", "get"]) {
      const capture = captureIo();
      const exitCode = await main(
        ["node", "sharge", "calendar", command, "--help", "--json"],
        {
          env: {},
          homeDir: missingHome,
          cwd: missingHome,
          platform: process.platform,
        },
        capture.io,
      );
      expect(exitCode).toBe(0);
      const help = JSON.parse(capture.stdout());
      expect(help).toMatchObject({
        ok: true,
        command: `calendar.${command}`,
        data: {
          command: `calendar.${command}`,
          requiredScopes: ["calendar:read"],
          network: true,
          retrySafe: true,
          timeout: 30_000,
          sideEffects: [],
          errors: expect.arrayContaining([
            "INVALID_INPUT",
            "SCOPE_REQUIRED",
            "NOT_FOUND",
            "CANCELLED",
          ]),
          examples: expect.any(Array),
          outputSchema: {
            type: expect.any(String),
          },
        },
      });
      if (command === "month") {
        expect(help.data.outputSchema.properties.dates).toMatchObject({
          type: "object",
          additionalProperties: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              required: expect.arrayContaining([
                "instance_id",
                "event_id",
                "actual_start_time",
              ]),
              properties: {
                instance_id: { type: "string" },
                event_id: expect.any(Object),
                actual_start_time: {
                  type: "string",
                  format: "date-time",
                },
              },
            },
          },
        });
        expect(help.data.outputSchema.properties.events).toMatchObject({
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: true,
            required: expect.arrayContaining([
              "id",
              "title",
              "source_type",
              "created_at",
            ]),
          },
        });
      }
    }
  });
});
