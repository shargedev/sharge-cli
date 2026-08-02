import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
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
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-recording-download-"));
  cleanupPaths.push(homeDir);
  await mkdir(join(homeDir, ".sharge"), { mode: 0o700 });
  await writeFile(
    join(homeDir, ".sharge", "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_recording_download",
      baseUrl,
      apiKey: "lms-recording-download-secret",
    })}\n`,
    { mode: 0o600 },
  );
  return homeDir;
}

describe("recordings download command", () => {
  it("exposes the complete agent-facing download contract", async () => {
    const capture = captureIo();
    expect(
      await main(
        ["node", "sharge", "recordings", "download", "--help", "--json"],
        {
          env: {},
          homeDir: tmpdir(),
          cwd: tmpdir(),
          platform: process.platform,
        },
        capture.io,
      ),
    ).toBe(0);
    const help = JSON.parse(capture.stdout()).data;
    expect(help.errors).toEqual([...new Set(help.errors)]);
    expect(help).toMatchObject({
      command: "recordings.download",
      requiredScopes: ["voicemaster:read"],
      network: true,
      sideEffects: ["write_download_file"],
      destructive: false,
      dryRun: true,
      retrySafe: true,
      timeout: 600000,
      pagination: null,
      outputSchema: {
        anyOf: [
          { required: ["filePath", "bytes", "mediaType", "sha256"] },
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
  });

  it("downloads real bytes through the shared safe pipeline", async () => {
    const media = Buffer.from("recording-audio");
    const requests: Array<{
      url: string | undefined;
      authorization: string | undefined;
    }> = [];
    const server = createServer((request, response) => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
      });
      response.writeHead(200, {
        "Content-Type": "audio/mp4",
        "X-Request-Id": "req_recording_download",
      });
      response.end(media);
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-recording-download-cwd-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      const exitCode = await main(
        ["node", "sharge", "recordings", "download", "101", "--json"],
        {
          env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      );

      expect(exitCode).toBe(0);
      expect(requests).toEqual([
        {
          url: "/open-api/v1/voicemaster/recordings/101/audio/download",
          authorization: "Bearer lms-recording-download-secret",
        },
      ]);
      const filePath = resolve(cwd, "recording-101.m4a");
      expect(await readFile(filePath)).toEqual(media);
      expect(await readdir(cwd)).toEqual(["recording-101.m4a"]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        command: "recordings.download",
        data: {
          filePath,
          bytes: media.byteLength,
          mediaType: "audio/mp4",
          sha256: createHash("sha256").update(media).digest("hex"),
        },
        meta: {
          requestId: "req_recording_download",
          timezone: "Asia/Shanghai",
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("returns an offline fallback plan without credentials or file creation", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-recording-dry-home-"));
    const cwd = await mkdtemp(join(tmpdir(), "sharge-recording-dry-cwd-"));
    cleanupPaths.push(homeDir, cwd);
    const capture = captureIo();

    expect(
      await main(
        [
          "node",
          "sharge",
          "recordings",
          "download",
          "101",
          "--dry-run",
          "--json",
        ],
        {
          env: {
            SHARGE_BASE_URL: "https://ai.shargetech.com",
            SHARGE_API_KEY: "invalid-and-unused",
          },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      ),
    ).toBe(0);
    expect(await readdir(cwd)).toEqual([]);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      command: "recordings.download",
      data: {
        method: "GET",
        url: "https://ai.shargetech.com/open-api/v1/voicemaster/recordings/101/audio/download",
        path: "/open-api/v1/voicemaster/recordings/101/audio/download",
        filePath: resolve(cwd, "recording-101.m4a"),
        fileNameSource: "fallback",
        overwrite: false,
        requiredScopes: ["voicemaster:read"],
        unverified: [
          "remote_media_exists",
          "content_disposition_filename",
          "target_name_still_available",
        ],
      },
      meta: { requestId: null },
    });
  });

  it("uses safe suffixes and only overwrites an explicit target", async () => {
    const media = Buffer.from("new-audio");
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, {
        "Content-Type": "audio/mp4",
        "Content-Disposition": 'attachment; filename="meeting.m4a"',
      });
      response.end(media);
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-recording-collision-"));
    cleanupPaths.push(cwd);
    await writeFile(resolve(cwd, "meeting.m4a"), "old-generated");
    const explicitName = "it's $(danger); path.m4a";
    await writeFile(resolve(cwd, explicitName), "old-explicit");

    try {
      const generated = captureIo();
      expect(
        await main(
          ["node", "sharge", "recordings", "download", "101", "--json"],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          generated.io,
        ),
      ).toBe(0);
      expect(JSON.parse(generated.stdout()).data.filePath).toBe(
        resolve(cwd, "meeting-1.m4a"),
      );

      const refused = captureIo();
      expect(
        await main(
          [
            "node",
            "sharge",
            "recordings",
            "download",
            "101",
            "--file",
            `./${explicitName}`,
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          refused.io,
        ),
      ).toBe(2);
      expect(requests).toBe(1);
      expect(JSON.parse(refused.stdout())).toMatchObject({
        error: {
          type: "FILE_EXISTS",
          nextActions: [
            {
              command:
                "sharge recordings download 101 --file './it'\\''s $(danger); path.m4a' --overwrite --json",
            },
          ],
        },
      });

      const overwritten = captureIo();
      expect(
        await main(
          [
            "node",
            "sharge",
            "recordings",
            "download",
            "101",
            "--file",
            `./${explicitName}`,
            "--overwrite",
            "--json",
          ],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          overwritten.io,
        ),
      ).toBe(0);
      expect(await readFile(resolve(cwd, explicitName))).toEqual(media);
      expect(requests).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("never forwards Authorization to a redirect target", async () => {
    const media = Buffer.from("redirected-audio");
    let redirectedAuthorization: string | undefined;
    const mediaServer = createServer((request, response) => {
      redirectedAuthorization = request.headers.authorization;
      response.writeHead(200, {
        "Content-Type": "audio/aac",
        "Content-Disposition": 'attachment; filename="redirected.aac"',
      });
      response.end(media);
    });
    await new Promise<void>((resolveListen) =>
      mediaServer.listen(0, "127.0.0.1", resolveListen),
    );
    const mediaAddress = mediaServer.address();
    if (!mediaAddress || typeof mediaAddress === "string") {
      throw new Error("expected media address");
    }
    const apiServer = createServer((_request, response) => {
      response.writeHead(307, {
        Location: `http://127.0.0.1:${mediaAddress.port}/signed?secret=value`,
        "Content-Disposition": 'attachment; filename="from-api.m4a"',
        "X-Request-Id": "req_recording_redirect",
      });
      response.end();
    });
    await new Promise<void>((resolveListen) =>
      apiServer.listen(0, "127.0.0.1", resolveListen),
    );
    const apiAddress = apiServer.address();
    if (!apiAddress || typeof apiAddress === "string") {
      throw new Error("expected API address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${apiAddress.port}`);
    const cwd = await mkdtemp(join(tmpdir(), "sharge-recording-redirect-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      expect(
        await main(
          ["node", "sharge", "recordings", "download", "101", "--json"],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(0);
      expect(redirectedAuthorization).toBeUndefined();
      expect(await readFile(resolve(cwd, "redirected.aac"))).toEqual(media);
      expect(capture.stdout()).not.toContain("secret=value");
      expect(capture.stderr()).not.toContain("secret=value");
    } finally {
      for (const server of [apiServer, mediaServer]) {
        server.closeAllConnections();
        await new Promise<void>((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
      }
    }
  });

  it("maps 404 to recordings get and leaves no partial file", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(404, {
        "Content-Type": "application/json",
        "X-Request-Id": "req_recording_missing",
      });
      response.end(
        JSON.stringify({ code: 404, message: "audio missing", data: null }),
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
    const cwd = await mkdtemp(join(tmpdir(), "sharge-recording-missing-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      expect(
        await main(
          ["node", "sharge", "recordings", "download", "404", "--json"],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(5);
      expect(await readdir(cwd)).toEqual([]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "NOT_FOUND",
          nextActions: [{ command: "sharge recordings get 404 --json" }],
        },
        meta: { requestId: "req_recording_missing" },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("preserves requestId on an incomplete body and cleans temporary files", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "audio/mp4",
        "Content-Disposition": 'attachment; filename="partial.m4a"',
        "Content-Length": "100",
        "X-Request-Id": "req_recording_partial",
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
    const cwd = await mkdtemp(join(tmpdir(), "sharge-recording-partial-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();

    try {
      expect(
        await main(
          ["node", "sharge", "recordings", "download", "101", "--json"],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(8);
      expect(await readdir(cwd)).toEqual([]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "NETWORK_ERROR",
          retryable: true,
          nextActions: [
            { command: "sharge recordings download --help --json" },
          ],
        },
        meta: { requestId: "req_recording_partial" },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("classifies local reservation failures as non-retryable file errors", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "audio/mp4",
        "X-Request-Id": "req_recording_file_error",
      });
      response.end("audio");
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const homeDir = await setupHome(`http://127.0.0.1:${address.port}`);
    const missingCwd = resolve(
      tmpdir(),
      `sharge-missing-download-${Date.now()}`,
    );
    const capture = captureIo();

    try {
      expect(
        await main(
          ["node", "sharge", "recordings", "download", "101", "--json"],
          {
            env: { SHARGE_TIMEZONE: "Asia/Shanghai" },
            homeDir,
            cwd: missingCwd,
            platform: process.platform,
          },
          capture.io,
        ),
      ).toBe(1);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "FILE_IO_ERROR",
          retryable: false,
          nextActions: [
            { command: "sharge recordings download --help --json" },
          ],
        },
        meta: { requestId: "req_recording_file_error" },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it("uses recordings recovery when the download is cancelled", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "audio/mp4",
        "Content-Disposition": 'attachment; filename="cancelled.m4a"',
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
    const cwd = await mkdtemp(join(tmpdir(), "sharge-recording-cancel-"));
    cleanupPaths.push(cwd);
    const capture = captureIo();
    const controller = new AbortController();
    const cancel = setTimeout(() => controller.abort(), 20);

    try {
      expect(
        await main(
          ["node", "sharge", "recordings", "download", "101", "--json"],
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
      expect(await readdir(cwd)).toEqual([]);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        error: {
          type: "CANCELLED",
          nextActions: [
            { command: "sharge recordings download --help --json" },
          ],
        },
      });
    } finally {
      clearTimeout(cancel);
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });

  it.each([
    [["0"], "recording-id"],
    [["101", "--file", "-"], "--file"],
    [["101", "--overwrite"], "--overwrite"],
  ])("fast-fails invalid input %# before network", async (args, field) => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-recording-invalid-"));
    const cwd = await mkdtemp(join(tmpdir(), "sharge-recording-invalid-cwd-"));
    cleanupPaths.push(homeDir, cwd);
    const capture = captureIo();
    expect(
      await main(
        ["node", "sharge", "recordings", "download", ...args, "--json"],
        {
          env: { SHARGE_BASE_URL: "http://127.0.0.1:1" },
          homeDir,
          cwd,
          platform: process.platform,
        },
        capture.io,
      ),
    ).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      error: { type: "INVALID_INPUT", field },
      meta: { requestId: null },
    });
    expect(await readdir(cwd)).toEqual([]);
  });
});
