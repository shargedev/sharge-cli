import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-download-"));
  cleanupPaths.push(homeDir);
  await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
  await writeFile(
    join(homeDir, ".sharge", "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_notes_download",
      baseUrl,
      apiKey: "lms-notes-download-secret",
    })}\n`,
    { mode: 0o600 },
  );
  return homeDir;
}

describe("notes download command", () => {
  it("self-documents its required input, output, safety, and recovery contract", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-help-home-"));
    cleanupPaths.push(homeDir);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-help-cwd-"));
    cleanupPaths.push(cwd);
    const jsonCapture = captureIo();

    expect(
      await main(
        ["node", "sharge", "notes", "download", "--help", "--json"],
        {
          env: {},
          homeDir,
          cwd,
          platform: process.platform,
        },
        jsonCapture.io,
      ),
    ).toBe(0);
    const help = JSON.parse(jsonCapture.stdout()).data;
    expect(help).toMatchObject({
      command: "notes.download",
      requiredScopes: ["quick_notes:read"],
      network: true,
      dryRun: true,
      retrySafe: true,
      timeout: 600_000,
      sideEffects: ["write_download_file"],
      outputSchema: {
        anyOf: [
          {
            required: ["filePath", "bytes", "mediaType", "sha256"],
          },
          {
            required: [
              "method",
              "url",
              "path",
              "filePath",
              "fileNameSource",
              "overwrite",
              "requiredScopes",
              "unverified",
            ],
          },
        ],
      },
    });
    expect(help.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "--media",
          required: true,
          enum: ["audio", "image", "video"],
        }),
        expect.objectContaining({ name: "--file" }),
        expect.objectContaining({ name: "--overwrite", default: false }),
        expect.objectContaining({ name: "--dry-run", default: false }),
        expect.objectContaining({ name: "--timeout", default: "10m" }),
      ]),
    );
    expect(help.errors).toEqual(
      expect.arrayContaining([
        "CANCELLED",
        "FILE_EXISTS",
        "INVALID_INPUT",
        "NETWORK_ERROR",
        "TIMEOUT",
      ]),
    );
    expect(help.examples).toEqual(
      expect.arrayContaining([
        "sharge notes download 123 --media image --file ./photo.jpg --overwrite --json",
        "sharge notes download 123 --media image --dry-run --json",
      ]),
    );

    const textCapture = captureIo();
    expect(
      await main(
        ["node", "sharge", "notes", "download", "--help"],
        {
          env: {},
          homeDir,
          cwd,
          platform: process.platform,
        },
        textCapture.io,
      ),
    ).toBe(0);
    expect(textCapture.stdout()).toContain("--media（必填）");
    expect(textCapture.stdout()).toContain(
      "sharge notes download 123 --media image --dry-run --json",
    );
  });

  it("downloads direct binary content to a safe default absolute path", async () => {
    const image = Buffer.from("seed-image-content");
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
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="seed-photo.png"',
        "Content-Length": String(image.byteLength),
        "X-Request-Id": "req_notes_download",
      });
      response.end(image);
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-download-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "download",
          "123",
          "--media",
          "image",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      );

      const filePath = resolve(cwd, "seed-photo.png");
      expect(exitCode).toBe(0);
      expect(requests).toEqual([
        {
          method: "GET",
          url: "/open-api/v1/user-memory/quick-notes/123/media/image/download",
          authorization: "Bearer lms-notes-download-secret",
        },
      ]);
      expect(await readFile(filePath)).toEqual(image);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "notes.download",
        data: {
          filePath,
          bytes: image.byteLength,
          mediaType: "image/png",
          sha256: createHash("sha256").update(image).digest("hex"),
        },
        meta: {
          requestId: "req_notes_download",
          timezone: "Asia/Shanghai",
        },
      });
      expect(capture.stdout()).not.toContain("seed-image-content");
      expect(capture.stderr()).toBe("");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("follows an HTTP redirect without forwarding Authorization cross-origin", async () => {
    const media = Buffer.from("redirected-image");
    let redirectedAuthorization: string | undefined;
    const mediaServer = createServer((request, response) => {
      redirectedAuthorization = request.headers.authorization;
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Disposition": 'attachment; filename="redirected.jpg"',
      });
      response.end(media);
    });
    await new Promise<void>((resolveListen) =>
      mediaServer.listen(0, "127.0.0.1", resolveListen),
    );
    const mediaAddress = mediaServer.address();
    if (!mediaAddress || typeof mediaAddress === "string") {
      throw new Error("expected media TCP address");
    }
    const signedSecret = "signed-query-secret";
    const apiServer = createServer((_request, response) => {
      response.writeHead(307, {
        Location: `http://127.0.0.1:${mediaAddress.port}/media.jpg?signature=${signedSecret}`,
        "Content-Disposition": 'attachment; filename="api-name.jpg"',
        "X-Request-Id": "req_redirect",
      });
      response.end();
    });
    await new Promise<void>((resolveListen) =>
      apiServer.listen(0, "127.0.0.1", resolveListen),
    );
    const apiAddress = apiServer.address();
    if (!apiAddress || typeof apiAddress === "string") {
      throw new Error("expected API TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${apiAddress.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-redirect-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "download",
          "123",
          "--media",
          "image",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(redirectedAuthorization).toBeUndefined();
      expect(await readFile(resolve(cwd, "redirected.jpg"))).toEqual(media);
      expect(capture.stdout()).not.toContain(signedSecret);
      expect(capture.stderr()).not.toContain(signedSecret);
      const log = await readFile(
        resolve(homeDir, ".sharge", "sharge.log"),
        "utf8",
      );
      expect(log).not.toContain(signedSecret);
      expect(log).not.toContain("signature=");
    } finally {
      for (const server of [apiServer, mediaServer]) {
        server.closeAllConnections();
        await new Promise<void>((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
      }
    }
  });

  it("follows a validated Open Platform JSON redirect", async () => {
    const media = Buffer.from("json-redirect-image");
    let redirectedAuthorization: string | undefined;
    const mediaServer = createServer((request, response) => {
      redirectedAuthorization = request.headers.authorization;
      response.writeHead(200, {
        "Content-Type": "image/webp",
        "Content-Disposition": 'attachment; filename="json-photo.webp"',
      });
      response.end(media);
    });
    await new Promise<void>((resolveListen) =>
      mediaServer.listen(0, "127.0.0.1", resolveListen),
    );
    const mediaAddress = mediaServer.address();
    if (!mediaAddress || typeof mediaAddress === "string") {
      throw new Error("expected media TCP address");
    }
    const apiServer = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_json_redirect",
      });
      response.end(
        JSON.stringify({
          code: 0,
          data: {
            url: `http://127.0.0.1:${mediaAddress.port}/json-photo.webp`,
          },
        }),
      );
    });
    await new Promise<void>((resolveListen) =>
      apiServer.listen(0, "127.0.0.1", resolveListen),
    );
    const apiAddress = apiServer.address();
    if (!apiAddress || typeof apiAddress === "string") {
      throw new Error("expected API TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${apiAddress.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-json-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "download",
          "123",
          "--media",
          "image",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(redirectedAuthorization).toBeUndefined();
      expect(await readFile(resolve(cwd, "json-photo.webp"))).toEqual(media);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        data: {
          filePath: resolve(cwd, "json-photo.webp"),
          mediaType: "image/webp",
        },
        meta: { requestId: "req_json_redirect" },
      });
    } finally {
      for (const server of [apiServer, mediaServer]) {
        server.closeAllConnections();
        await new Promise<void>((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
      }
    }
  });

  it("preserves cancellation while reading a JSON redirect body", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.flushHeaders();
      response.write('{"code":0,"data":');
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-json-cancel-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();
    const controller = new AbortController();
    const cancel = setTimeout(() => controller.abort(), 20);

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
            signal: controller.signal,
          },
          capture.io,
        ),
      ).toBe(130);
      expect(JSON.parse(capture.stdout()).error.type).toBe("CANCELLED");
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      clearTimeout(cancel);
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("fails before network when an explicit target exists without --overwrite", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-explicit-cwd-"));
    cleanupPaths.push(cwd);
    const targetPath = resolve(cwd, "existing.jpg");
    await writeFile(targetPath, "original");
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "download",
          "123",
          "--media",
          "image",
          "--file",
          "./existing.jpg",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(2);
      expect(requests).toBe(0);
      expect(await readFile(targetPath, "utf8")).toBe("original");
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "FILE_EXISTS",
          field: "--file",
          nextActions: [
            {
              command:
                "sharge notes download 123 --media image --file './existing.jpg' --overwrite --json",
            },
          ],
        },
        meta: { requestId: null },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("atomically replaces an explicit regular file only with --overwrite", async () => {
    const replacement = Buffer.from("replacement-image");
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Disposition": 'attachment; filename="ignored-name.jpg"',
      });
      response.end(replacement);
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-overwrite-cwd-"));
    cleanupPaths.push(cwd);
    const targetPath = resolve(cwd, "explicit.jpg");
    await writeFile(targetPath, "original");
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "download",
          "123",
          "--media",
          "image",
          "--file",
          "./explicit.jpg",
          "--overwrite",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(await readFile(targetPath)).toEqual(replacement);
      expect(JSON.parse(capture.stdout()).data.filePath).toBe(targetPath);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("chooses a safe suffixed name before reading a duplicate download body", async () => {
    const content = Buffer.from("duplicate-image");
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="duplicate.png"',
      });
      response.end(content);
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-duplicate-cwd-"));
    cleanupPaths.push(cwd);
    const runtime = {
      env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
      homeDir,
      cwd,
      platform: process.platform,
    };

    try {
      const paths: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const capture = captureIo();
        expect(
          await main(
            [
              "node",
              "sharge",
              "notes",
              "download",
              "123",
              "--media",
              "image",
              "--json",
            ],
            runtime,
            capture.io,
          ),
        ).toBe(0);
        paths.push(JSON.parse(capture.stdout()).data.filePath);
      }

      expect(requests).toBe(2);
      expect(paths).toEqual([
        resolve(cwd, "duplicate.png"),
        resolve(cwd, "duplicate-1.png"),
      ]);
      await expect(readFile(paths[0])).resolves.toEqual(content);
      await expect(readFile(paths[1])).resolves.toEqual(content);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("returns an offline download plan without credentials or file creation", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-dry-home-"));
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-dry-cwd-"));
    cleanupPaths.push(homeDir, cwd);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "download",
          "123",
          "--media",
          "image",
          "--dry-run",
          "--json",
        ],
        {
          env: {
            SHARGE_API_KEY: "invalid-and-unused",
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
      expect(await readdir(cwd)).toEqual([]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        ok: true,
        command: "notes.download",
        data: {
          method: "GET",
          url: `http://127.0.0.1:${address.port}/open-api/v1/user-memory/quick-notes/123/media/image/download`,
          path: "/open-api/v1/user-memory/quick-notes/123/media/image/download",
          filePath: resolve(cwd, "note-123-image.jpg"),
          fileNameSource: "fallback",
          overwrite: false,
          requiredScopes: ["quick_notes:read"],
          unverified: [
            "remote_media_exists",
            "content_disposition_filename",
            "target_name_still_available",
          ],
        },
        meta: { requestId: null },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("removes the reservation and temporary file after an incomplete body", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="partial.png"',
        "Content-Length": "100",
      });
      response.flushHeaders();
      response.write("partial");
      setTimeout(() => response.destroy(), 10);
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-partial-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "download",
          "123",
          "--media",
          "image",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(8);
      expect(JSON.parse(capture.stdout()).error.type).toBe("NETWORK_ERROR");
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("reports a body timeout and removes every reserved download file", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="slow.png"',
      });
      response.flushHeaders();
      response.write("partial");
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-timeout-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--timeout",
            "1s",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(8);
      expect(JSON.parse(capture.stdout()).error.type).toBe("TIMEOUT");
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("reports user cancellation distinctly and removes every reserved file", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="cancelled.png"',
      });
      response.flushHeaders();
      response.write("partial");
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-cancel-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();
    const controller = new AbortController();
    const cancel = setTimeout(() => controller.abort(), 20);

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
            signal: controller.signal,
          },
          capture.io,
        ),
      ).toBe(130);
      expect(JSON.parse(capture.stdout()).error.type).toBe("CANCELLED");
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      clearTimeout(cancel);
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("maps an initial download API error without creating a file", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(401, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_download_401",
      });
      response.end(
        JSON.stringify({
          code: 401,
          message: "credential rejected",
          data: null,
        }),
      );
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-error-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "download",
          "123",
          "--media",
          "image",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(3);
      expect(await readdir(cwd)).toEqual([]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "CREDENTIAL_INVALID",
          nextActions: [{ command: "sharge login --force" }],
        },
        meta: {
          requestId: "req_download_401",
          httpStatus: 401,
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("preserves cancellation while reading an initial API error body", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.flushHeaders();
      response.write('{"code":403,"message":');
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-error-cancel-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();
    const controller = new AbortController();
    const cancel = setTimeout(() => controller.abort(), 20);

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
            signal: controller.signal,
          },
          capture.io,
        ),
      ).toBe(130);
      expect(JSON.parse(capture.stdout()).error.type).toBe("CANCELLED");
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      clearTimeout(cancel);
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("enriches a download 403 with the complete scope recovery command", async () => {
    const requestedPaths: string[] = [];
    const server = createServer((request, response) => {
      requestedPaths.push(request.url ?? "");
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/open-api/v1/auth/status") {
        response.writeHead(200);
        response.end(
          JSON.stringify({
            code: 0,
            message: "ok",
            data: {
              user_id: "download-user",
              auth_type: "api_key",
              scopes: ["calendar:read"],
            },
          }),
        );
        return;
      }
      response.writeHead(403, { "X-Request-Id": "req_download_403" });
      response.end(
        JSON.stringify({
          code: 403,
          message: "scope missing",
          data: null,
        }),
      );
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-scope-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "download",
          "123",
          "--media",
          "image",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(4);
      expect(requestedPaths).toEqual([
        "/open-api/v1/user-memory/quick-notes/123/media/image/download",
        "/open-api/v1/auth/status",
      ]);
      expect(await readdir(cwd)).toEqual([]);
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
        meta: {
          requestId: "req_download_403",
          httpStatus: 403,
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("rejects redirect URLs with credentials without leaking them", async () => {
    const redirectCredential = "redirect-password";
    const server = createServer((_request, response) => {
      response.writeHead(307, {
        Location: `http://download-user:${redirectCredential}@127.0.0.1/file`,
      });
      response.end();
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-bad-url-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      const exitCode = await main(
        [
          "node",
          "sharge",
          "notes",
          "download",
          "123",
          "--media",
          "image",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(8);
      expect(await readdir(cwd)).toEqual([]);
      expect(capture.stdout()).not.toContain(redirectCredential);
      expect(capture.stderr()).not.toContain(redirectCredential);
      expect(
        await readFile(resolve(homeDir, ".sharge", "sharge.log"), "utf8"),
      ).not.toContain(redirectCredential);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("stops after five download redirects", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(307, { Location: "/loop" });
      response.end();
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-loop-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(8);
      expect(requests).toBe(6);
      expect(await readdir(cwd)).toEqual([]);
      expect(JSON.parse(capture.stdout()).error.type).toBe("SERVER_ERROR");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("falls back when Content-Disposition cannot produce a safe basename", async () => {
    const content = Buffer.from("fallback-image");
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Disposition": 'attachment; filename="../../"',
      });
      response.end(content);
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-fallback-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(0);
      const filePath = resolve(cwd, "note-123-image.jpg");
      expect(JSON.parse(capture.stdout()).data.filePath).toBe(filePath);
      expect(await readFile(filePath)).toEqual(content);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("rejects an explicit symlink target before network access", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-symlink-cwd-"));
    cleanupPaths.push(cwd);
    const outsidePath = resolve(homeDir, "outside.jpg");
    await writeFile(outsidePath, "outside");
    await symlink(outsidePath, resolve(cwd, "target.jpg"));
    const capture = captureIo();

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--file",
            "./target.jpg",
            "--overwrite",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(2);
      expect(requests).toBe(0);
      expect(await readFile(outsidePath, "utf8")).toBe("outside");
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "INVALID_INPUT",
          field: "--file",
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("rejects a symlink ancestor before overwriting an explicit target", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-parent-link-cwd-"));
    cleanupPaths.push(cwd);
    const outsideDirectory = resolve(homeDir, "outside-downloads");
    await mkdir(outsideDirectory);
    const outsidePath = resolve(outsideDirectory, "target.jpg");
    await writeFile(outsidePath, "outside");
    await symlink(outsideDirectory, resolve(cwd, "linked"));
    const capture = captureIo();

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--file",
            "./linked/target.jpg",
            "--overwrite",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(2);
      expect(requests).toBe(0);
      expect(await readFile(outsidePath, "utf8")).toBe("outside");
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "INVALID_INPUT",
          field: "--file",
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("rechecks symlink ancestors after response headers before reserving", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-notes-swap-home-"));
    cleanupPaths.push(homeDir);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-swap-cwd-"));
    cleanupPaths.push(cwd);
    const targetDirectory = resolve(cwd, "downloads");
    const movedDirectory = resolve(cwd, "downloads-before-swap");
    const outsideDirectory = resolve(homeDir, "outside-downloads");
    await mkdir(targetDirectory);
    await mkdir(outsideDirectory);
    await writeFile(resolve(targetDirectory, "target.jpg"), "original");
    await writeFile(resolve(outsideDirectory, "target.jpg"), "outside");
    const server = createServer(async (_request, response) => {
      await rename(targetDirectory, movedDirectory);
      await symlink(outsideDirectory, targetDirectory);
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Disposition": 'attachment; filename="target.jpg"',
      });
      response.end("replacement");
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    await mkdir(resolve(homeDir, ".sharge"), { mode: 0o700 });
    await writeFile(
      resolve(homeDir, ".sharge", "settings.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        installationId: "install_swap",
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "lms-swap-secret",
      })}\n`,
    );
    const capture = captureIo();

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--file",
            "./downloads/target.jpg",
            "--overwrite",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(2);
      expect(JSON.parse(capture.stdout()).error.type).toBe("INVALID_INPUT");
      expect(
        await readFile(resolve(movedDirectory, "target.jpg"), "utf8"),
      ).toBe("original");
      expect(
        await readFile(resolve(outsideDirectory, "target.jpg"), "utf8"),
      ).toBe("outside");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("rejects --file - as an explicit unsupported download target", async () => {
    const homeDir = await setupHome("http://127.0.0.1:9");
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-stdout-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    expect(
      await main(
        [
          "node",
          "sharge",
          "notes",
          "download",
          "123",
          "--media",
          "image",
          "--file",
          "-",
          "--json",
        ],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      ),
    ).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      error: {
        type: "INVALID_INPUT",
        field: "--file",
      },
    });
    expect(await readdir(cwd)).toEqual([]);
  });

  it("rejects an explicit directory target before network access", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-directory-cwd-"));
    cleanupPaths.push(cwd);
    await mkdir(resolve(cwd, "target.jpg"));
    const capture = captureIo();

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--file",
            "./target.jpg",
            "--overwrite",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(2);
      expect(requests).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "INVALID_INPUT",
          field: "--file",
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("rejects an explicit target whose parent directory does not exist", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-parent-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--file",
            "./missing/target.jpg",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(2);
      expect(requests).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "INVALID_INPUT",
          field: "--file",
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("rejects --overwrite without an explicit --file before network access", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-notes-overwrite-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      expect(
        await main(
          [
            "node",
            "sharge",
            "notes",
            "download",
            "123",
            "--media",
            "image",
            "--overwrite",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(2);
      expect(requests).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "INVALID_INPUT",
          field: "--overwrite",
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });
});
