import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

describe("auth scopes", () => {
  it("returns the OpenAPI scope catalog unchanged", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-auth-scopes-"));
    const configDir = join(homeDir, ".sharge");
    await mkdir(configDir, { mode: 0o700 });
    const catalog = [
      {
        scope: "quick_notes:read",
        business_namespace: "user_memory",
        access: "read",
        name: "读取 Quick Note",
        description: "读取、搜索 Quick Note 及下载其媒体文件",
        granted: true,
      },
    ];
    const server = createServer((request, response) => {
      expect(request.url).toBe("/open-api/v1/auth/scopes");
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_scopes",
      });
      response.end(JSON.stringify({ code: 0, message: "ok", data: catalog }));
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
        installationId: "install_scopes",
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "lms-scopes-secret",
      })}\n`,
      { mode: 0o600 },
    );
    let stdout = "";
    try {
      const exitCode = await main(
        ["node", "sharge", "auth", "scopes", "--json"],
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
      expect(JSON.parse(stdout)).toMatchObject({
        command: "auth.scopes",
        data: catalog,
        meta: { requestId: "req_scopes" },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
