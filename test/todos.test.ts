import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
const todo = {
  id: "9007199254740993",
  title: "准备评审",
  start_time: null,
  timezone: "Asia/Shanghai",
  completed: false,
  source_type: "manual",
  source_id: null,
  draft: false,
  created_at: "2026-11-10T00:00:00Z",
  updated_at: "2026-11-10T00:00:00Z",
};
async function fixture(data: unknown = todo, status = 200, raw?: string) {
  const requests: { method?: string; url?: string; body: string }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, body });
    res.writeHead(status, { "content-type": "application/json" });
    res.end(raw ?? JSON.stringify({ code: 0, data }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw Error("TCP required");
  const home = await mkdtemp(join(tmpdir(), "sharge-todos-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  return {
    requests,
    async run(args: string[]) {
      let stdout = "";
      let stderr = "";
      const exit = await main(
        ["node", "sharge", ...args, "--json"],
        {
          env: {
            SHARGE_API_KEY: "fixture-key",
            SHARGE_BASE_URL: `http://127.0.0.1:${address.port}`,
            SHARGE_TIMEZONE: "Asia/Shanghai",
          },
          homeDir: home,
          cwd: home,
          platform: process.platform,
        },
        {
          stdout: (v) => {
            stdout += v;
          },
          stderr: (v) => {
            stderr += v;
          },
        },
      );
      return { exit, result: JSON.parse(stdout), stderr };
    },
  };
}

describe("todos public CLI", () => {
  it("reads one page with explicit defaults and exact cursor", async () => {
    const f = await fixture({
      items: [todo],
      next_cursor: "opaque/+==",
      has_more: true,
    });
    const r = await f.run(["todos", "list"]);
    expect(r.exit).toBe(0);
    expect(r.result.data.items[0].id).toBe(todo.id);
    const url = new URL(f.requests[0].url ?? "", "http://fixture");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.has("cursor")).toBe(false);
    expect(f.requests).toHaveLength(1);
    await f.run(["todos", "list", "--status", "all", "--cursor", "opaque/+=="]);
    expect(
      new URL(f.requests[1].url ?? "", "http://fixture").searchParams.get(
        "cursor",
      ),
    ).toBe("opaque/+==");
  });
  it("reads a todo ID without losing precision", async () => {
    const f = await fixture();
    const r = await f.run(["todos", "get", todo.id]);
    expect(r.exit).toBe(0);
    expect(f.requests[0].url).toBe(`/open-api/v1/todos/${todo.id}`);
  });
  it("creates and patches only supplied fields, retaining title whitespace", async () => {
    const f = await fixture(todo, 201);
    expect((await f.run(["todos", "create", "--title", "  标题  "])).exit).toBe(
      0,
    );
    expect(JSON.parse(f.requests[0].body)).toEqual({ title: "  标题  " });
    const p = await fixture();
    expect(
      (await p.run(["todos", "update", todo.id, "--clear-start-time"])).exit,
    ).toBe(0);
    expect(p.requests[0].method).toBe("PATCH");
    expect(JSON.parse(p.requests[0].body)).toEqual({ start_time: null });
  });
  it.each([
    "complete",
    "delete",
  ])("encodes exact integer literals and stable deduplication for %s", async (action) => {
    const f = await fixture({ changed_count: 0 });
    const args = [
      "todos",
      action,
      "--todo-id",
      todo.id,
      "--todo-id",
      "18446744073709551615",
      "--todo-id",
      todo.id,
    ];
    if (action === "complete") args.push("--completed", "false");
    else args.push("--yes");
    const r = await f.run(args);
    expect(r.exit).toBe(0);
    expect(r.result.data).toEqual({ changed_count: 0 });
    expect(f.requests[0].body).toContain(
      '"ids":[9007199254740993,18446744073709551615]',
    );
    if (action === "complete")
      expect(f.requests[0].body).toContain('"completed":false');
  });
  it.each([
    "0",
    "18446744073709551616",
    "1.5",
    "true",
    "-1",
  ])("rejects invalid id %s without sending", async (id) => {
    const f = await fixture();
    expect((await f.run(["todos", "get", id])).exit).toBe(2);
    expect(f.requests).toHaveLength(0);
  });
  it.each([
    '{"ids":[9007199254740993],"completed":true}',
    '{"ids":[true],"completed":true}',
    '{"ids":["0"],"completed":true}',
    JSON.stringify({
      ids: Array.from({ length: 101 }, () => "1"),
      completed: true,
    }),
  ])("rejects invalid bulk input %s", async (input) => {
    const f = await fixture();
    const r = await f.run(["todos", "complete", "--input", input]);
    expect(r.exit).toBe(2);
    expect(r.result.error.type).toBe("INVALID_INPUT");
    expect(f.requests).toHaveLength(0);
  });
  it("requires yes for deletion and keeps dry-run offline", async () => {
    const f = await fixture();
    expect((await f.run(["todos", "delete", "--todo-id", "1"])).exit).toBe(2);
    const r = await f.run([
      "todos",
      "delete",
      "--todo-id",
      todo.id,
      "--dry-run",
    ]);
    expect(r.exit).toBe(0);
    expect(r.result.data.retrySafe).toBe(false);
    expect(f.requests).toHaveLength(0);
  });
  it.each([
    "create",
    "update",
    "complete",
    "delete",
  ])("reports incomplete %s receipts as unknown without replay", async (action) => {
    const f = await fixture({}, action === "create" ? 201 : 200);
    const args =
      action === "create"
        ? ["--title", "标题"]
        : action === "update"
          ? [todo.id, "--title", "标题"]
          : [
              "--todo-id",
              todo.id,
              ...(action === "complete" ? ["--completed", "true"] : ["--yes"]),
            ];
    const r = await f.run(["todos", action, ...args]);
    expect(r.exit).toBe(8);
    expect(r.result.error.outcome).toBe("unknown");
    expect(r.result.error.retryable).toBe(false);
    expect(f.requests).toHaveLength(1);
    expect(JSON.stringify(r.result.error.nextActions)).toContain(
      action === "create"
        ? "sharge todos list --json"
        : `sharge todos get ${todo.id} --json`,
    );
  });
  it("reports malformed successful writes as unknown", async () => {
    const f = await fixture(null, 201, "{");
    const r = await f.run(["todos", "create", "--title", "标题"]);
    expect(r.result.error.outcome).toBe("unknown");
    expect(f.requests).toHaveLength(1);
  });
  it("preserves numeric response IDs above the safe range as strings", async () => {
    const raw = JSON.stringify({ code: 0, data: todo }).replace(
      `"${todo.id}"`,
      todo.id,
    );
    const f = await fixture(null, 200, raw);
    const r = await f.run(["todos", "get", todo.id]);
    expect(r.exit).toBe(0);
    expect(r.result.data.id).toBe(todo.id);
  });
  it("requires HTTP 201 for a complete create receipt", async () => {
    const f = await fixture(todo, 200);
    const r = await f.run(["todos", "create", "--title", "标题"]);
    expect(r.result.error.outcome).toBe("unknown");
    expect(f.requests).toHaveLength(1);
  });
  it.each([
    ["update", "--input", '{"title":null}'],
    ["update", "--input", "{}"],
    ["create", "--title", "   "],
    ["create", "--title", "标题", "--start-time", "2026-11-12T10:00:00"],
    ["update", "--start-time", "2026-11-12T10:00:00Z", "--clear-start-time"],
    ["list", "--limit", "101"],
    ["list", "--status", "unknown"],
  ])("rejects invalid todo options %s", async (action, ...args) => {
    const f = await fixture();
    const r = await f.run([
      "todos",
      action,
      ...(action === "update" ? [todo.id] : []),
      ...args,
    ]);
    expect(r.exit).toBe(2);
    expect(f.requests).toHaveLength(0);
  });
  it("accepts an explicit UTC offset for todo timezone without changing request timezone", async () => {
    const f = await fixture(todo, 201);
    const r = await f.run([
      "todos",
      "create",
      "--title",
      "标题",
      "--timezone",
      "UTC+08:00",
    ]);
    expect(r.exit).toBe(0);
    expect(JSON.parse(f.requests[0].body).timezone).toBe("UTC+08:00");
  });
  it("routes a Calendar todo detail to the Todos read command", async () => {
    const f = await fixture({ ...todo, type: "todo" });
    const r = await f.run(["calendar", "get", todo.id]);
    expect(r.exit).toBe(5);
    expect(r.result.error.message).toBe(
      "该 ID 是待办，不是日程；改用 sharge todos get 读取。",
    );
    expect(r.result.error.nextActions[0].command).toBe(
      `sharge todos get ${todo.id} --json`,
    );
  });
  it("rejects removed Calendar todo commands and type inputs", async () => {
    const f = await fixture();
    expect((await f.run(["calendar", "todos", "set-status"])).exit).toBe(2);
    expect(
      (
        await f.run([
          "calendar",
          "create",
          "--type",
          "todo",
          "--title",
          "标题",
          "--start-time",
          "2026-11-10T00:00:00Z",
          "--dry-run",
        ])
      ).exit,
    ).toBe(2);
    expect(f.requests).toHaveLength(0);
  });
});
