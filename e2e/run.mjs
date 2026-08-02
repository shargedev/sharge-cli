import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmod,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };
import {
  mergeProcessOptions,
  runBuiltCli,
  runProcess,
} from "./helpers/run-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const aiGlassRoot = process.env.SHARGE_AI_GLASS_ROOT;
if (!aiGlassRoot) {
  throw new Error(
    "缺少 SHARGE_AI_GLASS_ROOT；请将它设置为 ai_glass 仓库的绝对路径。",
  );
}
const agentRuntime =
  process.env.SHARGE_AGENT_RUNTIME ?? resolve(aiGlassRoot, ".agent/bin/agent");
const sliceIndex = process.argv.indexOf("--slice");
const requestedSlice = sliceIndex >= 0 ? process.argv[sliceIndex + 1] : "ALL";

if (
  ![
    "S01",
    "S02",
    "S03",
    "S04",
    "S05",
    "S06",
    "S07",
    "S08",
    "S09",
    "S10",
    "S11",
    "S12",
    "S13",
    "S14",
    "S15",
    "ALL",
  ].includes(requestedSlice)
) {
  throw new Error(`当前 runner 尚未实现 Slice：${requestedSlice}`);
}

const runtimeId = `sharge-cli-${requestedSlice.toLowerCase()}-${process.pid}-${Date.now()}`;
const isolatedHome = await mkdtemp(resolve(tmpdir(), "sharge-cli-e2e-"));
const isolatedCwd = await mkdtemp(resolve(tmpdir(), "sharge-cli-e2e-cwd-"));
const canonicalCwd = await realpath(isolatedCwd);
const lifecycleTimeoutMs = 180_000;
let networkConnections = 0;
const networkSentinel = createServer((socket) => {
  networkConnections += 1;
  socket.destroy();
});
networkSentinel.listen(0, "127.0.0.1");
await once(networkSentinel, "listening");
const sentinelAddress = networkSentinel.address();
assert(
  sentinelAddress && typeof sentinelAddress !== "string",
  "network sentinel address",
);
const sentinelBaseUrl = `http://127.0.0.1:${sentinelAddress.port}`;

async function runLifecycle(args) {
  const result = await runProcess([agentRuntime, ...args], {
    cwd: aiGlassRoot,
    timeoutMs: lifecycleTimeoutMs,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Agent Runtime 命令失败：${args.join(" ")}\n${result.stderr}`,
    );
  }
  return result;
}

async function runUp() {
  const result = await runProcess([agentRuntime, "up", "--id", runtimeId], {
    cwd: aiGlassRoot,
    timeoutMs: lifecycleTimeoutMs,
  });
  if (result.exitCode === 0) {
    return;
  }
  if (result.stderr.includes("required local image")) {
    await runLifecycle(["up", "--id", runtimeId, "--build"]);
    return;
  }
  throw new Error(
    `Agent Runtime 命令失败：up --id ${runtimeId}\n${result.stderr}`,
  );
}

async function assertCase(
  name,
  args,
  expected,
  envOverrides = {},
  processOptions = {},
) {
  const env = {
    ...process.env,
    HOME: isolatedHome,
    SHARGE_BASE_URL: sentinelBaseUrl,
    SHARGE_API_KEY: "lms-synthetic-unused",
    ...envOverrides,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === null || value === undefined) {
      delete env[key];
    }
  }
  const result = await runBuiltCli(
    repositoryRoot,
    args,
    mergeProcessOptions(processOptions, {
      cwd: isolatedCwd,
      env,
      timeoutMs: 5_000,
    }),
  );

  assert.equal(result.exitCode, expected.exitCode, `${name}: exit code`);
  expected.assert(result);
  return {
    name,
    args,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

let initialized = false;
let cleanupPromise;
let openPlatformChild;
let openPlatformOutput = "";
let failureReported = false;
let downloadMediaServer;
const downloadMediaHeaders = [];

async function startDownloadMediaServer() {
  if (downloadMediaServer) {
    downloadMediaServer.closeAllConnections();
    await new Promise((resolveClose, reject) =>
      downloadMediaServer.close((error) =>
        error ? reject(error) : resolveClose(),
      ),
    );
    downloadMediaServer = undefined;
    downloadMediaHeaders.length = 0;
  }
  downloadMediaServer = createHttpServer((request, response) => {
    const parsedUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const filename = parsedUrl.pathname.split("/").at(-1);
    downloadMediaHeaders.push({
      filename,
      authorization: request.headers.authorization ?? null,
      host: request.headers.host ?? null,
    });
    if (filename === "partial-image.png") {
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": "100",
      });
      response.write("partial");
      setTimeout(() => response.destroy(), 10);
      return;
    }
    if (filename === "partial-recording.m4a") {
      response.writeHead(200, {
        "Content-Type": "audio/mp4",
        "Content-Length": "100",
      });
      response.write("partial");
      setTimeout(() => response.destroy(), 10);
      return;
    }
    if (filename === "recording-seed.m4a") {
      response.writeHead(200, {
        "Content-Type": "audio/mp4",
        "Content-Length": String(Buffer.byteLength("s13-seed-audio-content")),
      });
      response.end("s13-seed-audio-content");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": String(Buffer.byteLength("s08-seed-image-content")),
    });
    response.end("s08-seed-image-content");
  });
  downloadMediaServer.listen(0, "127.0.0.1");
  await once(downloadMediaServer, "listening");
  const address = downloadMediaServer.address();
  assert(address && typeof address !== "string", "download media address");
  return `http://127.0.0.1:${address.port}`;
}

function includesSlice(slice) {
  return requestedSlice === "ALL" || requestedSlice === slice;
}

async function prepareSliceHome() {
  if (requestedSlice === "ALL") {
    await rm(resolve(isolatedHome, ".sharge"), {
      recursive: true,
      force: true,
    });
  }
}

async function stopOpenPlatformServer() {
  if (!openPlatformChild) {
    return;
  }
  if (openPlatformChild.exitCode === null) {
    await runLifecycle(["stop", "--id", runtimeId, "web"]);
    if (openPlatformChild.exitCode === null) {
      await once(openPlatformChild, "exit");
    }
  }
  openPlatformChild = undefined;
  openPlatformOutput = "";
}

async function startOpenPlatformServer(mediaBaseUrl = "") {
  await stopOpenPlatformServer();
  openPlatformOutput = "";
  const source = `
import asyncio
import os
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response, StreamingResponse
from open_platform._app import create_open_platform_app
from open_platform._middleware import OpenPlatformMiddleware

attempts = {}
observed_headers = []
media_headers = []
media_base_url = ${JSON.stringify(mediaBaseUrl)}
os.environ["OPEN_PLATFORM_MEDIA_TRUSTED_HOSTS"] = "127.0.0.1"
faults = {
    "lms-e2e-fault-403": 403,
    "lms-e2e-fault-404": 404,
    "lms-e2e-fault-429": 429,
    "lms-e2e-fault-503": 503,
}

class FaultMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        user_agent = request.headers.get("user-agent", "")
        if request.url.path.startswith("/open-api/") and user_agent.startswith("sharge-cli/"):
            observed_headers.append({
                "path": request.url.path,
                "authorization": request.headers.get("authorization", "").startswith("Bearer lms-"),
                "client_date": request.headers.get("x-client-date"),
                "user_agent": user_agent,
            })
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        if token == "lms-e2e-fault-timeout":
            attempts["timeout"] = attempts.get("timeout", 0) + 1
            await asyncio.sleep(3)
            return JSONResponse({"code": 500, "message": "late", "data": None}, status_code=500)
        status = faults.get(token)
        if status is not None:
            attempts[str(status)] = attempts.get(str(status), 0) + 1
            headers = {"X-Request-Id": "req_fault_" + str(status)}
            if status == 429:
                headers["Retry-After"] = "1"
            return JSONResponse(
                {"code": status, "message": "fault " + str(status), "data": None},
                status_code=status,
                headers=headers,
            )
        return await call_next(request)

class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if "X-Request-Id" not in response.headers:
            response.headers["X-Request-Id"] = "req_runtime_e2e"
        return response

app = FastAPI()
app.add_middleware(FaultMiddleware)
app.add_middleware(OpenPlatformMiddleware, path_prefixes=["/open-api"])
app.add_middleware(RequestIdMiddleware)
app.mount("/open-api/v1", create_open_platform_app())

if media_base_url:
    import user_memory.quick_note.public as quick_note_public

    class E2EMediaBucket:
        def object_exists(self, object_key):
            return object_key.endswith("seed-image.png") or object_key.endswith("partial-image.png")

        def sign_url(self, method, object_key, expires, params=None):
            filename = object_key.rsplit("/", 1)[-1]
            return media_base_url + "/__e2e__/media/" + filename + "?signature=s08-signed-secret"

    quick_note_public.get_bucket = lambda: E2EMediaBucket()

@app.get("/__e2e__/media/{filename}")
async def media(filename: str, request: Request):
    media_headers.append({
        "filename": filename,
        "authorization": request.headers.get("authorization"),
        "host": request.headers.get("host"),
    })
    if filename == "partial-image.png":
        async def broken_body():
            yield b"partial"
            raise RuntimeError("intentional incomplete S08 body")
        return StreamingResponse(
            broken_body(),
            media_type="image/png",
            headers={"Content-Length": "100"},
        )
    return Response(content=b"s08-seed-image-content", media_type="image/png")

@app.get("/__e2e__/counts")
async def counts():
    return attempts

@app.get("/__e2e__/observed-headers")
async def headers():
    return observed_headers

@app.get("/__e2e__/media-headers")
async def headers():
    return media_headers

import uvicorn
uvicorn.run(app, host="0.0.0.0", port=8077)
`;
  openPlatformChild = spawn(
    agentRuntime,
    [
      "exec",
      "--id",
      runtimeId,
      "--",
      "sh",
      "-c",
      'printf "%s\\n" "$$" > /agent/logs/web.pid; exec /opt/ai-glass/.venv/bin/python -c "$1"',
      "sh",
      source,
    ],
    {
      cwd: aiGlassRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [openPlatformChild.stdout, openPlatformChild.stderr]) {
    stream.on("data", (chunk) => {
      openPlatformOutput += chunk.toString();
    });
  }
}

async function restoreRuntimeWebServer(runtimeBaseUrl) {
  await stopOpenPlatformServer();
  await runLifecycle(["start", "--id", runtimeId, "web"]);
  await waitForUrl(`${runtimeBaseUrl}/open-api/v1/openapi.json`);
}

async function waitForUrl(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (openPlatformChild && openPlatformChild.exitCode !== null) {
      throw new Error(
        `Open Platform E2E server exited early\n${openPlatformOutput}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`等待 Open Platform E2E server 超时\n${openPlatformOutput}`);
}

function reportFailureEvidence() {
  if (failureReported) {
    return;
  }
  failureReported = true;
  process.stderr.write(
    `${JSON.stringify({
      event: "e2e.failure",
      slice: requestedSlice,
      runtimeId,
      runtimeRunDir: resolve(aiGlassRoot, ".agent", "runs", runtimeId),
      isolatedHome,
      isolatedCwd,
      retained: true,
      nextAction: `${agentRuntime} clean --id ${runtimeId} --all`,
    })}\n`,
  );
}

async function cleanup(mode) {
  if (cleanupPromise) {
    return cleanupPromise;
  }
  cleanupPromise = (async () => {
    const errors = [];
    networkSentinel.close();
    try {
      await once(networkSentinel, "close");
    } catch (error) {
      errors.push(error);
    }
    if (mode === "success") {
      try {
        await rm(isolatedHome, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
      try {
        await rm(isolatedCwd, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
    }
    if (openPlatformChild) {
      try {
        await stopOpenPlatformServer();
      } catch (error) {
        errors.push(error);
        if (openPlatformChild?.exitCode === null) {
          openPlatformChild.kill("SIGTERM");
        }
      }
    }
    if (downloadMediaServer) {
      downloadMediaServer.closeAllConnections();
      try {
        await new Promise((resolveClose, reject) =>
          downloadMediaServer.close((error) =>
            error ? reject(error) : resolveClose(),
          ),
        );
      } catch (error) {
        errors.push(error);
      }
    }
    if (initialized) {
      try {
        await runLifecycle([
          mode === "success" ? "clean" : "down",
          "--id",
          runtimeId,
          ...(mode === "success" ? ["--all"] : []),
        ]);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `${requestedSlice} E2E cleanup failed`);
    }
  })();
  return cleanupPromise;
}

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.once(signal, () => {
    reportFailureEvidence();
    void cleanup("failure").finally(() => process.exit(exitCode));
  });
}

let completed = false;
try {
  await runLifecycle(["init", "--id", runtimeId, "--worktree", aiGlassRoot]);
  initialized = true;
  await runUp();
  await runLifecycle(["start", "--id", runtimeId]);
  await runLifecycle(["wait", "--id", runtimeId]);
  const statusResult = await runLifecycle([
    "status",
    "--id",
    runtimeId,
    "--json",
  ]);
  const runtimeStatus = JSON.parse(statusResult.stdout);

  const cases = [];
  cases.push(
    await assertCase("no-argument root help remains text in a pipe", [], {
      exitCode: 0,
      assert(result) {
        assert.match(result.stdout, /用法：sharge <命令> \[选项\]/);
        assert.equal(result.stderr, "");
      },
    }),
  );
  cases.push(
    await assertCase("root help text", ["--help"], {
      exitCode: 0,
      assert(result) {
        assert.match(result.stdout, /用法：sharge <命令> \[选项\]/);
        assert.equal(result.stderr, "");
      },
    }),
  );
  cases.push(
    await assertCase("root help json", ["--help", "--json"], {
      exitCode: 0,
      assert(result) {
        const envelope = JSON.parse(result.stdout);
        assert.equal(envelope.ok, true);
        assert.equal(envelope.command, "sharge");
        assert.equal(result.stderr, "");
      },
    }),
  );
  cases.push(
    await assertCase("version text", ["version"], {
      exitCode: 0,
      assert(result) {
        assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/);
        assert.equal(result.stderr, "");
      },
    }),
  );
  cases.push(
    await assertCase("version json", ["version", "--json"], {
      exitCode: 0,
      assert(result) {
        const envelope = JSON.parse(result.stdout);
        assert.equal(envelope.ok, true);
        assert.equal(envelope.command, "version");
        assert.equal(result.stderr, "");
      },
    }),
  );
  cases.push(
    await assertCase("unknown command text", ["unknown"], {
      exitCode: 2,
      assert(result) {
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /下一步：sharge --help/);
      },
    }),
  );
  cases.push(
    await assertCase("unknown command json", ["unknown", "--json"], {
      exitCode: 2,
      assert(result) {
        const envelope = JSON.parse(result.stdout);
        assert.equal(envelope.ok, false);
        assert.equal(envelope.error.type, "INVALID_COMMAND");
        assert.equal(result.stderr, "");
      },
    }),
  );
  cases.push(
    await assertCase("deleted schema command", ["schema", "--json"], {
      exitCode: 2,
      assert(result) {
        const envelope = JSON.parse(result.stdout);
        assert.equal(envelope.ok, false);
        assert.equal(envelope.error.type, "INVALID_COMMAND");
        assert.equal(result.stderr, "");
      },
    }),
  );
  cases.push(
    await assertCase(
      "deleted output option",
      ["version", "--output", "json", "--json"],
      {
        exitCode: 2,
        assert(result) {
          const envelope = JSON.parse(result.stdout);
          assert.equal(envelope.ok, false);
          assert.equal(envelope.error.field, "--output");
          assert.equal(result.stderr, "");
        },
      },
    ),
  );

  if (includesSlice("S02")) {
    await prepareSliceHome();
    const configDir = resolve(isolatedHome, ".sharge");
    const settingsPath = resolve(configDir, "settings.json");
    const logPath = resolve(configDir, "sharge.log");

    cases.push(
      await assertCase(
        "config namespace JSON help",
        ["config", "--help", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.command, "config");
            assert(
              envelope.data.commands.some(
                (command) => command.command === "config.show",
              ),
            );
          },
        },
      ),
    );
    cases.push(
      await assertCase(
        "config show default service",
        ["config", "show", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.settingsPath, settingsPath);
            assert.deepEqual(envelope.data.baseUrl, {
              value: "https://ai.shargetech.com",
              source: "default",
              environment: "default",
            });
            assert.equal(envelope.data.credential.source, "none");
          },
        },
        {
          SHARGE_API_KEY: null,
          SHARGE_BASE_URL: null,
          SHARGE_TIMEZONE: null,
        },
      ),
    );
    if (process.platform !== "win32") {
      assert.equal((await lstat(configDir)).mode & 0o777, 0o700);
      assert.equal((await lstat(settingsPath)).mode & 0o777, 0o600);
      assert.equal((await lstat(logPath)).mode & 0o777, 0o600);
    }

    cases.push(
      await assertCase(
        "environment configuration priority",
        ["config", "show", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.deepEqual(envelope.data.baseUrl, {
              value: "https://auth.example.test",
              source: "env",
              environment: "custom",
            });
            assert.deepEqual(envelope.data.credential, {
              source: "env",
              keyPrefix: "lms-env-…",
            });
            assert.deepEqual(envelope.data.timezone, {
              value: "Europe/London",
              source: "env",
            });
          },
        },
        {
          SHARGE_BASE_URL: "https://auth.example.test",
          SHARGE_API_KEY: "Bearer lms-env-e2e-secret",
          SHARGE_TIMEZONE: "Europe/London",
        },
      ),
    );

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          ...settings,
          baseUrl: "https://ai.shargetech.com",
          apiKey: "lms-cn-e2e-secret",
          previousCredential: {
            baseUrl: "https://api.example.test",
            apiKey: "lms-test-e2e-secret",
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await chmod(settingsPath, 0o600);

    cases.push(
      await assertCase(
        "config set swaps cached credential",
        ["config", "set", "base-url", "https://api.example.test", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.credentialRestored, true);
            assert.equal(envelope.data.environment, "custom");
            assert.equal(result.stderr, "");
          },
        },
      ),
    );
    const swappedSettings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(swappedSettings.apiKey, "lms-test-e2e-secret");
    assert.equal(
      swappedSettings.previousCredential.apiKey,
      "lms-cn-e2e-secret",
    );
    assert(
      !(await readdir(configDir)).some((name) => name.includes(".tmp-")),
      "atomic settings writes must not leave temporary files",
    );

    cases.push(
      await assertCase(
        "CLI timezone overrides settings and env",
        ["config", "show", "--timezone", "Asia/Shanghai", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.deepEqual(envelope.data.timezone, {
              value: "Asia/Shanghai",
              source: "cli",
            });
          },
        },
        { SHARGE_TIMEZONE: "Europe/London" },
      ),
    );

    cases.push(
      await assertCase("logs path", ["logs", "path", "--json"], {
        exitCode: 0,
        assert(result) {
          assert.equal(JSON.parse(result.stdout).data.filePath, logPath);
        },
      }),
    );
    await writeFile(`${logPath}.1`, "history-1\n");
    await writeFile(`${logPath}.2`, "history-2\n");
    await writeFile(`${logPath}.3`, "history-3\n");
    await truncate(logPath, 5 * 1024 * 1024);
    cases.push(
      await assertCase(
        "log rotation keeps four generations",
        ["version", "--json"],
        {
          exitCode: 0,
          assert() {},
        },
      ),
    );
    assert.equal((await lstat(`${logPath}.1`)).isFile(), true);
    assert.equal(await readFile(`${logPath}.4`, "utf8"), "history-3\n");

    cases.push(
      await assertCase("logs clear requires yes", ["logs", "clear", "--json"], {
        exitCode: 2,
        assert(result) {
          const envelope = JSON.parse(result.stdout);
          assert.equal(envelope.error.field, "--yes");
        },
      }),
    );
    cases.push(
      await assertCase(
        "logs clear removes rotations",
        ["logs", "clear", "--yes", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.cleared, true);
            assert(envelope.data.removedFiles >= 1);
          },
        },
      ),
    );

    const settingsBackup = `${settingsPath}.backup`;
    const outsideSettings = resolve(isolatedHome, "outside-settings.json");
    await rename(settingsPath, settingsBackup);
    await writeFile(
      outsideSettings,
      '{"schemaVersion":1,"installationId":"install_outside"}\n',
    );
    await symlink(outsideSettings, settingsPath);
    try {
      cases.push(
        await assertCase(
          "settings symlink rejected",
          ["config", "show", "--json"],
          {
            exitCode: 2,
            assert(result) {
              const envelope = JSON.parse(result.stdout);
              assert.equal(envelope.error.type, "INVALID_INPUT");
              assert.equal(envelope.error.field, "settingsPath");
            },
          },
        ),
      );
    } finally {
      await unlink(settingsPath);
      await rename(settingsBackup, settingsPath);
    }

    const persistedLogs = await readFile(logPath, "utf8");
    assert(!persistedLogs.includes("lms-cn-e2e-secret"));
    assert(!persistedLogs.includes("lms-test-e2e-secret"));
    assert(!persistedLogs.includes("lms-env-e2e-secret"));

    if (process.platform !== "win32") {
      const settingsBeforeFailure = await readFile(settingsPath, "utf8");
      cases.push(
        await assertCase(
          "atomic settings failure preserves previous file",
          ["config", "set", "timezone", "UTC", "--json"],
          {
            exitCode: 1,
            assert(result) {
              const envelope = JSON.parse(result.stdout);
              assert.equal(envelope.error.type, "INTERNAL_ERROR");
            },
          },
          { SHARGE_INTERNAL_TEST_FAIL_SETTINGS_RENAME: "1" },
        ),
      );
      assert.equal(await readFile(settingsPath, "utf8"), settingsBeforeFailure);
      assert(
        !(await readdir(configDir)).some((name) => name.includes(".tmp-")),
        "failed atomic settings writes must not leave temporary files",
      );

      const outsideLog = resolve(isolatedHome, "outside.log");
      await writeFile(outsideLog, "unchanged\n");
      await unlink(logPath);
      await symlink(outsideLog, logPath);
      cases.push(
        await assertCase(
          "log symlink failure is downgraded with JSON debug",
          ["version", "--json", "--debug"],
          {
            exitCode: 0,
            assert(result) {
              const diagnostics = result.stderr
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
              assert(
                diagnostics.some(
                  (diagnostic) => diagnostic.type === "CLI_COMPLETE",
                ),
              );
              assert(
                diagnostics.some(
                  (diagnostic) => diagnostic.type === "LOG_WRITE_FAILED",
                ),
              );
            },
          },
        ),
      );
      assert.equal(await readFile(outsideLog, "utf8"), "unchanged\n");
    }
  }

  if (includesSlice("S03")) {
    await prepareSliceHome();
    const runtimeBaseUrl = runtimeStatus.urls.web;
    const validApiKey = `lms-e2e-${randomUUID().replaceAll("-", "")}`;
    const scopes = JSON.stringify([
      "quick_notes:read",
      "quick_notes:write",
      "calendar:read",
      "calendar:write",
      "voicemaster:read",
      "ai_daily:read",
    ]);
    const seededKeys = [
      validApiKey,
      "lms-e2e-fault-403",
      "lms-e2e-fault-404",
      "lms-e2e-fault-429",
      "lms-e2e-fault-503",
      "lms-e2e-fault-timeout",
    ];
    const seedValues = seededKeys.map((apiKey, index) => {
      const hash = createHash("sha256").update(apiKey).digest("hex");
      const prefix = apiKey.slice(0, 12);
      return `('cli-s03-user','CLI S03 E2E ${index}','${prefix}','${hash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${scopes}','manual','sharge-cli','install_s03_${index}','{}')`;
    });
    const seedSql = [
      "INSERT INTO ai_open_api_keys",
      "(user_id,name,key_prefix,key_hash,expires_at,last_used_at,is_active,created_at,updated_at,scopes,creation_source,client_id,installation_id,client_info)",
      `VALUES ${seedValues.join(",")}`,
    ].join(" ");
    await runLifecycle(["mysql", "--id", runtimeId, "--", "-e", seedSql]);

    const realEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: validApiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };
    cases.push(
      await assertCase(
        "real auth status",
        ["auth", "status", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.command, "auth.status");
            assert.equal(envelope.data.auth.user_id, "cli-s03-user");
            assert.equal(envelope.data.auth.auth_type, "api_key");
            assert.equal(envelope.meta.timezone, "Asia/Shanghai");
            assert.match(envelope.meta.clientDate, /[+-]\d{2}:\d{2}$/);
            assert(envelope.meta.requestId);
            assert.equal(result.stderr, "");
          },
        },
        realEnv,
      ),
    );
    cases.push(
      await assertCase(
        "real auth scopes with jq",
        ["auth", "scopes", "--json", "--jq", ".data[0].scope"],
        {
          exitCode: 0,
          assert(result) {
            assert.equal(JSON.parse(result.stdout), "quick_notes:read");
            assert.equal(result.stderr, "");
          },
        },
        realEnv,
      ),
    );
    cases.push(
      await assertCase(
        "real doctor",
        ["doctor", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.healthy, true);
            assert(
              envelope.data.checks.every((check) => check.status === "pass"),
            );
          },
        },
        realEnv,
      ),
    );
    cases.push(
      await assertCase(
        "auth required fast fail",
        ["auth", "status", "--json"],
        {
          exitCode: 3,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "AUTH_REQUIRED");
            assert.equal(envelope.meta.requestId, null);
          },
        },
        {
          SHARGE_BASE_URL: runtimeBaseUrl,
          SHARGE_API_KEY: null,
        },
      ),
    );
    cases.push(
      await assertCase(
        "real invalid credential",
        ["auth", "status", "--json"],
        {
          exitCode: 3,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "CREDENTIAL_INVALID");
            assert.equal(envelope.meta.httpStatus, 401);
          },
        },
        {
          SHARGE_BASE_URL: runtimeBaseUrl,
          SHARGE_API_KEY: "lms-e2e-invalid",
        },
      ),
    );

    await runLifecycle(["stop", "--id", runtimeId, "web"]);
    await startOpenPlatformServer();
    await waitForUrl(`${runtimeBaseUrl}/open-api/v1/openapi.json`);

    for (const fault of [
      { status: 403, type: "PERMISSION_DENIED", exitCode: 4 },
      { status: 404, type: "NOT_FOUND", exitCode: 5 },
      { status: 429, type: "RATE_LIMITED", exitCode: 7 },
      { status: 503, type: "SERVER_ERROR", exitCode: 8 },
    ]) {
      cases.push(
        await assertCase(
          `runtime fault ${fault.status}`,
          ["auth", "status", "--json"],
          {
            exitCode: fault.exitCode,
            assert(result) {
              const envelope = JSON.parse(result.stdout);
              assert.equal(envelope.error.type, fault.type);
              assert.equal(envelope.meta.httpStatus, fault.status);
            },
          },
          {
            SHARGE_BASE_URL: runtimeBaseUrl,
            SHARGE_API_KEY: `lms-e2e-fault-${fault.status}`,
          },
        ),
      );
    }
    cases.push(
      await assertCase(
        "runtime timeout without retry",
        ["auth", "status", "--timeout", "1s", "--json"],
        {
          exitCode: 8,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "TIMEOUT");
            assert.equal(envelope.error.retryable, true);
          },
        },
        {
          SHARGE_BASE_URL: runtimeBaseUrl,
          SHARGE_API_KEY: "lms-e2e-fault-timeout",
        },
      ),
    );

    const unusedServer = createServer();
    unusedServer.listen(0, "127.0.0.1");
    await once(unusedServer, "listening");
    const unusedAddress = unusedServer.address();
    assert(
      unusedAddress && typeof unusedAddress !== "string",
      "unused server address",
    );
    await new Promise((resolveClose) => unusedServer.close(resolveClose));
    cases.push(
      await assertCase(
        "network error without retry",
        ["auth", "status", "--json"],
        {
          exitCode: 8,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "NETWORK_ERROR");
          },
        },
        {
          SHARGE_BASE_URL: `http://127.0.0.1:${unusedAddress.port}`,
          SHARGE_API_KEY: validApiKey,
        },
      ),
    );

    const counts = await (
      await fetch(`${runtimeBaseUrl}/__e2e__/counts`)
    ).json();
    assert.deepEqual(counts, {
      403: 1,
      404: 1,
      429: 1,
      503: 1,
      timeout: 1,
    });
    const observedHeaders = await (
      await fetch(`${runtimeBaseUrl}/__e2e__/observed-headers`)
    ).json();
    assert.equal(observedHeaders.length, 5);
    for (const observation of observedHeaders) {
      assert.equal(observation.authorization, true);
      assert.match(
        observation.client_date,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
      );
      assert.match(
        observation.user_agent,
        /^sharge-cli\/\d+\.\d+\.\d+ \(.+; Node v\d+/,
      );
    }
    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    assert(!logContents.includes(validApiKey));
    assert(!logContents.includes("lms-e2e-invalid"));
    assert.match(logContents, /"event":"request"/);
    assert.match(logContents, /"event":"response"/);
  }

  if (includesSlice("S04")) {
    const runtimeBaseUrl = runtimeStatus.urls.web;
    if (requestedSlice === "ALL") {
      await restoreRuntimeWebServer(runtimeBaseUrl);
    }
    const settingsPath = resolve(isolatedHome, ".sharge", "settings.json");
    const currentSettings = JSON.parse(await readFile(settingsPath, "utf8"));
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          installationId: currentSettings.installationId,
          baseUrl: runtimeBaseUrl,
          timezone: "Asia/Shanghai",
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );

    const jwtResult = await runLifecycle([
      "exec",
      "--id",
      runtimeId,
      "--",
      "uv",
      "run",
      "--no-sync",
      "python",
      "-c",
      [
        "import time",
        "import jwt",
        "import keys",
        "print(jwt.encode(",
        "    {'userId': 'cli-s04-user', 'exp': int(time.time()) + 300},",
        "    keys.JWT_SECRET,",
        "    algorithm='HS256',",
        "))",
      ].join("\n"),
    ]);
    const jwt = jwtResult.stdout.trim();
    assert(jwt, "real JWT must be generated inside Agent Runtime");

    const loginEnvironment = {
      ...process.env,
      HOME: isolatedHome,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };
    delete loginEnvironment.SHARGE_BASE_URL;
    delete loginEnvironment.SHARGE_API_KEY;
    const loginChild = spawn(
      process.execPath,
      [`${repositoryRoot}/dist/index.js`, "login", "--no-browser", "--json"],
      {
        cwd: isolatedCwd,
        env: loginEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let loginStdout = "";
    let loginStderr = "";
    let stderrBuffer = "";
    let resolveCreated;
    let rejectCreated;
    const authorizationCreated = new Promise(
      (resolveCreatedPromise, reject) => {
        resolveCreated = resolveCreatedPromise;
        rejectCreated = reject;
      },
    );
    loginChild.stdout.on("data", (chunk) => {
      loginStdout += chunk.toString();
    });
    loginChild.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      loginStderr += text;
      stderrBuffer += text;
      for (;;) {
        const newline = stderrBuffer.indexOf("\n");
        if (newline < 0) {
          break;
        }
        const line = stderrBuffer.slice(0, newline);
        stderrBuffer = stderrBuffer.slice(newline + 1);
        if (!line) {
          continue;
        }
        const event = JSON.parse(line);
        if (event.event === "authorization.created") {
          resolveCreated(event);
        }
      }
    });
    loginChild.once("error", (error) => rejectCreated(error));
    loginChild.once("close", (exitCode) => {
      if (exitCode !== 0) {
        rejectCreated(
          new Error(
            `login exited before approval (${exitCode})\n${loginStdout}\n${loginStderr}`,
          ),
        );
      }
    });

    const createdEvent = await Promise.race([
      authorizationCreated,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(new Error("timed out waiting for authorization.created")),
          15_000,
        ),
      ),
    ]);
    assert.match(createdEvent.userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(
      new URL(createdEvent.verificationUriComplete).searchParams.get(
        "user_code",
      ),
      createdEvent.userCode,
    );
    const approveResponse = await fetch(
      `${runtimeBaseUrl}/ai/open-platform/cli-authorizations/${encodeURIComponent(createdEvent.authorizationId)}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(
      approveResponse.status,
      200,
      `real JWT approval failed: ${await approveResponse.text()}`,
    );

    const [loginExitCode] = await Promise.race([
      once(loginChild, "close"),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("timed out waiting for login completion")),
          20_000,
        ),
      ),
    ]);
    assert.equal(loginExitCode, 0, "login exit code");
    const loginEnvelope = JSON.parse(loginStdout);
    assert.equal(loginEnvelope.ok, true);
    assert.equal(loginEnvelope.command, "login");
    assert.equal(loginEnvelope.data.changed, true);
    assert.deepEqual(loginEnvelope.data.scopes, [
      "quick_notes:read",
      "quick_notes:write",
      "calendar:read",
      "calendar:write",
      "voicemaster:read",
      "ai_daily:read",
    ]);
    const loginEvents = loginStderr
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      loginEvents.map((event) => event.event),
      ["authorization.created", "credential.saved", "authorization.approved"],
    );
    const storedAfterLogin = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.match(storedAfterLogin.apiKey, /^lms-/);
    assert(!loginStdout.includes(storedAfterLogin.apiKey));
    assert(!loginStderr.includes(storedAfterLogin.apiKey));
    if (process.platform !== "win32") {
      assert.equal((await lstat(settingsPath)).mode & 0o777, 0o600);
    }
    cases.push({
      name: "real browser authorization login",
      args: ["login", "--no-browser", "--json"],
      exitCode: loginExitCode,
      stdout: loginStdout,
      stderr: loginStderr,
    });

    cases.push(
      await assertCase(
        "auth status after real login",
        ["auth", "status", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.auth.user_id, "cli-s04-user");
            assert.deepEqual(
              envelope.data.auth.scopes,
              loginEnvelope.data.scopes,
            );
            assert.equal(result.stderr, "");
          },
        },
        {
          SHARGE_BASE_URL: null,
          SHARGE_API_KEY: null,
          SHARGE_TIMEZONE: null,
        },
      ),
    );
    cases.push(
      await assertCase(
        "logout removes file credential only",
        ["logout", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.changed, true);
            assert.equal(envelope.data.settingsCredentialRemoved, true);
            assert.equal(envelope.data.previousCredentialRemoved, false);
            assert.equal(envelope.data.environmentCredentialActive, false);
            assert.deepEqual(envelope.warnings, []);
            assert.equal(result.stderr, "");
          },
        },
        {
          SHARGE_BASE_URL: null,
          SHARGE_API_KEY: null,
          SHARGE_TIMEZONE: null,
        },
      ),
    );
    const storedAfterLogout = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(storedAfterLogout.apiKey, undefined);
    assert.equal(storedAfterLogout.previousCredential, undefined);
    assert.equal(
      storedAfterLogout.installationId,
      currentSettings.installationId,
    );
    assert.equal(storedAfterLogout.baseUrl, runtimeBaseUrl);
    assert.equal(storedAfterLogout.timezone, "Asia/Shanghai");

    cases.push(
      await assertCase(
        "auth required after logout",
        ["auth", "status", "--json"],
        {
          exitCode: 3,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "AUTH_REQUIRED");
          },
        },
        {
          SHARGE_BASE_URL: null,
          SHARGE_API_KEY: null,
          SHARGE_TIMEZONE: null,
        },
      ),
    );
    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    assert(!logContents.includes(storedAfterLogin.apiKey));
    assert(!logContents.includes(jwt));
    assert(!logContents.includes(createdEvent.verificationUriComplete));
  }

  if (includesSlice("S05")) {
    await prepareSliceHome();
    cases.push(
      await assertCase(
        "initialize S05 installation settings",
        ["version", "--json"],
        {
          exitCode: 0,
          assert(result) {
            assert.equal(JSON.parse(result.stdout).command, "version");
            assert.equal(result.stderr, "");
          },
        },
      ),
    );
    const runtimeBaseUrl = runtimeStatus.urls.web;
    const settingsPath = resolve(isolatedHome, ".sharge", "settings.json");
    const initialSettings = JSON.parse(await readFile(settingsPath, "utf8"));
    const installationId = initialSettings.installationId;
    async function writeLoginSettings(apiKey, extra = {}) {
      await writeFile(
        settingsPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            installationId,
            baseUrl: runtimeBaseUrl,
            timezone: "Asia/Shanghai",
            ...(apiKey ? { apiKey } : {}),
            ...extra,
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
    }

    const jwtResult = await runLifecycle([
      "exec",
      "--id",
      runtimeId,
      "--",
      "uv",
      "run",
      "--no-sync",
      "python",
      "-c",
      [
        "import time",
        "import jwt",
        "import keys",
        "print(jwt.encode(",
        "    {'userId': 'cli-s05-user', 'exp': int(time.time()) + 600},",
        "    keys.JWT_SECRET,",
        "    algorithm='HS256',",
        "))",
      ].join("\n"),
    ]);
    const jwt = jwtResult.stdout.trim();
    assert(jwt, "real S05 JWT must be generated inside Agent Runtime");

    function startLogin(extraArgs = []) {
      const environment = {
        ...process.env,
        HOME: isolatedHome,
        SHARGE_TIMEZONE: "Asia/Shanghai",
      };
      delete environment.SHARGE_BASE_URL;
      delete environment.SHARGE_API_KEY;
      const child = spawn(
        process.execPath,
        [
          `${repositoryRoot}/dist/index.js`,
          "login",
          "--no-browser",
          "--json",
          ...extraArgs,
        ],
        {
          cwd: isolatedCwd,
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      let stderrBuffer = "";
      let createdResolve;
      let createdReject;
      let createdSettled = false;
      const created = new Promise((resolveCreated, rejectCreated) => {
        createdResolve = resolveCreated;
        createdReject = rejectCreated;
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        stderrBuffer += text;
        for (;;) {
          const newline = stderrBuffer.indexOf("\n");
          if (newline < 0) {
            break;
          }
          const line = stderrBuffer.slice(0, newline);
          stderrBuffer = stderrBuffer.slice(newline + 1);
          if (!line) {
            continue;
          }
          const event = JSON.parse(line);
          if (event.event === "authorization.created" && !createdSettled) {
            createdSettled = true;
            createdResolve(event);
          }
        }
      });
      child.once("error", (error) => {
        if (!createdSettled) {
          createdSettled = true;
          createdReject(error);
        }
      });
      const completion = new Promise((resolveCompletion, rejectCompletion) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          rejectCompletion(new Error("S05 login process timed out"));
        }, 20_000);
        child.once("close", (exitCode, signal) => {
          clearTimeout(timer);
          if (!createdSettled) {
            createdSettled = true;
            createdReject(
              new Error(
                `login exited before authorization.created (${exitCode}, ${signal})\n${stdout}\n${stderr}`,
              ),
            );
          }
          resolveCompletion({
            exitCode: exitCode ?? (signal === "SIGINT" ? 130 : 1),
            signal,
            stdout,
            stderr,
          });
        });
      });
      return { child, created, completion };
    }

    async function decide(authorizationId, decision) {
      const response = await fetch(
        `${runtimeBaseUrl}/ai/open-platform/cli-authorizations/${encodeURIComponent(authorizationId)}/${decision}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        },
      );
      assert.equal(
        response.status,
        200,
        `${decision} failed: ${await response.text()}`,
      );
    }

    async function seedAuthorizationState(authorizationId, status) {
      const source = [
        "import json",
        "import os",
        "import sys",
        "import time",
        "from redis import Redis",
        "client = Redis.from_url(os.environ['REDIS_URL'], decode_responses=True)",
        "key = 'open_platform:cli_auth:' + sys.argv[1]",
        "raw = client.get(key)",
        "assert raw, key",
        "value = json.loads(raw)",
        "if sys.argv[2] == 'expired':",
        "    value['authorization_expires_at'] = int(time.time()) - 1",
        "else:",
        "    value['status'] = sys.argv[2]",
        "client.set(key, json.dumps(value), keepttl=True)",
      ].join("\n");
      await runLifecycle([
        "exec",
        "--id",
        runtimeId,
        "--",
        "uv",
        "run",
        "--no-sync",
        "python",
        "-c",
        source,
        authorizationId,
        status,
      ]);
    }

    async function seedPollRateLimit(authorizationId) {
      const source = [
        "import os",
        "import sys",
        "from redis import Redis",
        "client = Redis.from_url(os.environ['REDIS_URL'], decode_responses=True)",
        "client.setex(",
        "    'open_platform:rate_limit:cli_poll:' + sys.argv[1],",
        "    3,",
        "    '1',",
        ")",
      ].join("\n");
      await runLifecycle([
        "exec",
        "--id",
        runtimeId,
        "--",
        "uv",
        "run",
        "--no-sync",
        "python",
        "-c",
        source,
        authorizationId,
      ]);
    }

    function recordLoginCase(name, args, result) {
      cases.push({
        name,
        args: ["login", "--no-browser", "--json", ...args],
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }

    await writeLoginSettings(null);
    const approvedLogin = startLogin();
    const approvedCreated = await approvedLogin.created;
    await decide(approvedCreated.authorizationId, "approve");
    const approvedResult = await approvedLogin.completion;
    assert.equal(approvedResult.exitCode, 0);
    assert.equal(JSON.parse(approvedResult.stdout).data.changed, true);
    recordLoginCase("real approved login", [], approvedResult);

    await writeLoginSettings(null);
    const deniedLogin = startLogin();
    const deniedCreated = await deniedLogin.created;
    await decide(deniedCreated.authorizationId, "deny");
    const deniedResult = await deniedLogin.completion;
    assert.equal(
      deniedResult.exitCode,
      3,
      `${deniedResult.stdout}\n${deniedResult.stderr}`,
    );
    assert.equal(
      JSON.parse(deniedResult.stdout).error.type,
      "AUTHORIZATION_DENIED",
    );
    recordLoginCase("real denied login", [], deniedResult);

    for (const terminal of [
      { status: "expired", type: "AUTHORIZATION_EXPIRED" },
      { status: "consumed", type: "AUTHORIZATION_CONSUMED" },
      { status: "superseded", type: "AUTHORIZATION_SUPERSEDED" },
    ]) {
      await writeLoginSettings(null);
      const terminalLogin = startLogin();
      const terminalCreated = await terminalLogin.created;
      await seedAuthorizationState(
        terminalCreated.authorizationId,
        terminal.status,
      );
      const terminalResult = await terminalLogin.completion;
      assert.equal(terminalResult.exitCode, 3);
      assert.equal(JSON.parse(terminalResult.stdout).error.type, terminal.type);
      recordLoginCase(`seeded ${terminal.status} login`, [], terminalResult);
    }

    await writeLoginSettings(null);
    const rateLimitedLogin = startLogin();
    const rateCreated = await rateLimitedLogin.created;
    await decide(rateCreated.authorizationId, "approve");
    await seedPollRateLimit(rateCreated.authorizationId);
    const rateResult = await rateLimitedLogin.completion;
    assert.equal(rateResult.exitCode, 0);
    assert(rateResult.stderr.includes('"event":"authorization.processing"'));
    recordLoginCase("real poll rate limit slow-down", [], rateResult);

    const credentialBeforeForce = JSON.parse(
      await readFile(settingsPath, "utf8"),
    ).apiKey;
    assert(
      credentialBeforeForce,
      "force scenario requires a valid settings key",
    );
    const forceLogin = startLogin(["--force"]);
    const forceCreated = await forceLogin.created;
    await decide(forceCreated.authorizationId, "approve");
    const forceResult = await forceLogin.completion;
    assert.equal(forceResult.exitCode, 0);
    assert.equal(JSON.parse(forceResult.stdout).data.changed, true);
    const credentialAfterForce = JSON.parse(
      await readFile(settingsPath, "utf8"),
    ).apiKey;
    assert(credentialAfterForce, "force must persist the replacement key");
    assert.notEqual(credentialAfterForce, credentialBeforeForce);
    const oldCredentialStatus = await fetch(
      `${runtimeBaseUrl}/open-api/v1/auth/status`,
      {
        headers: {
          Authorization: `Bearer ${credentialBeforeForce}`,
          "X-Client-Date": new Date().toISOString(),
          "User-Agent": "sharge-cli-e2e/1",
        },
      },
    );
    assert.equal(oldCredentialStatus.status, 401);
    recordLoginCase("forced credential rotation", ["--force"], forceResult);

    const limitedKey = `lms-s05-limited-${randomUUID().replaceAll("-", "")}`;
    const limitedHash = createHash("sha256").update(limitedKey).digest("hex");
    const limitedScopes = JSON.stringify(["quick_notes:read"]);
    const seedLimitedSql = [
      "INSERT INTO ai_open_api_keys",
      "(user_id,name,key_prefix,key_hash,expires_at,last_used_at,is_active,created_at,updated_at,scopes,creation_source,client_id,installation_id,client_info)",
      `VALUES ('cli-s05-user','CLI S05 limited','${limitedKey.slice(0, 12)}','${limitedHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${limitedScopes}','manual','sharge-cli','${installationId}','{}')`,
    ].join(" ");
    await runLifecycle([
      "mysql",
      "--id",
      runtimeId,
      "--",
      "-e",
      seedLimitedSql,
    ]);
    await writeLoginSettings(limitedKey);
    const scopeArgs = [
      "--scope",
      "quick_notes:read",
      "--scope",
      "calendar:read",
    ];
    const scopedLogin = startLogin(scopeArgs);
    const scopedCreated = await scopedLogin.created;
    await decide(scopedCreated.authorizationId, "approve");
    const scopedResult = await scopedLogin.completion;
    assert.equal(scopedResult.exitCode, 0);
    assert.deepEqual(JSON.parse(scopedResult.stdout).data.scopes, [
      "quick_notes:read",
      "calendar:read",
    ]);
    recordLoginCase("scope expansion authorization", scopeArgs, scopedResult);

    await writeLoginSettings(null);
    const cancelledLogin = startLogin();
    await cancelledLogin.created;
    cancelledLogin.child.kill("SIGINT");
    const cancelledResult = await cancelledLogin.completion;
    assert.equal(cancelledResult.exitCode, 130);
    assert.equal(JSON.parse(cancelledResult.stdout).error.type, "CANCELLED");
    assert.equal(
      JSON.parse(await readFile(settingsPath, "utf8")).apiKey,
      undefined,
    );
    recordLoginCase("Ctrl+C cancellation", [], cancelledResult);

    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    assert(!logContents.includes(limitedKey));
    assert(!logContents.includes(jwt));
    assert(!/poll-[a-z-]+-secret/.test(logContents));
  }

  if (includesSlice("S06")) {
    await prepareSliceHome();
    const runtimeBaseUrl = runtimeStatus.urls.web;
    const fullApiKey = `lms-s06-full-${randomUUID().replaceAll("-", "")}`;
    const limitedApiKey = `lms-s06-limited-${randomUUID().replaceAll("-", "")}`;
    const bigintApiKey = `lms-s06-bigint-${randomUUID().replaceAll("-", "")}`;
    const fullHash = createHash("sha256").update(fullApiKey).digest("hex");
    const limitedHash = createHash("sha256")
      .update(limitedApiKey)
      .digest("hex");
    const bigintHash = createHash("sha256").update(bigintApiKey).digest("hex");
    const fullScopes = JSON.stringify(["quick_notes:read", "calendar:read"]);
    const limitedScopes = JSON.stringify(["calendar:read"]);
    const seedSql = [
      "INSERT INTO ai_open_api_keys",
      "(user_id,name,key_prefix,key_hash,expires_at,last_used_at,is_active,created_at,updated_at,scopes,creation_source,client_id,installation_id,client_info)",
      `VALUES ('cli-s06-user','CLI S06 full','${fullApiKey.slice(0, 12)}','${fullHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${fullScopes}','manual','sharge-cli','install_s06_full','{}'),`,
      `('cli-s06-user','CLI S06 limited','${limitedApiKey.slice(0, 12)}','${limitedHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${limitedScopes}','manual','sharge-cli','install_s06_limited','{}'),`,
      `('cli-s06-bigint','CLI S06 bigint','${bigintApiKey.slice(0, 12)}','${bigintHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${fullScopes}','manual','sharge-cli','install_s06_bigint','{}');`,
      "INSERT INTO um_quick_note",
      "(id,user_id,image_path,audio_path,video_path,content,title,status,location,longitude,latitude,token,extra,created_at,updated_at)",
      "VALUES",
      "(6101,'cli-s06-user',NULL,NULL,NULL,'old body','Old note','success',NULL,NULL,NULL,NULL,'{}','2026-07-01 01:00:00','2026-07-01 01:00:00'),",
      "(6102,'cli-s06-user',NULL,NULL,NULL,'release body','Release plan','success','S06 Dock Alpha',121.47,31.23,NULL,'{}','2026-07-02 01:00:00','2026-07-02 01:00:00'),",
      "(6103,'cli-s06-user',NULL,NULL,NULL,'new body','Newest note','processing',NULL,NULL,NULL,NULL,'{}','2026-07-03 01:00:00','2026-07-03 01:00:00'),",
      "(6199,'cli-s06-other',NULL,NULL,NULL,'Release private body','Release private note','success',NULL,NULL,NULL,NULL,'{}','2026-07-04 01:00:00','2026-07-04 01:00:00'),",
      "(9007199254740993,'cli-s06-bigint',NULL,NULL,NULL,'unsafe older body','Unsafe older note','success',NULL,NULL,NULL,NULL,'{}','2026-06-30 01:00:00','2026-06-30 01:00:00'),",
      "(9007199254740994,'cli-s06-bigint',NULL,NULL,NULL,'unsafe newer body','Unsafe newer note','success',NULL,NULL,NULL,NULL,'{}','2026-06-30 02:00:00','2026-06-30 02:00:00');",
    ].join(" ");
    await runLifecycle(["mysql", "--id", runtimeId, "--", "-e", seedSql]);

    const fullEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: fullApiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };
    const limitedEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: limitedApiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };
    const bigintEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: bigintApiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };

    const firstPage = await assertCase(
      "real Notes first page",
      ["notes", "list", "--limit", "1", "--json"],
      {
        exitCode: 0,
        assert(result) {
          const envelope = JSON.parse(result.stdout);
          assert.equal(envelope.command, "notes.list");
          assert.deepEqual(
            envelope.data.items.map((item) => item.id),
            [6103],
          );
          assert.equal(envelope.data.has_more, true);
          assert.equal(envelope.data.next_cursor, 6103);
          assert.equal(envelope.data.items[0].future_backend_field, undefined);
          for (const forbidden of [
            "user_id",
            "image_path",
            "audio_path",
            "video_path",
            "token",
            "extra",
          ]) {
            assert.equal(forbidden in envelope.data.items[0], false);
          }
        },
      },
      fullEnv,
    );
    cases.push(firstPage);

    cases.push(
      await assertCase(
        "real Notes cursor continuation",
        ["notes", "list", "--cursor", "6103", "--limit", "1", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.deepEqual(
              envelope.data.items.map((item) => item.id),
              [6102],
            );
            assert.equal(envelope.data.next_cursor, 6102);
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Notes creation-time filters",
        [
          "notes",
          "list",
          "--created-at-start",
          "2026-07-02T00:00:00Z",
          "--created-at-end",
          "2026-07-03T00:00:00Z",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.deepEqual(
              envelope.data.items.map((item) => item.id),
              [6102],
            );
            assert.equal(envelope.data.has_more, false);
          },
        },
        fullEnv,
      ),
    );

    const unsafeIdPage = await assertCase(
      "real Notes unsafe integer cursor",
      [
        "notes",
        "list",
        "--created-at-start",
        "2026-06-30T00:00:00Z",
        "--created-at-end",
        "2026-07-01T00:00:00Z",
        "--limit",
        "1",
        "--json",
      ],
      {
        exitCode: 0,
        assert(result) {
          const envelope = JSON.parse(result.stdout);
          assert.equal(envelope.data.items[0].id, "9007199254740994");
          assert.equal(envelope.data.next_cursor, "9007199254740994");
          assert.equal(envelope.data.has_more, true);
        },
      },
      bigintEnv,
    );
    cases.push(unsafeIdPage);

    cases.push(
      await assertCase(
        "real Notes unsafe integer cursor continuation",
        [
          "notes",
          "list",
          "--created-at-start",
          "2026-06-30T00:00:00Z",
          "--created-at-end",
          "2026-07-01T00:00:00Z",
          "--limit",
          "1",
          "--cursor",
          JSON.parse(unsafeIdPage.stdout).data.next_cursor,
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.items[0].id, "9007199254740993");
            assert.equal(envelope.data.has_more, false);
            assert.equal(envelope.data.next_cursor, null);
          },
        },
        bigintEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Notes text next-page hint",
        ["notes", "list", "--limit", "1"],
        {
          exitCode: 0,
          assert(result) {
            assert.match(result.stdout, /#6103 Newest note \[processing\]/);
            assert.match(
              result.stdout,
              /下一页：sharge notes list --cursor 6103 --limit 1/,
            );
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Notes search",
        ["notes", "search", "Release", "--limit", "1", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.deepEqual(
              envelope.data.items.map((item) => item.id),
              [6102],
            );
            assert.equal(
              envelope.data.items.some((item) => item.id === 6199),
              false,
            );
            assert.deepEqual(envelope.data.items[0].matched_fields, [
              "title",
              "content",
            ]);
            assert.match(envelope.data.items[0].matched_title, /<mark>/);
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Notes detail",
        ["notes", "get", "6102", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.id, 6102);
            assert.equal(envelope.data.title, "Release plan");
            assert.equal(envelope.data.location, "S06 Dock Alpha");
            assert.equal(envelope.data.longitude, 121.47);
            assert.equal(envelope.data.latitude, 31.23);
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Notes cross-user detail",
        ["notes", "get", "6199", "--json"],
        {
          exitCode: 5,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "NOT_FOUND");
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge notes list --json",
            );
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Notes missing scope recovery",
        ["notes", "list", "--json"],
        {
          exitCode: 4,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "SCOPE_REQUIRED");
            assert.deepEqual(envelope.error.requiredScopes, [
              "quick_notes:read",
            ]);
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge login --scope quick_notes:read --scope calendar:read",
            );
          },
        },
        limitedEnv,
      ),
    );

    cases.push(
      await assertCase(
        "Notes invalid ID fast fail",
        ["notes", "get", "0", "--json"],
        {
          exitCode: 2,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "INVALID_INPUT");
            assert.equal(envelope.error.field, "note-id");
            assert.equal(envelope.meta.requestId, null);
          },
        },
        fullEnv,
      ),
    );

    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    assert(!logContents.includes(fullApiKey));
    assert(!logContents.includes(limitedApiKey));
    assert(!logContents.includes(bigintApiKey));
    for (const privateValue of [
      "new body",
      "release body",
      "Newest note",
      "Release plan",
      "S06 Dock Alpha",
      "Release",
      "unsafe newer body",
      "Unsafe newer note",
      "Release private body",
      "Release private note",
    ]) {
      assert(
        !logContents.includes(privateValue),
        `persistent logs leaked S06 business value: ${privateValue}`,
      );
    }
  }

  if (includesSlice("S07")) {
    await prepareSliceHome();
    const runtimeBaseUrl = runtimeStatus.urls.web;
    const fullApiKey = `lms-s07-full-${randomUUID().replaceAll("-", "")}`;
    const limitedApiKey = `lms-s07-limited-${randomUUID().replaceAll("-", "")}`;
    const timeoutApiKey = "lms-e2e-fault-timeout";
    const fullHash = createHash("sha256").update(fullApiKey).digest("hex");
    const limitedHash = createHash("sha256")
      .update(limitedApiKey)
      .digest("hex");
    const timeoutHash = createHash("sha256")
      .update(timeoutApiKey)
      .digest("hex");
    const fullScopes = JSON.stringify([
      "quick_notes:read",
      "quick_notes:write",
    ]);
    const limitedScopes = JSON.stringify(["quick_notes:read"]);
    const seedSql = [
      "INSERT IGNORE INTO ai_open_api_keys",
      "(user_id,name,key_prefix,key_hash,expires_at,last_used_at,is_active,created_at,updated_at,scopes,creation_source,client_id,installation_id,client_info)",
      `VALUES ('cli-s07-user','CLI S07 full','${fullApiKey.slice(0, 12)}','${fullHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${fullScopes}','manual','sharge-cli','install_s07_full','{}'),`,
      `('cli-s07-user','CLI S07 limited','${limitedApiKey.slice(0, 12)}','${limitedHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${limitedScopes}','manual','sharge-cli','install_s07_limited','{}'),`,
      `('cli-s07-user','CLI S07 timeout','${timeoutApiKey.slice(0, 12)}','${timeoutHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${fullScopes}','manual','sharge-cli','install_s07_timeout','{}');`,
      "INSERT INTO um_quick_note",
      "(id,user_id,image_path,audio_path,video_path,content,title,status,location,longitude,latitude,token,extra,created_at,updated_at)",
      "VALUES",
      "(7101,'cli-s07-user',NULL,NULL,NULL,'flags original body','Flags original','success',NULL,NULL,NULL,NULL,'{}','2026-07-01 01:00:00','2026-07-01 01:00:00'),",
      "(7102,'cli-s07-user',NULL,NULL,NULL,'clear this body','Clear content','success',NULL,NULL,NULL,NULL,'{}','2026-07-02 01:00:00','2026-07-02 01:00:00'),",
      "(7103,'cli-s07-user',NULL,NULL,NULL,'delete body','Delete target','success',NULL,NULL,NULL,NULL,'{}','2026-07-03 01:00:00','2026-07-03 01:00:00'),",
      "(7104,'cli-s07-user',NULL,NULL,NULL,'unknown body','Unknown target','success',NULL,NULL,NULL,NULL,'{}','2026-07-04 01:00:00','2026-07-04 01:00:00');",
    ].join(" ");
    await runLifecycle(["mysql", "--id", runtimeId, "--", "-e", seedSql]);

    const fullEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: fullApiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };
    const limitedEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: limitedApiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };

    cases.push(
      await assertCase(
        "Notes inline input dry run",
        [
          "notes",
          "update",
          "7101",
          "--input",
          '{"title":"inline dry title"}',
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.command, "notes.update");
            assert.equal(envelope.data.method, "PATCH");
            assert.deepEqual(envelope.data.body, {
              title: "inline dry title",
            });
            assert.equal(envelope.data.retrySafe, false);
          },
        },
        {
          SHARGE_API_KEY: null,
        },
      ),
    );

    cases.push(
      await assertCase(
        "Notes flags dry run",
        [
          "notes",
          "update",
          "7101",
          "--title",
          "flags dry title",
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            assert.deepEqual(JSON.parse(result.stdout).data.body, {
              title: "flags dry title",
            });
          },
        },
        {
          SHARGE_API_KEY: null,
        },
      ),
    );

    const inputPath = resolve(isolatedCwd, "s07-update.json");
    await writeFile(inputPath, '{"title":null,"content":"file dry body"}\n');
    cases.push(
      await assertCase(
        "Notes file input dry run",
        [
          "notes",
          "update",
          "7102",
          "--input",
          "@s07-update.json",
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            assert.deepEqual(JSON.parse(result.stdout).data.body, {
              title: null,
              content: "file dry body",
            });
          },
        },
        {
          SHARGE_API_KEY: null,
        },
      ),
    );

    cases.push(
      await assertCase(
        "Notes stdin input dry run",
        ["notes", "update", "7102", "--input", "-", "--dry-run", "--json"],
        {
          exitCode: 0,
          assert(result) {
            assert.deepEqual(JSON.parse(result.stdout).data.body, {
              content: "stdin dry body",
            });
          },
        },
        {
          SHARGE_API_KEY: null,
        },
        {
          stdin: '{"content":"stdin dry body"}',
        },
      ),
    );

    const generatedTemplate = await assertCase(
      "Notes raw input template",
      ["notes", "update", "7101", "--generate-input"],
      {
        exitCode: 0,
        assert(result) {
          assert.deepEqual(JSON.parse(result.stdout), {
            title: "",
            content: "",
          });
          assert.equal(result.stderr, "");
        },
      },
      {
        SHARGE_API_KEY: null,
      },
    );
    cases.push(generatedTemplate);
    const refill = JSON.parse(generatedTemplate.stdout);
    refill.title = "template refill title";
    refill.content = "template refill body";
    await writeFile(inputPath, `${JSON.stringify(refill, null, 2)}\n`);
    cases.push(
      await assertCase(
        "Notes generated template refill",
        [
          "notes",
          "update",
          "7101",
          "--input",
          "@s07-update.json",
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            assert.deepEqual(JSON.parse(result.stdout).data.body, refill);
          },
        },
        {
          SHARGE_API_KEY: null,
        },
      ),
    );

    cases.push(
      await assertCase(
        "Notes flags and input conflict fast fail",
        [
          "notes",
          "update",
          "7101",
          "--title",
          "conflict",
          "--input",
          '{"content":"conflict body"}',
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 2,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "INVALID_INPUT");
            assert.equal(envelope.error.field, "--input");
            assert.equal(envelope.meta.requestId, null);
          },
        },
        {
          SHARGE_API_KEY: null,
        },
      ),
    );

    cases.push(
      await assertCase(
        "Notes unknown input field fast fail",
        [
          "notes",
          "update",
          "7101",
          "--input",
          '{"title":"ok","unknown":1}',
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 2,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.path, "$.unknown");
            assert.equal(
              envelope.error.expected,
              "known field: title or content",
            );
            assert.equal(envelope.error.actual, "number");
          },
        },
        {
          SHARGE_API_KEY: null,
        },
      ),
    );

    cases.push(
      await assertCase(
        "Notes delete dry run needs no confirmation",
        ["notes", "delete", "7103", "--dry-run", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.method, "DELETE");
            assert.equal(envelope.data.body, null);
          },
        },
        {
          SHARGE_API_KEY: null,
        },
      ),
    );

    cases.push(
      await assertCase(
        "real Notes flags update",
        ["notes", "update", "7101", "--title", "Flags updated", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.id, 7101);
            assert.equal(envelope.data.title, "Flags updated");
            assert.equal(envelope.data.content, "flags original body");
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Notes null clearing update",
        ["notes", "update", "7102", "--input", '{"content":null}', "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.id, 7102);
            assert.equal(envelope.data.content, null);
            assert.equal(typeof envelope.meta.requestId, "string");
            assert(envelope.meta.requestId.length > 0);
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Notes delete requires yes",
        ["notes", "delete", "7103", "--json"],
        {
          exitCode: 2,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.field, "--yes");
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge notes delete 7103 --yes --json",
            );
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Notes confirmed delete",
        ["notes", "delete", "7103", "--yes", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data, null);
            assert.equal(typeof envelope.meta.requestId, "string");
            assert(envelope.meta.requestId.length > 0);
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Notes deleted resource is gone",
        ["notes", "get", "7103", "--json"],
        {
          exitCode: 5,
          assert(result) {
            assert.equal(JSON.parse(result.stdout).error.type, "NOT_FOUND");
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Notes write scope recovery",
        ["notes", "update", "7101", "--title", "denied", "--json"],
        {
          exitCode: 4,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "SCOPE_REQUIRED");
            assert.deepEqual(envelope.error.requiredScopes, [
              "quick_notes:write",
            ]);
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge login --scope quick_notes:read --scope quick_notes:write",
            );
          },
        },
        limitedEnv,
      ),
    );

    await runLifecycle(["stop", "--id", runtimeId, "web"]);
    await startOpenPlatformServer();
    await waitForUrl(`${runtimeBaseUrl}/open-api/v1/openapi.json`);
    cases.push(
      await assertCase(
        "Notes update unknown outcome is not retried",
        [
          "notes",
          "update",
          "7104",
          "--title",
          "possibly updated",
          "--timeout",
          "1s",
          "--json",
        ],
        {
          exitCode: 8,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "TIMEOUT");
            assert.equal(envelope.error.retryable, false);
            assert.equal(envelope.error.outcome, "unknown");
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge notes get 7104 --json",
            );
          },
        },
        {
          SHARGE_BASE_URL: runtimeBaseUrl,
          SHARGE_API_KEY: timeoutApiKey,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );
    const counts = await (
      await fetch(`${runtimeBaseUrl}/__e2e__/counts`)
    ).json();
    assert.equal(
      counts.timeout,
      1,
      "unknown write outcome must not be retried",
    );

    await unlink(inputPath);
    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    for (const privateValue of [
      fullApiKey,
      limitedApiKey,
      timeoutApiKey,
      "flags original body",
      "clear this body",
      "delete body",
      "unknown body",
      "inline dry title",
      "flags dry title",
      "file dry body",
      "stdin dry body",
      "template refill title",
      "template refill body",
      "Flags updated",
      "possibly updated",
    ]) {
      assert(
        !logContents.includes(privateValue),
        `persistent logs leaked S07 private value: ${privateValue}`,
      );
    }
  }

  if (includesSlice("S08")) {
    await prepareSliceHome();
    const runtimeBaseUrl = runtimeStatus.urls.web;
    const apiKey = `lms-s08-${randomUUID().replaceAll("-", "")}`;
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
    const scopes = JSON.stringify(["quick_notes:read"]);
    const seedSql = [
      "INSERT INTO ai_open_api_keys",
      "(user_id,name,key_prefix,key_hash,expires_at,last_used_at,is_active,created_at,updated_at,scopes,creation_source,client_id,installation_id,client_info)",
      `VALUES ('cli-s08-user','CLI S08','${apiKey.slice(0, 12)}','${apiKeyHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${scopes}','manual','sharge-cli','install_s08','{}');`,
      "INSERT INTO um_quick_note",
      "(id,user_id,image_path,audio_path,video_path,content,title,status,location,longitude,latitude,token,extra,created_at,updated_at)",
      "VALUES",
      "(8101,'cli-s08-user','cli-s08-user/quick_note/seed-image.png',NULL,NULL,'seed image body','Seed image','success',NULL,NULL,NULL,NULL,'{}','2026-07-08 01:00:00','2026-07-08 01:00:00'),",
      "(8102,'cli-s08-user','cli-s08-user/quick_note/partial-image.png',NULL,NULL,'partial image body','Partial image','success',NULL,NULL,NULL,NULL,'{}','2026-07-08 02:00:00','2026-07-08 02:00:00');",
    ].join(" ");
    await runLifecycle(["mysql", "--id", runtimeId, "--", "-e", seedSql]);

    const crossOriginMediaUrl = await startDownloadMediaServer();
    await runLifecycle(["stop", "--id", runtimeId, "web"]);
    await startOpenPlatformServer(crossOriginMediaUrl);
    await waitForUrl(`${runtimeBaseUrl}/open-api/v1/openapi.json`);

    const realEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: apiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };
    const media = Buffer.from("s08-seed-image-content");
    const mediaSha256 = createHash("sha256").update(media).digest("hex");
    const defaultPath = resolve(canonicalCwd, "seed-image.png");
    const conflictPath = resolve(canonicalCwd, "seed-image-1.png");
    const textPath = resolve(canonicalCwd, "seed-image-2.png");
    const explicitPath = resolve(canonicalCwd, "explicit-image.png");

    cases.push(
      await assertCase(
        "Notes download JSON help",
        ["notes", "download", "--help", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.command, "notes.download");
            assert.deepEqual(data.requiredScopes, ["quick_notes:read"]);
            assert(
              data.options.some(
                (option) =>
                  option.name === "--media" &&
                  option.required === true &&
                  option.enum.join(",") === "audio,image,video",
              ),
            );
            assert(data.errors.includes("FILE_EXISTS"));
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "Notes download dry run is offline and creates no file",
        [
          "notes",
          "download",
          "8101",
          "--media",
          "image",
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.data.method, "GET");
            assert.equal(
              envelope.data.filePath,
              resolve(canonicalCwd, "note-8101-image.jpg"),
            );
            assert.deepEqual(envelope.data.requiredScopes, [
              "quick_notes:read",
            ]);
          },
        },
        {
          SHARGE_BASE_URL: sentinelBaseUrl,
          SHARGE_API_KEY: null,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );

    cases.push(
      await assertCase(
        "real Notes default image download",
        ["notes", "download", "8101", "--media", "image", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.command, "notes.download");
            assert.deepEqual(envelope.data, {
              filePath: defaultPath,
              bytes: media.byteLength,
              mediaType: "image/png",
              sha256: mediaSha256,
            });
            assert(envelope.meta.requestId);
            assert.equal(result.stderr, "");
          },
        },
        realEnv,
      ),
    );
    assert.deepEqual(await readFile(defaultPath), media);

    cases.push(
      await assertCase(
        "real Notes duplicate chooses suffix before body",
        ["notes", "download", "8101", "--media", "image", "--json"],
        {
          exitCode: 0,
          assert(result) {
            assert.equal(JSON.parse(result.stdout).data.filePath, conflictPath);
          },
        },
        realEnv,
      ),
    );
    assert.deepEqual(await readFile(conflictPath), media);

    cases.push(
      await assertCase(
        "real Notes text download prints absolute path",
        ["notes", "download", "8101", "--media", "image"],
        {
          exitCode: 0,
          assert(result) {
            assert.equal(result.stdout, `${textPath}\n`);
            assert.equal(result.stderr, "");
          },
        },
        realEnv,
      ),
    );
    assert.deepEqual(await readFile(textPath), media);

    await writeFile(explicitPath, "preserve-me");
    cases.push(
      await assertCase(
        "Notes explicit existing target fast fails",
        [
          "notes",
          "download",
          "8101",
          "--media",
          "image",
          "--file",
          "./explicit-image.png",
          "--json",
        ],
        {
          exitCode: 2,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "FILE_EXISTS");
            assert.equal(envelope.error.field, "--file");
          },
        },
        realEnv,
      ),
    );
    assert.equal(await readFile(explicitPath, "utf8"), "preserve-me");

    cases.push(
      await assertCase(
        "real Notes explicit overwrite",
        [
          "notes",
          "download",
          "8101",
          "--media",
          "image",
          "--file",
          "./explicit-image.png",
          "--overwrite",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            assert.equal(JSON.parse(result.stdout).data.filePath, explicitPath);
          },
        },
        realEnv,
      ),
    );
    assert.deepEqual(await readFile(explicitPath), media);

    cases.push(
      await assertCase(
        "incomplete Notes download cleans reservation and temp file",
        ["notes", "download", "8102", "--media", "image", "--json"],
        {
          exitCode: 8,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "NETWORK_ERROR");
            assert.equal(envelope.error.retryable, true);
            assert.equal(envelope.meta.requestId, "req_runtime_e2e");
          },
        },
        realEnv,
      ),
    );
    assert(
      !(await readdir(isolatedCwd)).some(
        (name) =>
          name === "partial-image.png" ||
          name.includes("partial-image.png.sharge-"),
      ),
      "failed download must clean reservation and temporary file",
    );

    assert.equal(downloadMediaHeaders.length, 5);
    for (const observation of downloadMediaHeaders) {
      assert.equal(
        observation.authorization,
        null,
        "redirect target must never receive Authorization",
      );
      assert.equal(observation.host, new URL(crossOriginMediaUrl).host);
    }
    const observedHeaders = await (
      await fetch(`${runtimeBaseUrl}/__e2e__/observed-headers`)
    ).json();
    assert.equal(observedHeaders.length, 5);
    assert(
      observedHeaders.every((observation) => observation.authorization),
      "initial Open Platform requests must remain authenticated",
    );

    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    for (const privateValue of [
      apiKey,
      "s08-signed-secret",
      crossOriginMediaUrl,
      "seed image body",
      "partial image body",
    ]) {
      assert(
        !logContents.includes(privateValue),
        `persistent logs leaked S08 private value: ${privateValue}`,
      );
    }
    assert.match(logContents, /"path":"\[download-redirect\]"/);

    await Promise.all(
      [defaultPath, conflictPath, textPath, explicitPath].map((path) =>
        unlink(path),
      ),
    );
  }

  if (includesSlice("S09")) {
    await prepareSliceHome();
    const runtimeBaseUrl = runtimeStatus.urls.web;
    const fullApiKey = `lms-s09-full-${randomUUID().replaceAll("-", "")}`;
    const limitedApiKey = `lms-s09-limited-${randomUUID().replaceAll("-", "")}`;
    const fullHash = createHash("sha256").update(fullApiKey).digest("hex");
    const limitedHash = createHash("sha256")
      .update(limitedApiKey)
      .digest("hex");
    const fullScopes = JSON.stringify(["quick_notes:read", "calendar:read"]);
    const limitedScopes = JSON.stringify(["quick_notes:read"]);
    const seedSql = [
      "INSERT INTO ai_open_api_keys",
      "(user_id,name,key_prefix,key_hash,expires_at,last_used_at,is_active,created_at,updated_at,scopes,creation_source,client_id,installation_id,client_info)",
      `VALUES ('cli-s09-user','CLI S09 full','${fullApiKey.slice(0, 12)}','${fullHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${fullScopes}','manual','sharge-cli','install_s09_full','{}'),`,
      `('cli-s09-user','CLI S09 limited','${limitedApiKey.slice(0, 12)}','${limitedHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${limitedScopes}','manual','sharge-cli','install_s09_limited','{}');`,
      "INSERT INTO ai_events",
      "(id,user_id,type,draft,title,description,location,start_time,end_time,is_all_day,timezone,rrule,excluded_dates,enable_alarm,trigger_seconds,trigger_description,extra,source_type,source_id,created_at,updated_at)",
      "VALUES",
      "(9101,'cli-s09-user','EVENT',0,'S09 Project Review','S09 event private description','S09 Room Alpha','2026-07-30 02:00:00','2026-07-30 03:00:00',0,'Asia/Shanghai',NULL,NULL,1,-900,'S09 reminder','{}','MANUAL','s09-manual','2026-07-01 00:00:00','2026-07-01 00:00:00'),",
      "(9102,'cli-s09-user','TODO',0,'S09 Release Todo','S09 todo private description',NULL,'2026-07-30 04:00:00',NULL,0,'Asia/Shanghai',NULL,NULL,0,0,NULL,'{\"completed\": false}','QUICK_NOTE','s09-note','2026-07-02 00:00:00','2026-07-02 00:00:00'),",
      "(9103,'cli-s09-user','EVENT',0,'S09 Weekly Sync','S09 recurring private description','S09 Room Beta','2026-07-01 01:00:00','2026-07-01 01:30:00',0,'Asia/Shanghai','FREQ=WEEKLY;COUNT=5',NULL,0,0,NULL,'{}','AUDIO_RECORDED','s09-recording','2026-07-03 00:00:00','2026-07-03 00:00:00'),",
      "(9104,'cli-s09-user','EVENT',1,'S09 Hidden Draft','S09 draft private description',NULL,'2026-07-30 05:00:00','2026-07-30 06:00:00',0,'Asia/Shanghai',NULL,NULL,0,0,NULL,'{}','MANUAL','s09-draft','2026-07-04 00:00:00','2026-07-04 00:00:00'),",
      "(9199,'cli-s09-other','EVENT',0,'S09 Other User Secret','S09 cross-user private description',NULL,'2026-07-30 07:00:00','2026-07-30 08:00:00',0,'Asia/Shanghai',NULL,NULL,0,0,NULL,'{}','MANUAL','s09-other','2026-07-05 00:00:00','2026-07-05 00:00:00'),",
      "(9120,'cli-s09-user','EVENT',0,'DST Before March','DST before-boundary private description',NULL,'2026-03-01 04:30:00','2026-03-01 04:45:00',0,'America/New_York',NULL,NULL,0,0,NULL,'{}','MANUAL','s09-dst-before','2026-03-01 00:00:00','2026-03-01 00:00:00'),",
      "(9121,'cli-s09-user','EVENT',0,'DST March Start','DST start-boundary private description',NULL,'2026-03-01 05:30:00','2026-03-01 05:45:00',0,'America/New_York',NULL,NULL,0,0,NULL,'{}','MANUAL','s09-dst-start','2026-03-01 00:00:00','2026-03-01 00:00:00'),",
      "(9122,'cli-s09-user','EVENT',0,'DST March End','DST end-boundary private description',NULL,'2026-04-01 03:30:00','2026-04-01 03:45:00',0,'America/New_York',NULL,NULL,0,0,NULL,'{}','MANUAL','s09-dst-end','2026-03-01 00:00:00','2026-03-01 00:00:00'),",
      "(9123,'cli-s09-user','EVENT',0,'DST After March','DST after-boundary private description',NULL,'2026-04-01 04:30:00','2026-04-01 04:45:00',0,'America/New_York',NULL,NULL,0,0,NULL,'{}','MANUAL','s09-dst-after','2026-03-01 00:00:00','2026-03-01 00:00:00');",
      "INSERT INTO ai_event_instances",
      "(user_id,event_id,original_start_time,original_end_time,actual_start_time,actual_end_time,trigger_start_time,is_cancelled,override,created_at,updated_at)",
      "VALUES",
      "('cli-s09-user',9101,'2026-07-30 02:00:00','2026-07-30 03:00:00','2026-07-30 02:00:00','2026-07-30 03:00:00','2026-07-30 01:45:00',0,NULL,'2026-07-01 00:00:00','2026-07-01 00:00:00'),",
      "('cli-s09-user',9102,'2026-07-30 04:00:00',NULL,'2026-07-30 04:00:00',NULL,'2026-07-30 04:00:00',0,NULL,'2026-07-02 00:00:00','2026-07-02 00:00:00'),",
      "('cli-s09-user',9103,'2026-07-29 01:00:00','2026-07-29 01:30:00','2026-07-29 01:00:00','2026-07-29 01:30:00','2026-07-29 01:00:00',0,NULL,'2026-07-03 00:00:00','2026-07-03 00:00:00'),",
      "('cli-s09-user',9104,'2026-07-30 05:00:00','2026-07-30 06:00:00','2026-07-30 05:00:00','2026-07-30 06:00:00','2026-07-30 05:00:00',0,NULL,'2026-07-04 00:00:00','2026-07-04 00:00:00'),",
      "('cli-s09-other',9199,'2026-07-30 07:00:00','2026-07-30 08:00:00','2026-07-30 07:00:00','2026-07-30 08:00:00','2026-07-30 07:00:00',0,NULL,'2026-07-05 00:00:00','2026-07-05 00:00:00'),",
      "('cli-s09-user',9120,'2026-03-01 04:30:00','2026-03-01 04:45:00','2026-03-01 04:30:00','2026-03-01 04:45:00','2026-03-01 04:30:00',0,NULL,'2026-03-01 00:00:00','2026-03-01 00:00:00'),",
      "('cli-s09-user',9121,'2026-03-01 05:30:00','2026-03-01 05:45:00','2026-03-01 05:30:00','2026-03-01 05:45:00','2026-03-01 05:30:00',0,NULL,'2026-03-01 00:00:00','2026-03-01 00:00:00'),",
      "('cli-s09-user',9122,'2026-04-01 03:30:00','2026-04-01 03:45:00','2026-04-01 03:30:00','2026-04-01 03:45:00','2026-04-01 03:30:00',0,NULL,'2026-03-01 00:00:00','2026-03-01 00:00:00'),",
      "('cli-s09-user',9123,'2026-04-01 04:30:00','2026-04-01 04:45:00','2026-04-01 04:30:00','2026-04-01 04:45:00','2026-04-01 04:30:00',0,NULL,'2026-03-01 00:00:00','2026-03-01 00:00:00');",
    ].join(" ");
    await runLifecycle(["mysql", "--id", runtimeId, "--", "-e", seedSql]);

    const fullEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: fullApiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };
    const limitedEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: limitedApiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };

    cases.push(
      await assertCase(
        "Calendar month JSON help",
        ["calendar", "month", "--help", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.command, "calendar.month");
            assert.deepEqual(data.requiredScopes, ["calendar:read"]);
            assert.equal(data.retrySafe, true);
            assert.equal(data.timeout, 30_000);
            assert(
              data.options.some(
                (option) =>
                  option.name === "--source-type" &&
                  option.enum.join(",") ===
                    "all,manual,quick_note,audio_recorded",
              ),
            );
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Calendar month tracer",
        [
          "calendar",
          "month",
          "2026-07",
          "--timezone",
          "Asia/Shanghai",
          "--source-type",
          "all",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.command, "calendar.month");
            assert.deepEqual(Object.keys(envelope.data.events).sort(), [
              "9101",
              "9102",
              "9103",
            ]);
            assert.equal("9104" in envelope.data.events, false);
            assert.equal("9199" in envelope.data.events, false);
            assert(Array.isArray(envelope.data.dates["29"]));
            assert(Array.isArray(envelope.data.dates["30"]));
            assert.equal(
              envelope.data.dates["29"].some(
                (instance) =>
                  instance.event_id === 9103 &&
                  typeof instance.instance_id === "string",
              ),
              true,
            );
            assert.equal(envelope.meta.timezone, "Asia/Shanghai");
            assert.match(envelope.meta.clientDate, /\+08:00$/);
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Calendar source filter",
        [
          "calendar",
          "month",
          "2026-07",
          "--source-type",
          "quick_note",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.deepEqual(Object.keys(data.events), ["9102"]);
            assert(
              Object.values(data.dates)
                .flat()
                .every((instance) => instance.event_id === 9102),
            );
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Calendar DST month boundaries",
        [
          "calendar",
          "month",
          "2026-03",
          "--timezone",
          "America/New_York",
          "--source-type",
          "manual",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.deepEqual(Object.keys(envelope.data.events).sort(), [
              "9121",
              "9122",
            ]);
            assert.deepEqual(Object.keys(envelope.data.dates).sort(), [
              "1",
              "31",
            ]);
            assert.equal("9120" in envelope.data.events, false);
            assert.equal("9123" in envelope.data.events, false);
            assert.equal(envelope.meta.timezone, "America/New_York");
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Calendar month text",
        ["calendar", "month", "2026-07"],
        {
          exitCode: 0,
          assert(result) {
            assert.match(result.stdout, /#9101 S09 Project Review \[event\]/);
            assert.match(result.stdout, /#9102 S09 Release Todo \[todo\]/);
            assert.doesNotMatch(result.stdout, /S09 Hidden Draft/);
            assert.equal(result.stderr, "");
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Calendar explicit range",
        [
          "calendar",
          "list",
          "--start",
          "2026-07-29T00:00:00+08:00",
          "--end",
          "2026-07-31T00:00:00+08:00",
          "--timezone",
          "Asia/Shanghai",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.deepEqual(
              data.events.map((event) => event.id).sort(),
              [9101, 9102, 9103],
            );
            assert.equal(
              data.instances.some(
                (instance) =>
                  instance.event_id === 9103 &&
                  instance.instance_id.includes("_9103_"),
              ),
              true,
            );
            assert.equal(
              data.events.some((event) => event.id === 9104),
              false,
            );
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Calendar formal title search",
        [
          "calendar",
          "search",
          "S09",
          "--source-type",
          "all",
          "--limit",
          "100",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.deepEqual(
              data.map((event) => event.id).sort(),
              [9101, 9102, 9103],
            );
            assert(data.every((event) => event.title.startsWith("S09")));
            assert(
              data.every((event) => typeof event.matched_title === "string"),
            );
            assert.equal(
              data.some(
                (event) =>
                  event.id === 9104 ||
                  event.id === 9199 ||
                  event.title === "S09 Hidden Draft" ||
                  event.title === "S09 Other User Secret",
              ),
              false,
            );
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Calendar event detail",
        ["calendar", "get", "9101", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.id, 9101);
            assert.equal(data.type, "event");
            assert.equal(data.source_type, "manual");
            assert.equal(data.trigger_seconds, -900);
            assert.equal(data.completed, null);
            assert.equal("user_id" in data, false);
            assert.equal("draft" in data, false);
            assert.equal("extra" in data, false);
          },
        },
        fullEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Calendar todo detail",
        ["calendar", "get", "9102", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.id, 9102);
            assert.equal(data.type, "todo");
            assert.equal(data.source_type, "quick_note");
            assert.equal(data.completed, false);
          },
        },
        fullEnv,
      ),
    );

    for (const [name, eventId] of [
      ["Calendar draft detail is hidden", "9104"],
      ["Calendar cross-user detail is hidden", "9199"],
    ]) {
      cases.push(
        await assertCase(
          name,
          ["calendar", "get", eventId, "--json"],
          {
            exitCode: 5,
            assert(result) {
              const envelope = JSON.parse(result.stdout);
              assert.equal(envelope.error.type, "NOT_FOUND");
              assert.equal(
                envelope.error.nextActions[0].command,
                "sharge calendar list --help --json",
              );
            },
          },
          fullEnv,
        ),
      );
    }

    cases.push(
      await assertCase(
        "real Calendar missing scope recovery",
        ["calendar", "month", "2026-07", "--json"],
        {
          exitCode: 4,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "SCOPE_REQUIRED");
            assert.deepEqual(envelope.error.requiredScopes, ["calendar:read"]);
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge login --scope quick_notes:read --scope calendar:read",
            );
          },
        },
        limitedEnv,
      ),
    );

    for (const [name, args, field] of [
      [
        "Calendar invalid month fast fails",
        ["calendar", "month", "2026-13", "--json"],
        "month",
      ],
      [
        "Calendar missing datetime offset fast fails",
        [
          "calendar",
          "list",
          "--start",
          "2026-07-30T00:00:00",
          "--end",
          "2026-07-31T00:00:00+08:00",
          "--json",
        ],
        "--start",
      ],
      [
        "Calendar invalid timezone fast fails",
        [
          "calendar",
          "month",
          "2026-07",
          "--timezone",
          "Mars/Olympus",
          "--json",
        ],
        "timezone",
      ],
    ]) {
      cases.push(
        await assertCase(
          name,
          args,
          {
            exitCode: 2,
            assert(result) {
              const envelope = JSON.parse(result.stdout);
              assert.equal(envelope.error.type, "INVALID_INPUT");
              assert.equal(envelope.error.field, field);
              assert.equal(envelope.meta.requestId, null);
            },
          },
          {
            SHARGE_BASE_URL: sentinelBaseUrl,
            SHARGE_API_KEY: fullApiKey,
            SHARGE_TIMEZONE: "Asia/Shanghai",
          },
        ),
      );
    }

    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    for (const privateValue of [
      fullApiKey,
      limitedApiKey,
      "S09 event private description",
      "S09 todo private description",
      "S09 recurring private description",
      "S09 draft private description",
      "S09 cross-user private description",
      "DST before-boundary private description",
      "DST start-boundary private description",
      "DST end-boundary private description",
      "DST after-boundary private description",
      "S09 Room Alpha",
      "S09 Room Beta",
    ]) {
      assert(
        !logContents.includes(privateValue),
        `persistent logs leaked S09 private value: ${privateValue}`,
      );
    }
  }

  if (includesSlice("S10")) {
    await prepareSliceHome();
    const runtimeBaseUrl = runtimeStatus.urls.web;
    const apiKey = `lms-s10-${randomUUID().replaceAll("-", "")}`;
    const timeoutApiKey = "lms-e2e-fault-timeout";
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
    const timeoutHash = createHash("sha256")
      .update(timeoutApiKey)
      .digest("hex");
    const scopes = JSON.stringify(["calendar:read", "calendar:write"]);
    const seedSql = [
      "INSERT IGNORE INTO ai_open_api_keys",
      "(user_id,name,key_prefix,key_hash,expires_at,last_used_at,is_active,created_at,updated_at,scopes,creation_source,client_id,installation_id,client_info)",
      `VALUES ('cli-s10-user','CLI S10','${apiKey.slice(0, 12)}','${apiKeyHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${scopes}','manual','sharge-cli','install_s10','{}'),`,
      `('cli-s10-user','CLI S10 timeout','${timeoutApiKey.slice(0, 12)}','${timeoutHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${scopes}','manual','sharge-cli','install_s10_timeout','{}');`,
    ].join(" ");
    await runLifecycle(["mysql", "--id", runtimeId, "--", "-e", seedSql]);

    const realEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: apiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };
    const eventInput = {
      title: "S10 Project Review",
      description: "S10 private event description",
      location: null,
      timezone: "Asia/Shanghai",
      type: "event",
      start_time: "2026-08-10T10:00:00+08:00",
      end_time: "2026-08-10T11:00:00+08:00",
      is_all_day: false,
      rrule: null,
      enable_alarm: true,
      trigger_seconds: -900,
      trigger_description: null,
    };
    const eventInputPath = resolve(isolatedCwd, "s10-event.json");
    await writeFile(eventInputPath, `${JSON.stringify(eventInput, null, 2)}\n`);

    cases.push(
      await assertCase(
        "Calendar create JSON help",
        ["calendar", "create", "--help", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.command, "calendar.create");
            assert.deepEqual(data.requiredScopes, ["calendar:write"]);
            assert.equal(data.dryRun, true);
            assert.equal(data.retrySafe, false);
            assert.equal(data.inputSchema.additionalProperties, false);
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "Calendar create file tracer dry run",
        [
          "calendar",
          "create",
          "--input",
          "@s10-event.json",
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.command, "calendar.create");
            assert.equal(envelope.data.method, "POST");
            assert.deepEqual(envelope.data.body, eventInput);
            assert.equal(envelope.data.retrySafe, false);
          },
        },
        {
          SHARGE_BASE_URL: sentinelBaseUrl,
          SHARGE_API_KEY: null,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );

    const createdEvent = await assertCase(
      "real Calendar event create",
      ["calendar", "create", "--input", "@s10-event.json", "--json"],
      {
        exitCode: 0,
        assert(result) {
          const data = JSON.parse(result.stdout).data;
          assert.equal(data.title, eventInput.title);
          assert.equal(data.type, "event");
          assert.equal(data.description, eventInput.description);
          assert.equal(data.location, null);
          assert.equal(data.source_type, "manual");
          assert.equal(data.trigger_seconds, -900);
        },
      },
      realEnv,
    );
    cases.push(createdEvent);
    const eventId = String(JSON.parse(createdEvent.stdout).data.id);

    cases.push(
      await assertCase(
        "public get verifies created event",
        ["calendar", "get", eventId, "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.title, eventInput.title);
            assert.equal(data.location, null);
            assert.equal(data.rrule, null);
          },
        },
        realEnv,
      ),
    );

    const createdTodo = await assertCase(
      "real Calendar todo flags create",
      [
        "calendar",
        "create",
        "--title",
        "S10 Release Todo",
        "--type",
        "todo",
        "--start-time",
        "2026-08-10T15:00:00+08:00",
        "--json",
      ],
      {
        exitCode: 0,
        assert(result) {
          const data = JSON.parse(result.stdout).data;
          assert.equal(data.type, "todo");
          assert.equal(data.description, null);
          assert.equal(data.end_time, null);
          assert.equal(data.rrule, null);
          assert.equal(data.enable_alarm, false);
          assert.equal(data.completed, false);
        },
      },
      realEnv,
    );
    cases.push(createdTodo);
    const todoId = String(JSON.parse(createdTodo.stdout).data.id);
    cases.push(
      await assertCase(
        "public get verifies created todo",
        ["calendar", "get", todoId, "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.title, "S10 Release Todo");
            assert.equal(data.type, "todo");
            assert.equal(data.description, null);
          },
        },
        realEnv,
      ),
    );

    const allUpdateInput = {
      ...eventInput,
      title: "S10 Project Review Updated",
      description: null,
    };
    const allUpdate = await assertCase(
      "real Calendar all PUT with default action",
      [
        "calendar",
        "update",
        eventId,
        "--input",
        JSON.stringify(allUpdateInput),
        "--json",
      ],
      {
        exitCode: 0,
        assert(result) {
          const data = JSON.parse(result.stdout).data;
          assert.equal(data.action, "all");
          assert.equal(data.created_events.length, 1);
          assert.equal(
            data.created_events[0].title,
            "S10 Project Review Updated",
          );
          assert.equal(String(data.deleted_events[0].id), eventId);
          assert.notEqual(
            String(data.created_events[0].id),
            eventId,
            "all update must expose the replacement ID",
          );
        },
      },
      realEnv,
    );
    cases.push(allUpdate);
    const replacementEventId = String(
      JSON.parse(allUpdate.stdout).data.created_events[0].id,
    );
    cases.push(
      await assertCase(
        "public get confirms old all-update ID is gone",
        ["calendar", "get", eventId, "--json"],
        {
          exitCode: 5,
          assert(result) {
            assert.equal(JSON.parse(result.stdout).error.type, "NOT_FOUND");
          },
        },
        realEnv,
      ),
    );
    cases.push(
      await assertCase(
        "public get verifies all-update replacement",
        ["calendar", "get", replacementEventId, "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.title, "S10 Project Review Updated");
            assert.equal(data.description, null);
          },
        },
        realEnv,
      ),
    );

    const recurringInput = {
      title: "S10 Daily Sync",
      description: null,
      location: "S10 Room",
      timezone: "Asia/Shanghai",
      type: "event",
      start_time: "2026-08-11T09:00:00+08:00",
      end_time: "2026-08-11T09:30:00+08:00",
      is_all_day: false,
      rrule: "FREQ=DAILY;COUNT=5",
      enable_alarm: null,
      trigger_seconds: 0,
      trigger_description: null,
    };
    const recurringCreate = await assertCase(
      "real Calendar RRULE create",
      [
        "calendar",
        "create",
        "--input",
        JSON.stringify(recurringInput),
        "--json",
      ],
      {
        exitCode: 0,
        assert(result) {
          const data = JSON.parse(result.stdout).data;
          assert.equal(data.rrule, recurringInput.rrule);
          assert.equal(data.location, "S10 Room");
        },
      },
      realEnv,
    );
    cases.push(recurringCreate);
    const recurringId = String(JSON.parse(recurringCreate.stdout).data.id);

    const recurringRangeArgs = [
      "calendar",
      "list",
      "--start",
      "2026-08-11T00:00:00+08:00",
      "--end",
      "2026-08-17T00:00:00+08:00",
      "--json",
    ];
    const initialRange = await assertCase(
      "public list verifies RRULE instances",
      recurringRangeArgs,
      {
        exitCode: 0,
        assert(result) {
          const data = JSON.parse(result.stdout).data;
          const instances = data.instances.filter(
            (instance) => String(instance.event_id) === recurringId,
          );
          assert.equal(instances.length, 5);
          assert(instances.every((instance) => instance.instance_id));
        },
      },
      realEnv,
    );
    cases.push(initialRange);
    const recurringInstances = JSON.parse(initialRange.stdout)
      .data.instances.filter(
        (instance) => String(instance.event_id) === recurringId,
      )
      .sort((left, right) =>
        left.original_start_time.localeCompare(right.original_start_time),
      );

    const instanceInput = {
      ...recurringInput,
      title: "S10 Single Instance",
      start_time: recurringInstances[1].actual_start_time,
      end_time: recurringInstances[1].actual_end_time,
      action: "instance",
      instance_id: recurringInstances[1].instance_id,
    };
    const instanceUpdate = await assertCase(
      "real Calendar single instance PUT",
      [
        "calendar",
        "update",
        recurringId,
        "--input",
        JSON.stringify(instanceInput),
        "--json",
      ],
      {
        exitCode: 0,
        assert(result) {
          const data = JSON.parse(result.stdout).data;
          assert.equal(data.action, "instance");
          assert.equal(data.created_events.length, 1);
          assert.equal(data.created_events[0].title, "S10 Single Instance");
          assert.equal(data.created_events[0].rrule, null);
          assert.equal(data.updated_events[0].id, Number(recurringId));
        },
      },
      realEnv,
    );
    cases.push(instanceUpdate);
    const replacementId = String(
      JSON.parse(instanceUpdate.stdout).data.created_events[0].id,
    );

    cases.push(
      await assertCase(
        "public list verifies single instance replacement",
        recurringRangeArgs,
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert(
              data.events.some(
                (event) =>
                  String(event.id) === replacementId &&
                  event.title === "S10 Single Instance" &&
                  event.rrule === null,
              ),
            );
            assert(
              data.events.some(
                (event) =>
                  String(event.id) === recurringId &&
                  Array.isArray(event.excluded_dates) &&
                  event.excluded_dates.length === 1,
              ),
            );
          },
        },
        realEnv,
      ),
    );

    const afterInstanceRange = await assertCase(
      "public list supplies opaque future instance",
      recurringRangeArgs,
      {
        exitCode: 0,
        assert(result) {
          const instances = JSON.parse(result.stdout).data.instances.filter(
            (instance) =>
              String(instance.event_id) === recurringId &&
              !instance.is_cancelled,
          );
          assert(instances.length >= 2);
        },
      },
      realEnv,
    );
    cases.push(afterInstanceRange);
    const futureInstance = JSON.parse(afterInstanceRange.stdout)
      .data.instances.filter(
        (instance) =>
          String(instance.event_id) === recurringId && !instance.is_cancelled,
      )
      .sort((left, right) =>
        left.original_start_time.localeCompare(right.original_start_time),
      )
      .at(-1);
    assert(futureInstance, "future instance required");

    const futureInput = {
      ...recurringInput,
      title: "S10 Future Series",
      start_time: futureInstance.actual_start_time,
      end_time: futureInstance.actual_end_time,
      rrule: "FREQ=DAILY;COUNT=2",
      action: "future",
      instance_id: futureInstance.instance_id,
    };
    const futureUpdate = await assertCase(
      "real Calendar future instances PUT",
      [
        "calendar",
        "update",
        recurringId,
        "--input",
        JSON.stringify(futureInput),
        "--json",
      ],
      {
        exitCode: 0,
        assert(result) {
          const data = JSON.parse(result.stdout).data;
          assert.equal(data.action, "future");
          assert.equal(data.created_events.length, 1);
          assert.equal(data.created_events[0].title, "S10 Future Series");
          assert.match(data.updated_events[0].rrule, /UNTIL=/);
        },
      },
      realEnv,
    );
    cases.push(futureUpdate);
    const futureSeriesId = String(
      JSON.parse(futureUpdate.stdout).data.created_events[0].id,
    );

    cases.push(
      await assertCase(
        "public list verifies future series split",
        recurringRangeArgs,
        {
          exitCode: 0,
          assert(result) {
            const events = JSON.parse(result.stdout).data.events;
            assert(
              events.some(
                (event) =>
                  String(event.id) === futureSeriesId &&
                  event.title === "S10 Future Series",
              ),
            );
            assert(
              events.some(
                (event) =>
                  String(event.id) === recurringId &&
                  event.rrule.includes("UNTIL="),
              ),
            );
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "Calendar instance action requires opaque ID before network",
        [
          "calendar",
          "update",
          recurringId,
          "--input",
          JSON.stringify({
            ...recurringInput,
            action: "instance",
            instance_id: null,
          }),
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 2,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.field, "--instance-id");
            assert.equal(envelope.meta.requestId, null);
          },
        },
        {
          SHARGE_BASE_URL: sentinelBaseUrl,
          SHARGE_API_KEY: null,
        },
      ),
    );

    await runLifecycle(["stop", "--id", runtimeId, "web"]);
    await startOpenPlatformServer();
    await waitForUrl(`${runtimeBaseUrl}/open-api/v1/openapi.json`);
    cases.push(
      await assertCase(
        "Calendar create unknown outcome is not retried",
        [
          "calendar",
          "create",
          "--title",
          "S10 Unknown Create",
          "--start-time",
          "2026-08-20T10:00:00+08:00",
          "--timeout",
          "1s",
          "--json",
        ],
        {
          exitCode: 8,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "TIMEOUT");
            assert.equal(envelope.error.retryable, false);
            assert.equal(envelope.error.outcome, "unknown");
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge calendar search 'S10 Unknown Create' --json",
            );
          },
        },
        {
          SHARGE_BASE_URL: runtimeBaseUrl,
          SHARGE_API_KEY: timeoutApiKey,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );
    cases.push(
      await assertCase(
        "Calendar all-update unknown outcome uses replacement title",
        [
          "calendar",
          "update",
          replacementEventId,
          "--input",
          JSON.stringify({
            ...eventInput,
            title: "S10 Unknown Replacement",
            action: "all",
            instance_id: null,
          }),
          "--timeout",
          "1s",
          "--json",
        ],
        {
          exitCode: 8,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "TIMEOUT");
            assert.equal(envelope.error.retryable, false);
            assert.equal(envelope.error.outcome, "unknown");
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge calendar search 'S10 Unknown Replacement' --json",
            );
          },
        },
        {
          SHARGE_BASE_URL: runtimeBaseUrl,
          SHARGE_API_KEY: timeoutApiKey,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );
    const counts = await (
      await fetch(`${runtimeBaseUrl}/__e2e__/counts`)
    ).json();
    assert.equal(counts.timeout, 2, "each write timeout must be sent once");

    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    for (const privateValue of [
      apiKey,
      timeoutApiKey,
      eventInput.description,
      recurringInput.location,
      "S10 Project Review",
      "S10 Project Review Updated",
      "S10 Release Todo",
      "S10 Daily Sync",
      "S10 Single Instance",
      "S10 Future Series",
      "S10 Unknown Create",
      "S10 Unknown Replacement",
    ]) {
      assert(
        !logContents.includes(privateValue),
        `persistent logs leaked S10 private value: ${privateValue}`,
      );
    }
    await unlink(eventInputPath);
  }

  if (includesSlice("S11")) {
    await prepareSliceHome();
    const runtimeBaseUrl = runtimeStatus.urls.web;
    const apiKey = `lms-s11-${randomUUID().replaceAll("-", "")}`;
    const timeoutApiKey = "lms-e2e-fault-timeout";
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
    const timeoutHash = createHash("sha256")
      .update(timeoutApiKey)
      .digest("hex");
    const scopes = JSON.stringify(["calendar:read", "calendar:write"]);
    const seedSql = [
      "INSERT IGNORE INTO ai_open_api_keys",
      "(user_id,name,key_prefix,key_hash,expires_at,last_used_at,is_active,created_at,updated_at,scopes,creation_source,client_id,installation_id,client_info)",
      `VALUES ('cli-s11-user','CLI S11','${apiKey.slice(0, 12)}','${apiKeyHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${scopes}','manual','sharge-cli','install_s11','{}'),`,
      `('cli-s11-user','CLI S11 timeout','${timeoutApiKey.slice(0, 12)}','${timeoutHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${scopes}','manual','sharge-cli','install_s11_timeout','{}');`,
    ].join(" ");
    await runLifecycle(["mysql", "--id", runtimeId, "--", "-e", seedSql]);

    const realEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: apiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };
    const createCalendarItem = async (name, input) => {
      const created = await assertCase(
        name,
        ["calendar", "create", "--input", JSON.stringify(input), "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.title, input.title);
            assert.equal(data.type, input.type);
          },
        },
        realEnv,
      );
      cases.push(created);
      return String(JSON.parse(created.stdout).data.id);
    };
    const eventInput = (title, day, rrule = null) => ({
      title,
      description: `${title} private description`,
      location: "S11 private room",
      timezone: "Asia/Shanghai",
      type: "event",
      start_time: `2026-09-${day}T09:00:00+08:00`,
      end_time: `2026-09-${day}T09:30:00+08:00`,
      is_all_day: false,
      rrule,
      enable_alarm: false,
      trigger_seconds: 0,
      trigger_description: null,
    });
    const todoInput = (title, day) => ({
      title,
      description: `${title} private description`,
      location: null,
      timezone: "Asia/Shanghai",
      type: "todo",
      start_time: `2026-09-${day}T15:00:00+08:00`,
      end_time: null,
      is_all_day: false,
      rrule: null,
      enable_alarm: false,
      trigger_seconds: 0,
      trigger_description: null,
    });

    cases.push(
      await assertCase(
        "Calendar delete JSON help exposes destructive contract",
        ["calendar", "delete", "--help", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.command, "calendar.delete");
            assert.equal(data.destructive, true);
            assert.equal(data.dryRun, true);
            assert.equal(data.retrySafe, false);
            assert.deepEqual(data.requiredScopes, ["calendar:write"]);
          },
        },
        realEnv,
      ),
    );
    cases.push(
      await assertCase(
        "Calendar todo status JSON help exposes product input",
        ["calendar", "todos", "set-status", "--help", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.command, "calendar.todos.set-status");
            assert.deepEqual(data.inputSchema.required, [
              "event_ids",
              "status",
            ]);
            assert.equal(data.inputSchema.additionalProperties, false);
            assert.equal(data.retrySafe, false);
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "Calendar delete dry-run needs no credential or confirmation",
        [
          "calendar",
          "delete",
          "9000001",
          "--type",
          "future",
          "--instance-id",
          "opaque/value:+_",
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.method, "DELETE");
            assert.equal(
              data.path,
              "/open-api/v1/ai-calendar/events/9000001?type=future&instance_id=opaque%2Fvalue%3A%2B_",
            );
            assert.equal(data.retrySafe, false);
          },
        },
        {
          SHARGE_BASE_URL: sentinelBaseUrl,
          SHARGE_API_KEY: null,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );
    cases.push(
      await assertCase(
        "Calendar real delete fast-fails without --yes",
        ["calendar", "delete", "9000001", "--json"],
        {
          exitCode: 2,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.field, "--yes");
            assert.equal(envelope.meta.requestId, null);
          },
        },
        {
          SHARGE_BASE_URL: sentinelBaseUrl,
          SHARGE_API_KEY: null,
        },
      ),
    );
    for (const [name, args] of [
      [
        "Calendar current delete requires instance ID",
        ["calendar", "delete", "9000001", "--type", "current", "--dry-run"],
      ],
      [
        "Calendar future delete requires instance ID",
        ["calendar", "delete", "9000001", "--type", "future", "--dry-run"],
      ],
      [
        "Calendar all delete rejects instance ID",
        [
          "calendar",
          "delete",
          "9000001",
          "--type",
          "all",
          "--instance-id",
          "opaque",
          "--dry-run",
        ],
      ],
    ]) {
      cases.push(
        await assertCase(
          name,
          [...args, "--json"],
          {
            exitCode: 2,
            assert(result) {
              const envelope = JSON.parse(result.stdout);
              assert.equal(envelope.error.field, "--instance-id");
              assert.equal(envelope.meta.requestId, null);
            },
          },
          {
            SHARGE_BASE_URL: sentinelBaseUrl,
            SHARGE_API_KEY: null,
          },
        ),
      );
    }

    const allEventId = await createCalendarItem(
      "seed Calendar event for all delete",
      eventInput("S11 Delete All", "01"),
    );
    cases.push(
      await assertCase(
        "real Calendar all delete",
        ["calendar", "delete", allEventId, "--yes", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.action, "all");
            assert.equal(String(data.deleted_events[0].id), allEventId);
          },
        },
        realEnv,
      ),
    );
    cases.push(
      await assertCase(
        "public get confirms all delete",
        ["calendar", "get", allEventId, "--json"],
        {
          exitCode: 5,
          assert(result) {
            assert.equal(JSON.parse(result.stdout).error.type, "NOT_FOUND");
          },
        },
        realEnv,
      ),
    );

    const currentEventId = await createCalendarItem(
      "seed recurring event for current delete",
      eventInput("S11 Delete Current", "03", "FREQ=DAILY;COUNT=5"),
    );
    const currentRangeArgs = [
      "calendar",
      "list",
      "--start",
      "2026-09-03T00:00:00+08:00",
      "--end",
      "2026-09-09T00:00:00+08:00",
      "--json",
    ];
    const beforeCurrent = await assertCase(
      "public list provides current opaque instance",
      currentRangeArgs,
      {
        exitCode: 0,
        assert(result) {
          const instances = JSON.parse(result.stdout).data.instances.filter(
            (instance) => String(instance.event_id) === currentEventId,
          );
          assert.equal(instances.length, 5);
          assert(instances.every((instance) => instance.instance_id));
        },
      },
      realEnv,
    );
    cases.push(beforeCurrent);
    const currentInstances = JSON.parse(beforeCurrent.stdout)
      .data.instances.filter(
        (instance) => String(instance.event_id) === currentEventId,
      )
      .sort((left, right) =>
        left.original_start_time.localeCompare(right.original_start_time),
      );
    const removedCurrent = currentInstances[2];
    assert(removedCurrent, "current delete target required");
    cases.push(
      await assertCase(
        "real Calendar current instance delete",
        [
          "calendar",
          "delete",
          currentEventId,
          "--type",
          "current",
          "--instance-id",
          removedCurrent.instance_id,
          "--yes",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.action, "instance");
            assert.equal(String(data.updated_events[0].id), currentEventId);
          },
        },
        realEnv,
      ),
    );
    cases.push(
      await assertCase(
        "public list confirms only current instance removed",
        currentRangeArgs,
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            const event = data.events.find(
              (candidate) => String(candidate.id) === currentEventId,
            );
            assert(event, "recurring event must remain");
            assert.equal(event.excluded_dates.length, 1);
            const activeInstances = data.instances.filter(
              (instance) =>
                String(instance.event_id) === currentEventId &&
                !instance.is_cancelled,
            );
            assert.equal(activeInstances.length, 4);
            assert(
              !activeInstances.some(
                (instance) =>
                  instance.instance_id === removedCurrent.instance_id,
              ),
            );
          },
        },
        realEnv,
      ),
    );

    const futureEventId = await createCalendarItem(
      "seed recurring event for future delete",
      eventInput("S11 Delete Future", "10", "FREQ=DAILY;COUNT=6"),
    );
    const futureRangeArgs = [
      "calendar",
      "list",
      "--start",
      "2026-09-10T00:00:00+08:00",
      "--end",
      "2026-09-18T00:00:00+08:00",
      "--json",
    ];
    const beforeFuture = await assertCase(
      "public list provides future opaque instance",
      futureRangeArgs,
      {
        exitCode: 0,
        assert(result) {
          const instances = JSON.parse(result.stdout).data.instances.filter(
            (instance) => String(instance.event_id) === futureEventId,
          );
          assert.equal(instances.length, 6);
        },
      },
      realEnv,
    );
    cases.push(beforeFuture);
    const futureInstances = JSON.parse(beforeFuture.stdout)
      .data.instances.filter(
        (instance) => String(instance.event_id) === futureEventId,
      )
      .sort((left, right) =>
        left.original_start_time.localeCompare(right.original_start_time),
      );
    const removedFuture = futureInstances[3];
    assert(removedFuture, "future delete target required");
    cases.push(
      await assertCase(
        "real Calendar future instances delete",
        [
          "calendar",
          "delete",
          futureEventId,
          "--type",
          "future",
          "--instance-id",
          removedFuture.instance_id,
          "--yes",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.action, "future");
            assert.equal(String(data.updated_events[0].id), futureEventId);
            assert.match(data.updated_events[0].rrule, /UNTIL=/);
          },
        },
        realEnv,
      ),
    );
    cases.push(
      await assertCase(
        "public list confirms future range removed",
        futureRangeArgs,
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            const event = data.events.find(
              (candidate) => String(candidate.id) === futureEventId,
            );
            assert(event, "truncated recurring event must remain");
            assert.match(event.rrule, /UNTIL=/);
            const remaining = data.instances
              .filter(
                (instance) =>
                  String(instance.event_id) === futureEventId &&
                  !instance.is_cancelled,
              )
              .sort((left, right) =>
                left.original_start_time.localeCompare(
                  right.original_start_time,
                ),
              );
            assert.equal(remaining.length, 3);
            assert(
              remaining.every(
                (instance) =>
                  instance.original_start_time <
                  removedFuture.original_start_time,
              ),
            );
          },
        },
        realEnv,
      ),
    );

    const todoOneId = await createCalendarItem(
      "seed first Calendar todo",
      todoInput("S11 Todo Alpha", "20"),
    );
    const todoTwoId = await createCalendarItem(
      "seed second Calendar todo",
      todoInput("S11 Todo Beta", "21"),
    );
    cases.push(
      await assertCase(
        "real Calendar todo batch completed from flags",
        [
          "calendar",
          "todos",
          "set-status",
          "--event-id",
          todoOneId,
          "--event-id",
          todoOneId,
          "--event-id",
          todoTwoId,
          "--status",
          "completed",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.deepEqual(data.completed_ids.map(String), [
              todoOneId,
              todoTwoId,
            ]);
            assert.deepEqual(data.uncompleted_ids, []);
          },
        },
        realEnv,
      ),
    );
    for (const [name, todoId] of [
      ["public get verifies first todo completed", todoOneId],
      ["public get verifies second todo completed", todoTwoId],
    ]) {
      cases.push(
        await assertCase(
          name,
          ["calendar", "get", todoId, "--json"],
          {
            exitCode: 0,
            assert(result) {
              assert.equal(JSON.parse(result.stdout).data.completed, true);
            },
          },
          realEnv,
        ),
      );
    }

    const todoStatusPath = resolve(isolatedCwd, "s11-todo-status.json");
    await writeFile(
      todoStatusPath,
      `${JSON.stringify({
        event_ids: [Number(todoOneId), Number(todoTwoId)],
        status: "uncompleted",
      })}\n`,
    );
    cases.push(
      await assertCase(
        "Calendar todo status file dry-run uses product model",
        [
          "calendar",
          "todos",
          "set-status",
          "--input",
          "@s11-todo-status.json",
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.deepEqual(data.body.completed_ids, []);
            assert.deepEqual(data.body.uncompleted_ids.map(String), [
              todoOneId,
              todoTwoId,
            ]);
          },
        },
        {
          SHARGE_BASE_URL: sentinelBaseUrl,
          SHARGE_API_KEY: null,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );
    cases.push(
      await assertCase(
        "real Calendar todo batch uncompleted from file",
        [
          "calendar",
          "todos",
          "set-status",
          "--input",
          "@s11-todo-status.json",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.deepEqual(data.completed_ids, []);
            assert.deepEqual(data.uncompleted_ids.map(String), [
              todoOneId,
              todoTwoId,
            ]);
          },
        },
        realEnv,
      ),
    );
    for (const [name, todoId] of [
      ["public get verifies first todo uncompleted", todoOneId],
      ["public get verifies second todo uncompleted", todoTwoId],
    ]) {
      cases.push(
        await assertCase(
          name,
          ["calendar", "get", todoId, "--json"],
          {
            exitCode: 0,
            assert(result) {
              assert.equal(JSON.parse(result.stdout).data.completed, false);
            },
          },
          realEnv,
        ),
      );
    }
    cases.push(
      await assertCase(
        "Calendar todo status rejects empty IDs before network",
        [
          "calendar",
          "todos",
          "set-status",
          "--input",
          '{"event_ids":[],"status":"completed"}',
          "--dry-run",
          "--json",
        ],
        {
          exitCode: 2,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.field, "--event-id");
            assert.equal(envelope.meta.requestId, null);
          },
        },
        {
          SHARGE_BASE_URL: sentinelBaseUrl,
          SHARGE_API_KEY: null,
        },
      ),
    );

    await runLifecycle(["stop", "--id", runtimeId, "web"]);
    await startOpenPlatformServer();
    await waitForUrl(`${runtimeBaseUrl}/open-api/v1/openapi.json`);
    cases.push(
      await assertCase(
        "Calendar delete unknown outcome is not retried",
        [
          "calendar",
          "delete",
          futureEventId,
          "--yes",
          "--timeout",
          "1s",
          "--json",
        ],
        {
          exitCode: 8,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "TIMEOUT");
            assert.equal(envelope.error.retryable, false);
            assert.equal(envelope.error.outcome, "unknown");
            assert.equal(
              envelope.error.nextActions[0].command,
              `sharge calendar get ${futureEventId} --json`,
            );
          },
        },
        {
          SHARGE_BASE_URL: runtimeBaseUrl,
          SHARGE_API_KEY: timeoutApiKey,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );
    cases.push(
      await assertCase(
        "Calendar todo status unknown outcome is not retried",
        [
          "calendar",
          "todos",
          "set-status",
          "--event-id",
          todoOneId,
          "--event-id",
          todoTwoId,
          "--status",
          "completed",
          "--timeout",
          "1s",
          "--json",
        ],
        {
          exitCode: 8,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "TIMEOUT");
            assert.equal(envelope.error.retryable, false);
            assert.equal(envelope.error.outcome, "unknown");
            assert.equal(
              envelope.error.nextActions[0].command,
              `for id in ${todoOneId} ${todoTwoId}; do sharge calendar get "$id" --json; done`,
            );
          },
        },
        {
          SHARGE_BASE_URL: runtimeBaseUrl,
          SHARGE_API_KEY: timeoutApiKey,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );
    const counts = await (
      await fetch(`${runtimeBaseUrl}/__e2e__/counts`)
    ).json();
    assert.equal(counts.timeout, 2, "each S11 write timeout must be sent once");

    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    for (const privateValue of [
      apiKey,
      timeoutApiKey,
      "S11 private room",
      "S11 Delete All",
      "S11 Delete Current",
      "S11 Delete Future",
      "S11 Todo Alpha",
      "S11 Todo Beta",
    ]) {
      assert(
        !logContents.includes(privateValue),
        `persistent logs leaked S11 private value: ${privateValue}`,
      );
    }
    await unlink(todoStatusPath);
  }

  if (includesSlice("S12")) {
    await prepareSliceHome();
    const runtimeBaseUrl = runtimeStatus.urls.web;
    const apiKey = `lms-s12-${randomUUID().replaceAll("-", "")}`;
    const limitedApiKey = `lms-s12-limited-${randomUUID().replaceAll("-", "")}`;
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
    const limitedHash = createHash("sha256")
      .update(limitedApiKey)
      .digest("hex");
    const scopes = JSON.stringify(["voicemaster:read"]);
    const seedKeysSql = [
      "INSERT INTO ai_open_api_keys",
      "(user_id,name,key_prefix,key_hash,expires_at,last_used_at,is_active,created_at,updated_at,scopes,creation_source,client_id,installation_id,client_info)",
      `VALUES ('cli-s12-user','CLI S12','${apiKey.slice(0, 12)}','${apiKeyHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${scopes}','manual','sharge-cli','install_s12','{}'),`,
      `('cli-s12-user','CLI S12 limited','${limitedApiKey.slice(0, 12)}','${limitedHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'[]','manual','sharge-cli','install_s12_limited','{}');`,
    ].join(" ");
    await runLifecycle(["mysql", "--id", runtimeId, "--", "-e", seedKeysSql]);

    const seedRecordings = `
from datetime import datetime, timezone
from db import DASH_VECTOR_DIMENSION, get_vector_client
from pymilvus import Collection
from rds import Session
from tables import VoicemasterMessage
from util import config

def moment(day, hour):
    return datetime(2026, 7, day, hour, 0, tzinfo=timezone.utc)

def overview(title, summary, template):
    return {
        "zh": {
            "title": title,
            "abstract_text": title + " abstract",
            "duration": 750,
            "summary": {
                template: summary,
                "custom_dynamic_key": title + " dynamic summary",
            },
            "keywords": ["S12", "recording"],
            "mind_map": "mindmap " + title,
            "chapter_overview": [
                {"start_time": 0, "chapter_title": "开始", "content": "章节内容"}
            ],
            "has_calendar": True,
        }
    }

rows = [
    {
        "id": 12001,
        "user_id": "cli-s12-user",
        "voice_id": "s12-ordinary",
        "recording_type": "ordinary",
        "created": moment(29, 1),
        "title": "S12 项目复盘",
        "summary": "S12 项目复盘 唯一搜索词",
        "template": "meeting",
        "location": "S12 Room",
    },
    {
        "id": 12002,
        "user_id": "cli-s12-user",
        "voice_id": "s12-call",
        "recording_type": "call",
        "created": moment(30, 2),
        "title": "S12 客户通话",
        "summary": "S12 客户通话摘要",
        "template": "call",
        "location": "S12 Call",
    },
    {
        "id": 12003,
        "user_id": "cli-s12-user",
        "voice_id": "s12-app",
        "recording_type": "app_related",
        "created": moment(31, 3),
        "title": "S12 应用录音",
        "summary": "S12 应用录音摘要",
        "template": "app",
        "location": "S12 App",
    },
    {
        "id": 12004,
        "user_id": "cli-s12-other",
        "voice_id": "s12-other",
        "recording_type": "ordinary",
        "created": moment(30, 4),
        "title": "S12 跨用户录音",
        "summary": "S12 跨用户私密摘要",
        "template": "meeting",
        "location": "S12 Other",
    },
    {
        "id": 12005,
        "user_id": "cli-s12-user",
        "voice_id": "s12-filter-fallback",
        "recording_type": "ordinary",
        "created": moment(31, 5),
        "title": "S12 Wrong Filter",
        "summary": "S12 Wrong Filter 唯一搜索词",
        "template": "call",
        "language": "en",
        "location": "S12 Filter",
    },
]

with Session() as session:
    for row in rows:
        created = row["created"]
        session.add(VoicemasterMessage(
            id=row["id"],
            user_id=row["user_id"],
            content=[{"type": "text", "text": row["title"] + " 完整转写"}],
            location=row["location"],
            timestamp=int(created.timestamp()),
            voice_id=row["voice_id"],
            chat=[],
            history=[{
                "start_time": 0,
                "end_time": 2.5,
                "speaker": "speaker_1",
                "content": {"type": "text", "text": row["title"] + " 第一段"},
            }],
            overview={
                row.get("language", "zh"): overview(
                    row["title"],
                    row["summary"],
                    row["template"],
                )["zh"]
            },
            voice_url="https://media.example.invalid/" + row["voice_id"] + ".m4a",
            status_code=0,
            evaluate_time=int(created.timestamp()) + 60,
            recording_type=row["recording_type"],
            extra={
                "speaker_map": {
                    "speaker_1": {"sid": "speaker_1", "name": "S12 Speaker"},
                    "dynamic_speaker": {"sid": "speaker_2", "name": "S12 Agent"},
                },
                "highlights": [{
                    "at_ms": 1000,
                    "duration_ms": 500,
                    "text": row["title"] + " 高光",
                    "ref_media": {"type": "audio", "path": "private/path"},
                }],
            },
            long_content=None,
            created_at=created,
            updated_at=created,
        ))
    session.commit()

collection_name = config["voicemaster"]["rag_collection_name"]
assert get_vector_client().create_rag_collection_with_partitions(collection_name)
collection = Collection(collection_name)
collection.insert([
    {
        "message_id": str(row["id"]),
        "text": row["summary"],
        "vector": [0.0] * DASH_VECTOR_DIMENSION,
        "user_id": row["user_id"],
        "title": row["title"],
        "date": row["created"].date().isoformat(),
        "time": row["created"].time().isoformat(),
        "location": row["location"],
        "summary_template_id": row["template"],
        "language": row.get("language", "zh"),
    }
    for row in rows
])
collection.flush()
`;
    await runLifecycle([
      "exec",
      "--id",
      runtimeId,
      "--",
      "uv",
      "run",
      "--no-sync",
      "python",
      "-c",
      seedRecordings,
    ]);

    await runLifecycle(["stop", "--id", runtimeId, "web"]);
    await startOpenPlatformServer();
    await waitForUrl(`${runtimeBaseUrl}/open-api/v1/openapi.json`);

    const realEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: apiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };
    cases.push(
      await assertCase(
        "Recordings list JSON help",
        ["recordings", "list", "--help", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.command, "recordings.list");
            assert.deepEqual(data.requiredScopes, ["voicemaster:read"]);
            assert.equal(data.pagination.automatic, false);
            assert.equal(data.retrySafe, true);
            assert.deepEqual(data.sideEffects, []);
          },
        },
        realEnv,
      ),
    );

    const firstPage = await assertCase(
      "real Recordings one-item first page",
      [
        "recordings",
        "list",
        "--page-size",
        "1",
        "--sort-by",
        "id",
        "--sort-order",
        "asc",
        "--json",
      ],
      {
        exitCode: 0,
        assert(result) {
          const data = JSON.parse(result.stdout).data;
          assert.equal(data.items.length, 1);
          assert.equal(String(data.items[0].recording_id), "12001");
          assert.equal(data.has_more, true);
          assert(data.next_cursor);
        },
      },
      realEnv,
    );
    cases.push(firstPage);
    const nextCursor = String(JSON.parse(firstPage.stdout).data.next_cursor);
    const secondPage = await assertCase(
      "real Recordings cursor reads only the next page",
      [
        "recordings",
        "list",
        "--cursor",
        nextCursor,
        "--page-size",
        "1",
        "--direction",
        "forward",
        "--sort-by",
        "id",
        "--sort-order",
        "asc",
        "--json",
      ],
      {
        exitCode: 0,
        assert(result) {
          const data = JSON.parse(result.stdout).data;
          assert.equal(data.items.length, 1);
          assert.equal(String(data.items[0].recording_id), "12002");
        },
      },
      realEnv,
    );
    cases.push(secondPage);
    const previousCursor = String(
      JSON.parse(secondPage.stdout).data.prev_cursor,
    );
    cases.push(
      await assertCase(
        "real Recordings prev cursor reads the previous page",
        [
          "recordings",
          "list",
          "--cursor",
          previousCursor,
          "--page-size",
          "1",
          "--direction",
          "backward",
          "--sort-by",
          "id",
          "--sort-order",
          "asc",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.items.length, 1);
            assert.equal(String(data.items[0].recording_id), "12001");
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Recordings date and call type filter",
        [
          "recordings",
          "list",
          "--start-date",
          "2026-07-30",
          "--end-date",
          "2026-07-30",
          "--recording-type",
          "call",
          "--timezone",
          "Asia/Shanghai",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.deepEqual(
              data.items.map((item) => String(item.recording_id)),
              ["12002"],
            );
            assert.equal(data.items[0].recording_type, "call");
          },
        },
        realEnv,
      ),
    );
    cases.push(
      await assertCase(
        "real Recordings app-related filter",
        ["recordings", "list", "--recording-type", "app_related", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.deepEqual(
              data.items.map((item) => String(item.recording_id)),
              ["12003"],
            );
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Recordings keyword search with language and template",
        [
          "recordings",
          "search",
          "唯一搜索词",
          "--limit",
          "5",
          "--recording-type",
          "ordinary",
          "--language",
          "zh",
          "--summary-template-id",
          "meeting",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.length, 1);
            assert.equal(String(data[0].recording_id), "12001");
            assert.equal(data[0].language, "zh");
            assert.equal(data[0].summary_template_id, "meeting");
            assert.deepEqual(data[0].matched_fields, ["summary"]);
            assert.equal(
              data[0].matched_texts.summary,
              "S12 项目复盘 唯一搜索词",
            );
          },
        },
        realEnv,
        { timeoutMs: 15_000 },
      ),
    );

    cases.push(
      await assertCase(
        "real Recordings rich detail",
        ["recordings", "get", "12001", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.recording_type, "ordinary");
            assert.equal(data.transcript.text, "S12 项目复盘 完整转写");
            assert.equal(data.transcript.segments[0].speaker, "speaker_1");
            assert.equal(
              data.overviews.zh.summaries.custom_dynamic_key,
              "S12 项目复盘 dynamic summary",
            );
            assert.equal(data.speaker_map.dynamic_speaker.name, "S12 Agent");
            assert.deepEqual(data.highlights, [
              {
                at_ms: 1000,
                duration_ms: 500,
                text: "S12 项目复盘 高光",
                media_type: "audio",
              },
            ]);
            assert(!JSON.stringify(data.highlights).includes("private/path"));
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "Recordings cross-user get is hidden as 404",
        ["recordings", "get", "12004", "--json"],
        {
          exitCode: 5,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "NOT_FOUND");
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge recordings list --json",
            );
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "Recordings missing scope returns complete recovery",
        ["recordings", "list", "--json"],
        {
          exitCode: 4,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "SCOPE_REQUIRED");
            assert.deepEqual(envelope.error.requiredScopes, [
              "voicemaster:read",
            ]);
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge login --scope voicemaster:read",
            );
          },
        },
        {
          SHARGE_BASE_URL: runtimeBaseUrl,
          SHARGE_API_KEY: limitedApiKey,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );

    cases.push(
      await assertCase(
        "Recordings invalid date fast-fails before network",
        ["recordings", "list", "--start-date", "2026-02-30", "--json"],
        {
          exitCode: 2,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.field, "--start-date");
            assert.equal(envelope.meta.requestId, null);
          },
        },
        {
          SHARGE_BASE_URL: sentinelBaseUrl,
          SHARGE_API_KEY: null,
        },
      ),
    );
    for (const command of [
      "create",
      "update",
      "delete",
      "retry",
      "transcribe",
    ]) {
      cases.push(
        await assertCase(
          `Recordings ${command} is not a public command`,
          ["recordings", command, "--json"],
          {
            exitCode: 2,
            assert(result) {
              const envelope = JSON.parse(result.stdout);
              assert.equal(envelope.error.type, "INVALID_INPUT");
              assert.equal(envelope.meta.requestId, null);
            },
          },
          {
            SHARGE_BASE_URL: sentinelBaseUrl,
            SHARGE_API_KEY: null,
          },
        ),
      );
    }

    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    for (const privateValue of [
      apiKey,
      limitedApiKey,
      "S12 项目复盘",
      "S12 项目复盘 唯一搜索词",
      "S12 Speaker",
      "S12 Agent",
      "S12 跨用户私密摘要",
    ]) {
      assert(
        !logContents.includes(privateValue),
        `persistent logs leaked S12 private value: ${privateValue}`,
      );
    }
  }

  if (includesSlice("S13")) {
    await prepareSliceHome();
    const runtimeBaseUrl = runtimeStatus.urls.web;
    const apiKey = `lms-s13-${randomUUID().replaceAll("-", "")}`;
    const limitedApiKey = `lms-s13-limited-${randomUUID().replaceAll("-", "")}`;
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
    const limitedHash = createHash("sha256")
      .update(limitedApiKey)
      .digest("hex");
    const scopes = JSON.stringify(["voicemaster:read"]);
    const seedKeysSql = [
      "INSERT INTO ai_open_api_keys",
      "(user_id,name,key_prefix,key_hash,expires_at,last_used_at,is_active,created_at,updated_at,scopes,creation_source,client_id,installation_id,client_info)",
      `VALUES ('cli-s13-user','CLI S13','${apiKey.slice(0, 12)}','${apiKeyHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${scopes}','manual','sharge-cli','install_s13','{}'),`,
      `('cli-s13-user','CLI S13 limited','${limitedApiKey.slice(0, 12)}','${limitedHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'[]','manual','sharge-cli','install_s13_limited','{}');`,
    ].join(" ");
    await runLifecycle(["mysql", "--id", runtimeId, "--", "-e", seedKeysSql]);

    const crossOriginMediaUrl = await startDownloadMediaServer();
    const seedRecordings = `
from datetime import datetime, timezone
from rds import Session
from tables import VoicemasterMessage

def recording(recording_id, user_id, filename, title):
    created = datetime(2026, 7, 31, recording_id % 12, tzinfo=timezone.utc)
    return VoicemasterMessage(
        id=recording_id,
        user_id=user_id,
        content=[{"type": "text", "text": title}],
        location="S13 Room",
        timestamp=int(created.timestamp()),
        voice_id="s13-" + str(recording_id),
        chat=[],
        history=[],
        overview={"zh": {"title": title, "summary": {"default": title}}},
        voice_url=${JSON.stringify(crossOriginMediaUrl)} + "/media/" + filename if filename else "",
        status_code=0,
        evaluate_time=int(created.timestamp()),
        recording_type="ordinary",
        extra={},
        long_content=None,
        created_at=created,
        updated_at=created,
    )

with Session() as session:
    session.add_all([
        recording(13001, "cli-s13-user", "recording-seed.m4a", "S13 Download"),
        recording(13002, "cli-s13-user", "partial-recording.m4a", "S13 Partial"),
        recording(13003, "cli-s13-user", "", "S13 Missing"),
        recording(13004, "cli-s13-other", "recording-seed.m4a", "S13 Other"),
    ])
    session.commit()
`;
    await runLifecycle([
      "exec",
      "--id",
      runtimeId,
      "--",
      "uv",
      "run",
      "--no-sync",
      "python",
      "-c",
      seedRecordings,
    ]);

    await runLifecycle(["stop", "--id", runtimeId, "web"]);
    await startOpenPlatformServer(crossOriginMediaUrl);
    await waitForUrl(`${runtimeBaseUrl}/open-api/v1/openapi.json`);

    const realEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: apiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };
    const media = Buffer.from("s13-seed-audio-content");
    const mediaSha256 = createHash("sha256").update(media).digest("hex");
    const defaultPath = resolve(canonicalCwd, "recording-seed.m4a");
    const conflictPath = resolve(canonicalCwd, "recording-seed-1.m4a");
    const explicitPath = resolve(canonicalCwd, "explicit-recording.m4a");

    cases.push(
      await assertCase(
        "Recordings download JSON help",
        ["recordings", "download", "--help", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.command, "recordings.download");
            assert.deepEqual(data.requiredScopes, ["voicemaster:read"]);
            assert.deepEqual(data.sideEffects, ["write_download_file"]);
            assert.equal(data.dryRun, true);
            assert.equal(data.timeout, 600_000);
            assert(data.errors.includes("FILE_EXISTS"));
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "Recordings download dry run is offline",
        ["recordings", "download", "13001", "--dry-run", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(
              envelope.data.filePath,
              resolve(canonicalCwd, "recording-13001.m4a"),
            );
            assert.deepEqual(envelope.data.requiredScopes, [
              "voicemaster:read",
            ]);
          },
        },
        {
          SHARGE_BASE_URL: sentinelBaseUrl,
          SHARGE_API_KEY: null,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );

    cases.push(
      await assertCase(
        "real Recording default audio download",
        ["recordings", "download", "13001", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.deepEqual(envelope.data, {
              filePath: defaultPath,
              bytes: media.byteLength,
              mediaType: "audio/mp4",
              sha256: mediaSha256,
            });
            assert(envelope.meta.requestId);
          },
        },
        realEnv,
      ),
    );
    assert.deepEqual(await readFile(defaultPath), media);

    cases.push(
      await assertCase(
        "real Recording duplicate chooses a suffix",
        ["recordings", "download", "13001", "--json"],
        {
          exitCode: 0,
          assert(result) {
            assert.equal(JSON.parse(result.stdout).data.filePath, conflictPath);
          },
        },
        realEnv,
      ),
    );
    assert.deepEqual(await readFile(conflictPath), media);

    await writeFile(explicitPath, "preserve-me");
    const requestsBeforeConflict = downloadMediaHeaders.length;
    cases.push(
      await assertCase(
        "Recording explicit existing target fast fails",
        [
          "recordings",
          "download",
          "13001",
          "--file",
          "./explicit-recording.m4a",
          "--json",
        ],
        {
          exitCode: 2,
          assert(result) {
            assert.equal(JSON.parse(result.stdout).error.type, "FILE_EXISTS");
          },
        },
        realEnv,
      ),
    );
    assert.equal(downloadMediaHeaders.length, requestsBeforeConflict);
    assert.equal(await readFile(explicitPath, "utf8"), "preserve-me");

    cases.push(
      await assertCase(
        "real Recording explicit overwrite",
        [
          "recordings",
          "download",
          "13001",
          "--file",
          "./explicit-recording.m4a",
          "--overwrite",
          "--json",
        ],
        {
          exitCode: 0,
          assert(result) {
            assert.equal(JSON.parse(result.stdout).data.filePath, explicitPath);
          },
        },
        realEnv,
      ),
    );
    assert.deepEqual(await readFile(explicitPath), media);

    cases.push(
      await assertCase(
        "unavailable Recording audio is 404",
        ["recordings", "download", "13003", "--json"],
        {
          exitCode: 5,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "NOT_FOUND");
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge recordings get 13003 --json",
            );
          },
        },
        realEnv,
      ),
    );
    cases.push(
      await assertCase(
        "cross-user Recording audio is 404",
        ["recordings", "download", "13004", "--json"],
        {
          exitCode: 5,
          assert(result) {
            assert.equal(JSON.parse(result.stdout).error.type, "NOT_FOUND");
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "incomplete Recording download cleans all files",
        ["recordings", "download", "13002", "--json"],
        {
          exitCode: 8,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "NETWORK_ERROR");
            assert.equal(envelope.error.retryable, true);
            assert.equal(envelope.meta.requestId, "req_runtime_e2e");
          },
        },
        realEnv,
      ),
    );
    assert(
      !(await readdir(isolatedCwd)).some(
        (name) =>
          name === "partial-recording.m4a" ||
          name.includes("partial-recording.m4a.sharge-"),
      ),
      "failed Recording download must clean reservation and temporary file",
    );

    cases.push(
      await assertCase(
        "Recording download missing scope returns complete recovery",
        ["recordings", "download", "13001", "--json"],
        {
          exitCode: 4,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "SCOPE_REQUIRED");
            assert.deepEqual(envelope.error.requiredScopes, [
              "voicemaster:read",
            ]);
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge login --scope voicemaster:read",
            );
          },
        },
        {
          SHARGE_BASE_URL: runtimeBaseUrl,
          SHARGE_API_KEY: limitedApiKey,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );

    assert(downloadMediaHeaders.length >= 4);
    assert(
      downloadMediaHeaders.every(
        (observation) => observation.authorization === null,
      ),
      "Recording redirect target must never receive Authorization",
    );
    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    for (const privateValue of [
      apiKey,
      limitedApiKey,
      crossOriginMediaUrl,
      "s13-seed-audio-content",
      "S13 Download",
      "S13 Partial",
    ]) {
      assert(
        !logContents.includes(privateValue),
        `persistent logs leaked S13 private value: ${privateValue}`,
      );
    }
    assert.match(logContents, /"path":"\[download-redirect\]"/);

    await Promise.all(
      [defaultPath, conflictPath, explicitPath].map((path) => unlink(path)),
    );
  }

  if (includesSlice("S14")) {
    await prepareSliceHome();
    const runtimeBaseUrl = runtimeStatus.urls.web;
    const apiKey = `lms-s14-${randomUUID().replaceAll("-", "")}`;
    const limitedApiKey = `lms-s14-limited-${randomUUID().replaceAll("-", "")}`;
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
    const limitedHash = createHash("sha256")
      .update(limitedApiKey)
      .digest("hex");
    const scopes = JSON.stringify(["ai_daily:read"]);
    const seedKeysSql = [
      "INSERT INTO ai_open_api_keys",
      "(user_id,name,key_prefix,key_hash,expires_at,last_used_at,is_active,created_at,updated_at,scopes,creation_source,client_id,installation_id,client_info)",
      `VALUES ('cli-s14-user','CLI S14','${apiKey.slice(0, 12)}','${apiKeyHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'${scopes}','manual','sharge-cli','install_s14','{}'),`,
      `('cli-s14-user','CLI S14 limited','${limitedApiKey.slice(0, 12)}','${limitedHash}',NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),'[]','manual','sharge-cli','install_s14_limited','{}');`,
    ].join(" ");
    await runLifecycle(["mysql", "--id", runtimeId, "--", "-e", seedKeysSql]);

    const seedDiary = `
from datetime import datetime, timezone
from rds import Session
from ai_daily._tables.ai_daily_report import AiDailyReport
from ai_daily._tables.ai_daily_report_document import AiDailyReportDocument

def report(report_id, user_id, report_type, identifier, title, markdown):
    created = datetime(2026, 7, 30, 4, tzinfo=timezone.utc)
    return AiDailyReport(
        id=report_id,
        user_id=user_id,
        report_type=report_type,
        identifier=identifier,
        timezone="Asia/Shanghai",
        period_start=datetime(2026, 7, 29, 16, tzinfo=timezone.utc),
        period_end=datetime(2026, 7, 30, 16, tzinfo=timezone.utc),
        planned_at=created,
        started_at=created,
        finished_at=created,
        status="success",
        retry_count=0,
        data={
            "aggregator_data": {
                "summary": title + " 摘要",
                "duration": 321.5,
                "daily_diary": {
                    "title": title,
                    "description": title + " 描述",
                    "markdown": markdown,
                    "word_count": len(markdown),
                    "generated_at": "2026-07-30T04:00:00+00:00",
                    "html_oss_key": "private/" + user_id + "/" + identifier + ".html",
                },
            },
        },
        metadata_json={"private": "S14 internal metadata"},
        created_at=created,
        updated_at=created,
    )

def document(report_id, user_id, identifier, title, body):
    created = datetime(2026, 7, 30, 4, tzinfo=timezone.utc)
    return AiDailyReportDocument(
        report_id=report_id,
        user_id=user_id,
        identifier=identifier,
        duration=321.5,
        extra={"city": "上海", "keywords": ["航海", "复盘"], "recording_count": 2},
        title=title,
        description=title + " 描述",
        cover_thumbnail_url=None,
        cover_large_url=None,
        diary_html_path="/private/diary/" + identifier,
        generated_at=created,
        body_text=body,
        created_at=created,
        updated_at=created,
    )

with Session() as session:
    session.add_all([
        report(14001, "cli-s14-user", "daily", "20260730", "S14 航海日记", "# S14 航海日记\\n\\n- 保留 Markdown"),
        report(14002, "cli-s14-user", "daily", "20260729", "S14 普通日记", "# S14 普通日记"),
        report(14003, "cli-s14-other", "daily", "20260728", "S14 跨用户日记", "# S14 跨用户私密正文"),
        report(14011, "cli-s14-user", "weekly", "2026W31", "S14 周报", "# S14 周报"),
        report(14012, "cli-s14-user", "monthly", "202607", "S14 月报", "# S14 月报"),
        document(14001, "cli-s14-user", "20260730", "S14 航海日记", "今天记录航行计划"),
        document(14002, "cli-s14-user", "20260729", "S14 普通日记", "今天处理普通事项"),
        document(14003, "cli-s14-other", "20260728", "S14 跨用户日记", "跨用户航行私密内容"),
    ])
    session.commit()
`;
    await runLifecycle([
      "exec",
      "--id",
      runtimeId,
      "--",
      "uv",
      "run",
      "--no-sync",
      "python",
      "-c",
      seedDiary,
    ]);

    await runLifecycle(["stop", "--id", runtimeId, "web"]);
    await startOpenPlatformServer();
    await waitForUrl(`${runtimeBaseUrl}/open-api/v1/openapi.json`);

    const realEnv = {
      SHARGE_BASE_URL: runtimeBaseUrl,
      SHARGE_API_KEY: apiKey,
      SHARGE_TIMEZONE: "Asia/Shanghai",
    };

    cases.push(
      await assertCase(
        "Diary JSON help describes daily-only list",
        ["diary", "list", "--help", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.command, "diary.list");
            assert.deepEqual(data.requiredScopes, ["ai_daily:read"]);
            assert.equal(data.arguments[0].name, "month");
            assert.equal(data.network, true);
            assert.equal(
              data.outputSchema.items.properties.identifier.pattern,
              "^\\d{8}$",
            );
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Diary monthly list only returns current user daily documents",
        ["diary", "list", "2026-07", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.deepEqual(
              envelope.data.map((item) => item.identifier),
              ["20260730", "20260729"],
            );
            assert.equal(envelope.data[0].title, "S14 航海日记");
            assert.equal(envelope.data[0].extra.city, "上海");
            assert(!result.stdout.includes("S14 周报"));
            assert(!result.stdout.includes("S14 月报"));
            assert(!result.stdout.includes("S14 跨用户日记"));
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Diary search stays within daily projection",
        ["diary", "search", "航", "--limit", "1", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.length, 1);
            assert.equal(data[0].identifier, "20260730");
            assert.deepEqual(data[0].matched_fields, ["title", "body"]);
            assert.match(data[0].matched_title, /<mark>航<\/mark>/);
            assert.match(data[0].matched_body_excerpt, /<mark>航<\/mark>/);
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "real Diary detail preserves daily Markdown",
        ["diary", "get", "20260730", "--json"],
        {
          exitCode: 0,
          assert(result) {
            const data = JSON.parse(result.stdout).data;
            assert.equal(data.report_type, "daily");
            assert.equal(data.identifier, "20260730");
            assert.equal(data.title, "S14 航海日记");
            assert.equal(data.markdown, "# S14 航海日记\n\n- 保留 Markdown");
            assert(!result.stdout.includes("html_oss_key"));
            assert(!result.stdout.includes("internal metadata"));
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "Diary cross-user detail is hidden as 404",
        ["diary", "get", "20260728", "--json"],
        {
          exitCode: 5,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "NOT_FOUND");
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge diary list 2026-07 --json",
            );
          },
        },
        realEnv,
      ),
    );

    cases.push(
      await assertCase(
        "Diary missing scope returns complete recovery",
        ["diary", "list", "2026-07", "--json"],
        {
          exitCode: 4,
          assert(result) {
            const envelope = JSON.parse(result.stdout);
            assert.equal(envelope.error.type, "SCOPE_REQUIRED");
            assert.deepEqual(envelope.error.requiredScopes, ["ai_daily:read"]);
            assert.equal(
              envelope.error.nextActions[0].command,
              "sharge login --scope ai_daily:read",
            );
          },
        },
        {
          SHARGE_BASE_URL: runtimeBaseUrl,
          SHARGE_API_KEY: limitedApiKey,
          SHARGE_TIMEZONE: "Asia/Shanghai",
        },
      ),
    );

    for (const [name, args, field] of [
      [
        "Diary rejects an impossible date locally",
        ["diary", "get", "20260230", "--json"],
        "identifier",
      ],
      [
        "Diary rejects an impossible month locally",
        ["diary", "list", "2026-13", "--json"],
        "month",
      ],
    ]) {
      cases.push(
        await assertCase(
          name,
          args,
          {
            exitCode: 2,
            assert(result) {
              const envelope = JSON.parse(result.stdout);
              assert.equal(envelope.error.field, field);
              assert.equal(envelope.meta.requestId, null);
            },
          },
          {
            SHARGE_BASE_URL: sentinelBaseUrl,
            SHARGE_API_KEY: null,
          },
        ),
      );
    }

    for (const command of [
      "weekly",
      "monthly",
      "generate",
      "retry",
      "settings",
    ]) {
      cases.push(
        await assertCase(
          `Diary ${command} is not a public command`,
          ["diary", command, "--json"],
          {
            exitCode: 2,
            assert(result) {
              const envelope = JSON.parse(result.stdout);
              assert.equal(envelope.error.type, "INVALID_INPUT");
              assert.equal(envelope.meta.requestId, null);
            },
          },
          {
            SHARGE_BASE_URL: sentinelBaseUrl,
            SHARGE_API_KEY: null,
          },
        ),
      );
    }
    for (const args of [
      ["diary", "get", "weekly", "2026W31", "--json"],
      ["diary", "get", "monthly", "202607", "--json"],
    ]) {
      cases.push(
        await assertCase(
          `Diary get does not accept a ${args[2]} selector`,
          args,
          {
            exitCode: 2,
            assert(result) {
              const envelope = JSON.parse(result.stdout);
              assert.equal(envelope.error.type, "INVALID_INPUT");
              assert.equal(envelope.meta.requestId, null);
            },
          },
          {
            SHARGE_BASE_URL: sentinelBaseUrl,
            SHARGE_API_KEY: null,
          },
        ),
      );
    }

    const logContents = await readFile(
      resolve(isolatedHome, ".sharge", "sharge.log"),
      "utf8",
    );
    for (const privateValue of [
      apiKey,
      limitedApiKey,
      "S14 航海日记",
      "S14 跨用户私密正文",
      "private/cli-s14-user",
    ]) {
      assert(
        !logContents.includes(privateValue),
        `persistent logs leaked S14 private value: ${privateValue}`,
      );
    }
  }

  if (includesSlice("S15")) {
    await prepareSliceHome();
    const packageWorkspace = await mkdtemp(resolve(isolatedCwd, "package-"));
    const noLoginPrefix = resolve(packageWorkspace, "prefix-no-login");
    const loginPrefix = resolve(packageWorkspace, "prefix-login");
    const noLoginHome = resolve(packageWorkspace, "home-no-login");
    const loginHome = resolve(packageWorkspace, "home-login");

    const packed = await runProcess(
      [
        "npm",
        "pack",
        "--silent",
        "--json",
        "--pack-destination",
        packageWorkspace,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, HOME: isolatedHome },
        timeoutMs: 120_000,
      },
    );
    assert.equal(packed.exitCode, 0, `npm pack failed: ${packed.stderr}`);
    const [manifest] = JSON.parse(packed.stdout);
    assert.deepEqual(
      manifest.files.map((file) => file.path),
      [
        "README.md",
        "dist/index.d.ts",
        "dist/index.js",
        "install.sh",
        "package.json",
      ],
    );
    assert.equal(
      manifest.files.find((file) => file.path === "dist/index.js").mode,
      493,
      "published bin must be executable",
    );
    assert.equal(
      manifest.files.find((file) => file.path === "install.sh").mode,
      493,
      "published installer must be executable",
    );
    const tarball = resolve(packageWorkspace, manifest.filename);

    const rejectedParameter = await runProcess(
      [resolve(repositoryRoot, "install.sh"), "--install-code", "forbidden"],
      {
        cwd: packageWorkspace,
        env: {
          ...process.env,
          HOME: noLoginHome,
          SHARGE_INSTALL_PREFIX: noLoginPrefix,
          SHARGE_INSTALL_PACKAGE: tarball,
        },
        timeoutMs: 5_000,
      },
    );
    assert.equal(rejectedParameter.exitCode, 2);
    assert.match(rejectedParameter.stderr, /不支持的安装器参数/);
    await assert.rejects(lstat(resolve(noLoginPrefix, "bin", "sharge")));

    const noLoginInstall = await runProcess(
      [resolve(repositoryRoot, "install.sh"), "--no-login"],
      {
        cwd: packageWorkspace,
        env: {
          ...process.env,
          HOME: noLoginHome,
          SHARGE_INSTALL_PREFIX: noLoginPrefix,
          SHARGE_INSTALL_PACKAGE: tarball,
        },
        timeoutMs: 120_000,
      },
    );
    assert.equal(
      noLoginInstall.exitCode,
      0,
      `--no-login install failed: ${noLoginInstall.stderr}`,
    );
    assert.match(noLoginInstall.stdout, /已按 --no-login 跳过登录/);
    const noLoginBinary = resolve(noLoginPrefix, "bin", "sharge");
    assert((await lstat(noLoginBinary)).mode & 0o111);
    const installedHelp = await runProcess([noLoginBinary, "--help"], {
      cwd: packageWorkspace,
      env: { ...process.env, HOME: noLoginHome },
      timeoutMs: 5_000,
    });
    assert.equal(installedHelp.exitCode, 0);
    assert.match(
      installedHelp.stdout,
      /面向 Agent 的 Sharge 开放平台命令行工具/,
    );
    const installedVersion = await runProcess([noLoginBinary, "version"], {
      cwd: packageWorkspace,
      env: { ...process.env, HOME: noLoginHome },
      timeoutMs: 5_000,
    });
    assert.equal(installedVersion.exitCode, 0);
    assert.equal(installedVersion.stdout.trim(), packageJson.version);

    const uninstallNoLogin = await runProcess(
      [
        "npm",
        "uninstall",
        "--global",
        "--prefix",
        noLoginPrefix,
        "@sharge/cli",
      ],
      {
        cwd: packageWorkspace,
        env: { ...process.env, HOME: noLoginHome },
        timeoutMs: 120_000,
      },
    );
    assert.equal(uninstallNoLogin.exitCode, 0);
    await assert.rejects(lstat(noLoginBinary));

    const defaultLoginInstall = await runProcess(
      [resolve(repositoryRoot, "install.sh")],
      {
        cwd: packageWorkspace,
        env: {
          ...process.env,
          HOME: loginHome,
          SHARGE_INSTALL_PREFIX: loginPrefix,
          SHARGE_INSTALL_PACKAGE: tarball,
          SHARGE_BASE_URL: "http://127.0.0.1:1",
          SHARGE_API_KEY: "",
        },
        timeoutMs: 120_000,
      },
    );
    assert.notEqual(
      defaultLoginInstall.exitCode,
      0,
      "default installer must propagate login failure",
    );
    assert.match(defaultLoginInstall.stderr, /sharge CLI 已安装但登录未完成/);
    const loginBinary = resolve(loginPrefix, "bin", "sharge");
    assert((await lstat(loginBinary)).mode & 0o111);
    const loginSettings = JSON.parse(
      await readFile(resolve(loginHome, ".sharge", "settings.json"), "utf8"),
    );
    assert.equal(loginSettings.schemaVersion, 1);
    assert.match(loginSettings.installationId, /^install_/);
    const loginLog = await readFile(
      resolve(loginHome, ".sharge", "sharge.log"),
      "utf8",
    );
    assert.match(loginLog, /"command":"login"/);
    assert.match(loginLog, /"errorType":"NETWORK_ERROR"/);
    const versionAfterLoginFailure = await runProcess(
      [loginBinary, "version", "--json"],
      {
        cwd: packageWorkspace,
        env: { ...process.env, HOME: loginHome },
        timeoutMs: 5_000,
      },
    );
    assert.equal(versionAfterLoginFailure.exitCode, 0);
    assert.equal(
      JSON.parse(versionAfterLoginFailure.stdout).data.version,
      packageJson.version,
    );

    const uninstallAfterFailure = await runProcess(
      ["npm", "uninstall", "--global", "--prefix", loginPrefix, "@sharge/cli"],
      {
        cwd: packageWorkspace,
        env: { ...process.env, HOME: loginHome },
        timeoutMs: 120_000,
      },
    );
    assert.equal(uninstallAfterFailure.exitCode, 0);
    await assert.rejects(lstat(loginBinary));
    const processes = await runProcess(["ps", "-axo", "command="], {
      cwd: packageWorkspace,
      timeoutMs: 5_000,
    });
    assert.equal(processes.exitCode, 0);
    for (const marker of [loginPrefix, loginHome]) {
      assert(
        !processes.stdout.includes(marker),
        `install/login/uninstall must not leave a process containing ${marker}`,
      );
    }
    await rm(packageWorkspace, { recursive: true, force: true });
  }

  assert.equal(
    networkConnections,
    0,
    "offline slice commands must make zero connections",
  );
  assert.deepEqual(
    await readdir(isolatedCwd),
    [],
    "CLI must not write into its working directory",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        slice: requestedSlice,
        runtimeId,
        isolatedHome,
        runtimeStatus,
        networkGuard: {
          baseUrl: sentinelBaseUrl,
          credential: "synthetic and intentionally unusable",
          connections: networkConnections,
        },
        cases,
      },
      null,
      2,
    )}\n`,
  );
  completed = true;
} catch (error) {
  reportFailureEvidence();
  throw error;
} finally {
  await cleanup(completed ? "success" : "failure");
}
