import { constants } from "node:fs";
import { lstat, open, rename, rm } from "node:fs/promises";
import packageJson from "../../package.json" with { type: "json" };
import { resolveConfig } from "./config.js";
import type { CliRuntime, NetworkLogEvent } from "./context.js";
import { hardenPermissions } from "./file-security.js";
import { loadOrCreateSettings } from "./settings.js";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const HISTORY_COUNT = 4;

async function regularFileSize(path: string): Promise<number | null> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`refusing unsafe log path: ${path}`);
    }
    return metadata.size;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function rotate(
  logPath: string,
  maxBytes: number,
  incomingBytes: number,
): Promise<void> {
  const size = await regularFileSize(logPath);
  if (size === null || size + incomingBytes <= maxBytes) {
    return;
  }

  const oldestPath = `${logPath}.${HISTORY_COUNT}`;
  if ((await regularFileSize(oldestPath)) !== null) {
    await rm(oldestPath);
  }
  for (let index = HISTORY_COUNT - 1; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`;
    if ((await regularFileSize(source)) !== null) {
      await rename(source, `${logPath}.${index + 1}`);
    }
  }
  await rename(logPath, `${logPath}.1`);
}

export async function appendInvocationLog(
  runtime: CliRuntime,
  event: {
    runId: string;
    command: string;
    startedAt?: string;
    optionNames?: string[];
    exitCode: number;
    errorType?: string;
    durationMs?: number;
    networkEvents?: NetworkLogEvent[];
  },
  options: { maxBytes?: number } = {},
): Promise<{ written: boolean; error?: Error }> {
  try {
    const store = await loadOrCreateSettings(runtime);
    const resolved = resolveConfig(runtime, store);
    const timestamp = event.startedAt ?? new Date().toISOString();
    const lines = [
      {
        timestamp,
        event: "start",
        runId: event.runId,
        cliVersion: packageJson.version,
        command: event.command,
        optionNames: event.optionNames ?? [],
        config: {
          baseUrl: resolved.baseUrl,
          credential: resolved.credential,
          timezone: resolved.timezone,
        },
      },
      ...(event.networkEvents ?? []).map((networkEvent) => ({
        ...networkEvent,
        runId: event.runId,
        command: event.command,
      })),
      {
        timestamp: new Date().toISOString(),
        event: event.errorType ? "error" : "end",
        runId: event.runId,
        command: event.command,
        exitCode: event.exitCode,
        ...(event.errorType ? { errorType: event.errorType } : {}),
        ...(event.durationMs !== undefined
          ? { durationMs: event.durationMs }
          : {}),
      },
    ];
    const line = `${lines.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    await rotate(
      store.logPath,
      options.maxBytes ?? DEFAULT_MAX_BYTES,
      Buffer.byteLength(line),
    );
    const noFollow = runtime.platform === "win32" ? 0 : constants.O_NOFOLLOW;
    const handle = await open(
      store.logPath,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | noFollow,
      0o600,
    );
    try {
      await handle.writeFile(line, "utf8");
    } finally {
      await handle.close();
    }
    await hardenPermissions(runtime, store.logPath, "file");
    return { written: true };
  } catch (error) {
    return {
      written: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
