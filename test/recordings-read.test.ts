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

async function setupHome(baseUrl: string) {
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-recordings-read-"));
  cleanupPaths.push(homeDir);
  await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
  await writeFile(
    join(homeDir, ".sharge", "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_recordings_read",
      baseUrl,
      apiKey: "lms-recordings-read-secret",
    })}\n`,
    { mode: 0o600 },
  );
  return homeDir;
}

function ok(response: ServerResponse, data: unknown) {
  response.writeHead(200, {
    "Content-Type": "application/json",
    "X-Request-Id": "req_recordings_read",
  });
  response.end(JSON.stringify({ code: 0, message: "ok", data }));
}

const recording = {
  recording_id: 101,
  voice_id: "voice-101",
  recording_type: "ordinary",
  title: "项目复盘",
  summary: "复盘摘要",
  timestamp: 1785484800,
  duration_minutes: 12.5,
  location: "上海",
  status_code: 0,
  has_summary: true,
  audio_download_path: "/open-api/v1/voicemaster/recordings/101/audio/download",
  created_at: "2026-07-31T08:00:00Z",
  updated_at: "2026-07-31T08:10:00Z",
};

describe("recordings read commands", () => {
  it("reads exactly one recordings page and preserves the cursor", async () => {
    const requests: string[] = [];
    const server = await startServer((request, response) => {
      requests.push(request.url ?? "");
      ok(response, {
        items: [recording],
        next_cursor: 101,
        prev_cursor: null,
        has_more: true,
      });
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "recordings", "list", "--page-size", "1", "--json"],
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
        "/open-api/v1/voicemaster/recordings?page_size=1&direction=forward&timezone=Asia%2FShanghai&sort_by=timestamp&sort_order=desc",
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        command: "recordings.list",
        data: {
          items: [recording],
          next_cursor: 101,
          prev_cursor: null,
          has_more: true,
        },
        meta: {
          requestId: "req_recordings_read",
          timezone: "Asia/Shanghai",
        },
      });
    } finally {
      await server.close();
    }
  });

  it("preserves every list filter in the copyable next-page command", async () => {
    const requests: string[] = [];
    const server = await startServer((request, response) => {
      requests.push(request.url ?? "");
      ok(response, {
        items: [recording],
        next_cursor: 101,
        prev_cursor: 98,
        has_more: true,
      });
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "recordings",
          "list",
          "--cursor",
          "99",
          "--page-size",
          "1",
          "--direction",
          "backward",
          "--start-date",
          "2026-07-01",
          "--end-date",
          "2026-07-31",
          "--recording-type",
          "ordinary",
          "--sort-by",
          "updated_at",
          "--sort-order",
          "asc",
          "--timezone",
          "Asia/Shanghai",
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
        "/open-api/v1/voicemaster/recordings?cursor=99&page_size=1&direction=backward&start_date=2026-07-01&end_date=2026-07-31&timezone=Asia%2FShanghai&recording_type=ordinary&sort_by=updated_at&sort_order=asc",
      ]);
      expect(capture.stdout()).toContain(
        "下一页：sharge recordings list --cursor 98 --page-size 1 --direction backward --start-date 2026-07-01 --end-date 2026-07-31 --recording-type ordinary --sort-by updated_at --sort-order asc --timezone Asia/Shanghai --json",
      );
    } finally {
      await server.close();
    }
  });

  it.each([
    ["zero cursor", ["--cursor", "0"], "--cursor"],
    ["large page", ["--page-size", "51"], "--page-size"],
    ["impossible date", ["--start-date", "2026-02-30"], "--start-date"],
    [
      "reversed date range",
      ["--start-date", "2026-08-01", "--end-date", "2026-07-31"],
      "--start-date",
    ],
  ])("fast-fails list with %s before credentials/network", async (_name, options, field) => {
    let requests = 0;
    const server = await startServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-recordings-invalid-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "recordings", "list", ...options, "--json"],
        {
          env: { SHARGE_BASE_URL: server.baseUrl },
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
          field,
          nextActions: [{ command: "sharge recordings list --help --json" }],
        },
        meta: { requestId: null },
      });
    } finally {
      await server.close();
    }
  });

  it("searches recordings with every product filter and preserves dynamic matches", async () => {
    const requests: string[] = [];
    const searchResult = {
      ...recording,
      language: "zh",
      summary_template_id: "meeting",
      matched_fields: ["title", "summary"],
      matched_texts: {
        title: "项目复盘",
        summary: "复盘摘要",
      },
    };
    const server = await startServer((request, response) => {
      requests.push(request.url ?? "");
      ok(response, [searchResult]);
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "recordings",
          "search",
          "  项目复盘  ",
          "--limit",
          "7",
          "--recording-type",
          "ordinary",
          "--language",
          "zh",
          "--summary-template-id",
          "meeting",
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
      expect(requests).toEqual([
        "/open-api/v1/voicemaster/recordings/search?keyword=%E9%A1%B9%E7%9B%AE%E5%A4%8D%E7%9B%98&limit=7&recording_type=ordinary&language=zh&summary_template_id=meeting",
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        command: "recordings.search",
        data: [searchResult],
      });
    } finally {
      await server.close();
    }
  });

  it("drops server fallback rows that violate explicit search filters", async () => {
    const matching = {
      ...recording,
      recording_id: 102,
      language: "zh",
      summary_template_id: "meeting",
      matched_fields: ["summary"],
      matched_texts: { summary: "项目复盘" },
    };
    const server = await startServer((_request, response) => {
      ok(response, [
        {
          ...recording,
          language: "en",
          summary_template_id: "call",
          matched_fields: ["summary"],
          matched_texts: { summary: "project review" },
        },
        matching,
      ]);
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "recordings",
          "search",
          "项目复盘",
          "--recording-type",
          "ordinary",
          "--language",
          "zh",
          "--summary-template-id",
          "meeting",
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
      expect(JSON.parse(capture.stdout()).data).toEqual([matching]);
    } finally {
      await server.close();
    }
  });

  it.each([
    ["blank keyword", ["   "], "keyword"],
    ["zero limit", ["query", "--limit", "0"], "--limit"],
    ["large limit", ["query", "--limit", "51"], "--limit"],
  ])("fast-fails search with %s before credentials/network", async (_name, args, field) => {
    let requests = 0;
    const server = await startServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-recordings-invalid-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "recordings", "search", ...args, "--json"],
        {
          env: { SHARGE_BASE_URL: server.baseUrl },
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
          field,
          nextActions: [{ command: "sharge recordings search --help --json" }],
        },
      });
    } finally {
      await server.close();
    }
  });

  it("gets rich recording detail without rewriting dynamic dictionaries", async () => {
    const requests: string[] = [];
    const detail = {
      ...recording,
      evaluate_time: 1785484900,
      transcript: {
        recording_id: 101,
        status_code: 0,
        text: "完整转写",
        segments: [
          {
            start_time: 0,
            end_time: 2.5,
            speaker: "speaker_1",
            text: "第一段",
          },
        ],
      },
      overviews: {
        "zh-CN": {
          title: "中文标题",
          abstract: "中文摘要",
          duration_seconds: 750,
          summaries: {
            meeting: "会议总结",
            custom_dynamic_key: "自定义总结",
          },
          keywords: ["项目", "复盘"],
          mind_map: "mindmap",
          chapters: [{ start_time: 0, title: "开始", content: "章节内容" }],
          has_calendar: true,
        },
      },
      speaker_map: {
        speaker_1: { speaker_id: "speaker_1", name: "Ivan" },
        dynamic_speaker: { speaker_id: "s2", name: "Agent" },
      },
      highlights: [
        {
          at_ms: 1000,
          duration_ms: 500,
          text: "高光",
          media_type: "audio",
        },
      ],
    };
    const server = await startServer((request, response) => {
      requests.push(request.url ?? "");
      ok(response, detail);
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "recordings", "get", "101", "--json"],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requests).toEqual(["/open-api/v1/voicemaster/recordings/101"]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        command: "recordings.get",
        data: detail,
      });
    } finally {
      await server.close();
    }
  });

  it("fast-fails invalid recording ID before credentials/network", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-recordings-invalid-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      ["node", "sharge", "recordings", "get", "0", "--json"],
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
        field: "recording-id",
        nextActions: [{ command: "sharge recordings get --help --json" }],
      },
      meta: { requestId: null },
    });
  });

  it("maps invisible recording to NOT_FOUND and a list recovery", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(404, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_recording_missing",
      });
      response.end(
        JSON.stringify({
          code: 404,
          message: "Recording not found",
          data: null,
        }),
      );
    });
    const homeDir = await setupHome(server.baseUrl);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "recordings", "get", "999", "--json"],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
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
          nextActions: [{ command: "sharge recordings list --json" }],
        },
        meta: {
          requestId: "req_recording_missing",
          httpStatus: 404,
        },
      });
    } finally {
      await server.close();
    }
  });

  it("exposes stable JSON help for the three read-only commands", async () => {
    const runtime = {
      env: {},
      homeDir: tmpdir(),
      cwd: tmpdir(),
      platform: process.platform,
    };
    const help = async (command: "list" | "search" | "get") => {
      const capture = captureIo();
      expect(
        await main(
          ["node", "sharge", "recordings", command, "--help", "--json"],
          runtime,
          capture.io,
        ),
      ).toBe(0);
      return JSON.parse(capture.stdout()).data;
    };

    const list = await help("list");
    const search = await help("search");
    const get = await help("get");

    expect(list).toMatchObject({
      command: "recordings.list",
      requiredScopes: ["voicemaster:read"],
      network: true,
      sideEffects: [],
      destructive: false,
      retrySafe: true,
      pagination: {
        cursorField: "next_cursor",
        hasMoreField: "has_more",
        automatic: false,
      },
    });
    expect(search).toMatchObject({
      command: "recordings.search",
      requiredScopes: ["voicemaster:read"],
      pagination: null,
      retrySafe: true,
    });
    expect(get).toMatchObject({
      command: "recordings.get",
      requiredScopes: ["voicemaster:read"],
      outputSchema: {
        properties: {
          overviews: {
            type: "object",
            additionalProperties: {
              properties: {
                chapters: {
                  items: {
                    required: ["title", "content"],
                    properties: {
                      start_time: {
                        anyOf: [{ type: "number" }, { type: "null" }],
                      },
                      title: { type: "string" },
                      content: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          speaker_map: { type: "object" },
          highlights: { type: "array" },
        },
      },
      retrySafe: true,
    });
  });

  it.each([
    "create",
    "update",
    "delete",
    "retry",
    "transcribe",
  ])("keeps recordings %s outside the public command tree", async (command) => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-recordings-ro-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();

    const exitCode = await main(
      ["node", "sharge", "recordings", command, "--json"],
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
        field: command,
        nextActions: [{ command: "sharge recordings --help --json" }],
      },
      meta: { requestId: null },
    });
  });
});
