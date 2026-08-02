import { spawn } from "node:child_process";

export class ProcessTimeoutError extends Error {
  constructor(command, timeoutMs) {
    super(`进程在 ${timeoutMs}ms 内未结束：${command.join(" ")}`);
    this.name = "ProcessTimeoutError";
  }
}

export function mergeProcessOptions(options, defaults) {
  return {
    ...defaults,
    ...options,
  };
}

export function runProcess(command, options = {}) {
  const {
    cwd,
    env = process.env,
    timeoutMs = 15_000,
    stdin = "ignore",
  } = options;

  return new Promise((resolve, reject) => {
    const stdinContent = typeof stdin === "string" ? stdin : null;
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env,
      stdio: [stdinContent === null ? stdin : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    if (stdinContent !== null) {
      child.stdin.end(stdinContent);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new ProcessTimeoutError(command, timeoutMs));
        return;
      }
      resolve({
        exitCode: exitCode ?? 1,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

export function runBuiltCli(repositoryRoot, args, options = {}) {
  return runProcess(
    [process.execPath, `${repositoryRoot}/dist/index.js`, ...args],
    {
      ...options,
      cwd: options.cwd ?? repositoryRoot,
    },
  );
}
