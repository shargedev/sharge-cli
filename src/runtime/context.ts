import { spawn } from "node:child_process";
import { homedir, hostname } from "node:os";

export type NetworkLogEvent =
  | {
      event: "request";
      timestamp: string;
      method: string;
      path: string;
    }
  | {
      event: "response";
      timestamp: string;
      method: string;
      path: string;
      status: number;
      requestId: string | null;
      durationMs: number;
    }
  | {
      event: "network_error";
      timestamp: string;
      method: string;
      path: string;
      errorType: "NETWORK_ERROR" | "TIMEOUT";
      durationMs: number;
    };

export type CliRuntime = {
  env: Record<string, string | undefined>;
  homeDir: string;
  cwd: string;
  platform: NodeJS.Platform;
  deviceName?: string;
  openExternal?: (url: string) => Promise<boolean>;
  readStdin?: () => Promise<string>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  networkEvents?: NetworkLogEvent[];
};

export function browserCommand(
  platform: NodeJS.Platform,
  url: string,
): { file: string; arguments: string[] } {
  return platform === "darwin"
    ? { file: "open", arguments: [url] }
    : platform === "win32"
      ? { file: "explorer.exe", arguments: [url] }
      : { file: "xdg-open", arguments: [url] };
}

async function openExternal(
  platform: NodeJS.Platform,
  url: string,
): Promise<boolean> {
  const command = browserCommand(platform, url);
  return await new Promise<boolean>((resolve) => {
    const child = spawn(command.file, command.arguments, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

export async function readProcessStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk;
  }
  return value;
}

export function defaultCliRuntime(): CliRuntime {
  return {
    env: process.env,
    homeDir: homedir(),
    cwd: process.cwd(),
    platform: process.platform,
    deviceName: hostname(),
    openExternal: async (url) => await openExternal(process.platform, url),
    readStdin: readProcessStdin,
    sleep: async (milliseconds, signal) =>
      await new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("The operation was aborted", "AbortError"));
          return;
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, milliseconds);
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
      }),
    now: Date.now,
  };
}
