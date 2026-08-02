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
  return {
    io: { stdout: (value: string) => (stdout += value), stderr: () => {} },
    stdout: () => stdout,
  };
}

async function setupHome(baseUrl: string) {
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-diary-"));
  cleanupPaths.push(homeDir);
  await mkdir(join(homeDir, ".sharge"));
  await writeFile(
    join(homeDir, ".sharge", "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_diary",
      baseUrl,
      apiKey: "lms-diary-secret",
    })}\n`,
  );
  return homeDir;
}

function ok(response: import("node:http").ServerResponse, data: unknown) {
  response.writeHead(200, {
    "Content-Type": "application/json",
    "X-Request-Id": "req_diary",
  });
  response.end(JSON.stringify({ code: 0, message: "ok", data }));
}

describe("diary read commands", () => {
  it("lists an explicit real month through the daily-only endpoint", async () => {
    const requests: string[] = [];
    const document = {
      identifier: "20260730",
      duration_seconds: 120,
      extra: { city: "上海", keywords: ["复盘"], recording_count: 2 },
      title: "七月三十日",
      description: "一天",
      cover_thumbnail_url: null,
      cover_large_url: null,
      generated_at: "2026-07-30T15:00:00Z",
      updated_at: "2026-07-30T15:01:00Z",
    };
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      ok(response, [document]);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const capture = captureIo();
    try {
      expect(
        await main(
          ["node", "sharge", "diary", "list", "2026-07", "--json"],
          { env: {}, homeDir, cwd: homeDir, platform: process.platform },
          capture.io,
        ),
      ).toBe(0);
      expect(requests).toEqual([
        "/open-api/v1/ai-daily/reports/daily?year=2026&month=7",
      ]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        command: "diary.list",
        data: [document],
        meta: { requestId: "req_diary" },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("searches only daily documents and gets Markdown without rewriting it", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      if (request.url?.includes("/search")) {
        ok(response, [
          {
            identifier: "20260730",
            duration_seconds: 120,
            extra: { city: null, keywords: [], recording_count: 1 },
            title: "上海",
            description: null,
            cover_thumbnail_url: null,
            cover_large_url: null,
            generated_at: null,
            updated_at: "2026-07-30T15:01:00Z",
            matched_fields: ["title", "body"],
            matched_title: "上海",
            matched_body_excerpt: "今天在上海",
          },
        ]);
        return;
      }
      ok(response, {
        report_type: "daily",
        identifier: "20260730",
        status: "success",
        timezone: "Asia/Shanghai",
        period_start: "2026-07-29T16:00:00Z",
        period_end: "2026-07-30T16:00:00Z",
        title: "上海的一天",
        description: null,
        summary: "总结",
        duration_seconds: 120,
        markdown: "# 上海\n\n- 原样 Markdown",
        word_count: 4,
        generated_at: "2026-07-30T15:00:00Z",
        updated_at: "2026-07-30T15:01:00Z",
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    try {
      const search = captureIo();
      expect(
        await main(
          [
            "node",
            "sharge",
            "diary",
            "search",
            " 上海 ",
            "--limit",
            "7",
            "--json",
          ],
          { env: {}, homeDir, cwd: homeDir, platform: process.platform },
          search.io,
        ),
      ).toBe(0);
      expect(JSON.parse(search.stdout()).data[0].matched_fields).toEqual([
        "title",
        "body",
      ]);
      const get = captureIo();
      expect(
        await main(
          ["node", "sharge", "diary", "get", "20260730", "--json"],
          { env: {}, homeDir, cwd: homeDir, platform: process.platform },
          get.io,
        ),
      ).toBe(0);
      expect(JSON.parse(get.stdout()).data.markdown).toBe(
        "# 上海\n\n- 原样 Markdown",
      );
      expect(requests).toEqual([
        "/open-api/v1/ai-daily/reports/search?keyword=%E4%B8%8A%E6%B5%B7&limit=7",
        "/open-api/v1/ai-daily/reports/daily/20260730",
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("counts search keyword length as Unicode code points", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      ok(response, []);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const capture = captureIo();
    const keyword = "😀".repeat(150);
    try {
      expect(
        await main(
          ["node", "sharge", "diary", "search", keyword, "--json"],
          { env: {}, homeDir, cwd: homeDir, platform: process.platform },
          capture.io,
        ),
      ).toBe(0);
      expect(requests).toEqual([
        `/open-api/v1/ai-daily/reports/search?keyword=${encodeURIComponent(keyword)}&limit=20`,
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each([
    ["list", ["list", "2026-07"], { unexpected: true }],
    [
      "get",
      ["get", "20260730"],
      { report_type: "weekly", identifier: "2026W31" },
    ],
  ])("classifies an incomplete %s response as a server error with request metadata", async (_command, args, data) => {
    const server = createServer((_request, response) => ok(response, data));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const capture = captureIo();
    try {
      expect(
        await main(
          ["node", "sharge", "diary", ...args, "--json"],
          { env: {}, homeDir, cwd: homeDir, platform: process.platform },
          capture.io,
        ),
      ).toBe(8);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "SERVER_ERROR",
          nextActions: [{ command: "sharge doctor --json" }],
        },
        meta: { requestId: "req_diary", httpStatus: 200 },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each([
    [["list", "1899-12"], "month"],
    [["list", "2026-13"], "month"],
    [["get", "20260230"], "identifier"],
    [["search", "   "], "keyword"],
    [["search", "x", "--limit", "101"], "--limit"],
  ])("fast-fails invalid diary input %#", async (args, field) => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-diary-invalid-"));
    cleanupPaths.push(homeDir);
    const capture = captureIo();
    expect(
      await main(
        ["node", "sharge", "diary", ...args, "--json"],
        {
          env: { SHARGE_BASE_URL: "http://127.0.0.1:1" },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        capture.io,
      ),
    ).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      error: { type: "INVALID_INPUT", field },
      meta: { requestId: null },
    });
  });

  it("publishes daily-only help and rejects internal report capabilities", async () => {
    const runtime = {
      env: {},
      homeDir: tmpdir(),
      cwd: tmpdir(),
      platform: process.platform,
    };
    const namespaceHelp = captureIo();
    expect(
      await main(
        ["node", "sharge", "diary", "--help", "--json"],
        runtime,
        namespaceHelp.io,
      ),
    ).toBe(0);
    expect(JSON.parse(namespaceHelp.stdout()).data.description).toBe(
      "只读访问 Diary（日记）",
    );
    for (const alias of ["AI 日记", "闪极日记", "Loomos Diary"]) {
      expect(namespaceHelp.stdout()).not.toContain(alias);
    }
    for (const command of ["list", "search", "get"]) {
      const capture = captureIo();
      expect(
        await main(
          ["node", "sharge", "diary", command, "--help", "--json"],
          runtime,
          capture.io,
        ),
      ).toBe(0);
      expect(JSON.parse(capture.stdout()).data).toMatchObject({
        command: `diary.${command}`,
        requiredScopes: ["ai_daily:read"],
        sideEffects: [],
        retrySafe: true,
      });
      expect(capture.stdout()).not.toContain("weekly");
      expect(capture.stdout()).not.toContain("monthly");
    }
    for (const command of [
      "generate",
      "retry",
      "settings",
      "weekly",
      "monthly",
    ]) {
      const capture = captureIo();
      expect(
        await main(
          ["node", "sharge", "diary", command, "--json"],
          runtime,
          capture.io,
        ),
      ).toBe(2);
      expect(JSON.parse(capture.stdout()).meta.requestId).toBeNull();
    }
  });
});
