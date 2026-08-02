import { createHash } from "node:crypto";
import packageJson from "../../package.json" with { type: "json" };
import type { CliRuntime } from "../runtime/context.js";
import {
  fallbackNoteDownloadFileName,
  reserveExplicitDownload,
  reserveGeneratedDownload,
  safeDownloadFileName,
  writeAllDownloadChunk,
} from "../runtime/download-files.js";
import { CliFailure } from "../runtime/errors.js";
import { apiResponseFailure, clientDate } from "./client.js";

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function cancellationFailure(helpCommand: string): CliFailure {
  return new CliFailure({
    type: "CANCELLED",
    exitCode: 130,
    message: "操作已由用户取消。",
    nextAction: {
      description: "需要时重新执行命令",
      command: helpCommand,
    },
  });
}

function downloadTransportFailure(
  error: unknown,
  helpCommand: string,
  requestId: string | null = null,
): CliFailure {
  const timeout = isTimeoutError(error);
  return new CliFailure({
    type: timeout ? "TIMEOUT" : "NETWORK_ERROR",
    exitCode: 8,
    retryable: true,
    message: timeout ? "下载请求超时。" : "无法完整接收下载响应。",
    requestId,
    nextAction: {
      description: "确认目标文件不存在后重新下载",
      command: helpCommand,
    },
  });
}

function downloadFileFailure(
  helpCommand: string,
  requestId: string | null,
): CliFailure {
  return new CliFailure({
    type: "FILE_IO_ERROR",
    exitCode: 1,
    retryable: false,
    message: "无法安全写入或发布下载文件。",
    requestId,
    nextAction: {
      description: "检查目标目录权限与可用空间后重新选择下载路径",
      command: helpCommand,
    },
  });
}

function throwDownloadBodyFailure(
  runtime: CliRuntime,
  error: unknown,
  startedAt: number,
  path: string,
  helpCommand: string,
  requestId: string | null,
): never {
  if (runtime.signal?.aborted) {
    throw cancellationFailure(helpCommand);
  }
  runtime.networkEvents?.push({
    event: "network_error",
    timestamp: new Date().toISOString(),
    method: "GET",
    path,
    errorType: isTimeoutError(error) ? "TIMEOUT" : "NETWORK_ERROR",
    durationMs: Math.round(performance.now() - startedAt),
  });
  throw downloadTransportFailure(error, helpCommand, requestId);
}

function redirectFailure(message: string): CliFailure {
  return new CliFailure({
    type: "SERVER_ERROR",
    exitCode: 8,
    retryable: false,
    message,
    nextAction: {
      description: "记录 requestId 并检查下载端点",
      command: "sharge doctor --json",
    },
  });
}

function redirectTarget(location: string, currentUrl: string): string {
  let target: URL;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw redirectFailure("下载端点返回了无效 redirect URL。");
  }
  if (
    (target.protocol !== "http:" && target.protocol !== "https:") ||
    target.username.length > 0 ||
    target.password.length > 0
  ) {
    throw redirectFailure(
      "下载 redirect 只允许没有 credential 的 HTTP(S) URL。",
    );
  }
  return target.toString();
}

export async function downloadMedia(
  runtime: CliRuntime,
  options: {
    baseUrl: string;
    apiKey: string;
    timezone: string;
    path: string;
    fallbackFileName: string;
    helpCommand: string;
    resourceRecoveryCommand: string;
    file?: string;
    overwrite: boolean;
    timeoutMs: number;
  },
) {
  const requestClientDate = clientDate(new Date(), options.timezone);
  const safePath = new URL(options.path, options.baseUrl).pathname;
  const startedAt = performance.now();
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = runtime.signal
    ? AbortSignal.any([runtime.signal, timeoutSignal])
    : timeoutSignal;
  let currentUrl = `${options.baseUrl}${options.path}`;
  let requestId: string | null = null;
  let contentDisposition: string | null = null;
  let response: Response | null = null;
  let followedRedirect = false;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const loggedPath = redirectCount === 0 ? safePath : "[download-redirect]";
    runtime.networkEvents?.push({
      event: "request",
      timestamp: new Date().toISOString(),
      method: "GET",
      path: loggedPath,
    });
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers:
          redirectCount === 0
            ? {
                Authorization: `Bearer ${options.apiKey}`,
                "X-Client-Date": requestClientDate,
                "User-Agent": `sharge-cli/${packageJson.version} (${runtime.platform}; Node ${process.version})`,
              }
            : {
                "User-Agent": `sharge-cli/${packageJson.version} (${runtime.platform}; Node ${process.version})`,
              },
        signal,
      });
    } catch (error) {
      if (runtime.signal?.aborted) {
        throw cancellationFailure(options.helpCommand);
      }
      runtime.networkEvents?.push({
        event: "network_error",
        timestamp: new Date().toISOString(),
        method: "GET",
        path: loggedPath,
        errorType: isTimeoutError(error) ? "TIMEOUT" : "NETWORK_ERROR",
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw downloadTransportFailure(error, options.helpCommand);
    }
    requestId ??= response.headers.get("x-request-id");
    contentDisposition ??= response.headers.get("content-disposition");
    runtime.networkEvents?.push({
      event: "response",
      timestamp: new Date().toISOString(),
      method: "GET",
      path: loggedPath,
      status: response.status,
      requestId: response.headers.get("x-request-id"),
      durationMs: Math.round(performance.now() - startedAt),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw redirectFailure("下载 redirect 缺少 Location header。");
      }
      if (redirectCount === 5) {
        throw redirectFailure("下载 redirect 超过 5 次。");
      }
      currentUrl = redirectTarget(location, currentUrl);
      followedRedirect = true;
      try {
        await response.body?.cancel();
      } catch (error) {
        throwDownloadBodyFailure(
          runtime,
          error,
          startedAt,
          loggedPath,
          options.helpCommand,
          requestId,
        );
      }
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (
      response.ok &&
      /^(?:application\/json|[^;]+\+json)(?:;|$)/i.test(contentType)
    ) {
      let redirectBody: unknown;
      try {
        redirectBody = await response.json();
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          throwDownloadBodyFailure(
            runtime,
            error,
            startedAt,
            loggedPath,
            options.helpCommand,
            requestId,
          );
        }
        throw redirectFailure("下载端点返回了无法解析的 JSON redirect。");
      }
      const redirectUrl =
        typeof redirectBody === "object" &&
        redirectBody !== null &&
        "code" in redirectBody &&
        redirectBody.code === 0 &&
        "data" in redirectBody &&
        typeof redirectBody.data === "object" &&
        redirectBody.data !== null &&
        "url" in redirectBody.data &&
        typeof redirectBody.data.url === "string"
          ? redirectBody.data.url
          : null;
      if (!redirectUrl) {
        throw redirectFailure("下载端点返回了不支持的 JSON success shape。");
      }
      if (redirectCount === 5) {
        throw redirectFailure("下载 redirect 超过 5 次。");
      }
      currentUrl = redirectTarget(redirectUrl, currentUrl);
      followedRedirect = true;
      continue;
    }
    break;
  }
  if (!response) {
    throw redirectFailure("下载端点没有返回响应。");
  }
  if (!response.ok) {
    if (!followedRedirect) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          throwDownloadBodyFailure(
            runtime,
            error,
            startedAt,
            safePath,
            options.helpCommand,
            requestId,
          );
        }
      }
      throw apiResponseFailure(response, body, [options.apiKey]);
    }
    throw new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      retryable: true,
      message: `下载 redirect 目标返回 HTTP ${response.status}。`,
      requestId,
      httpStatus: response.status,
      nextAction: {
        description: "检查媒体类型和资源状态",
        command: options.resourceRecoveryCommand,
      },
    });
  }
  if (!response.body) {
    throw redirectFailure("下载响应没有文件正文。");
  }
  const fileName = safeDownloadFileName(
    response.headers.get("content-disposition") ?? contentDisposition,
    options.fallbackFileName,
  );
  let reserved: Awaited<ReturnType<typeof reserveGeneratedDownload>>;
  try {
    reserved =
      options.file === undefined
        ? await reserveGeneratedDownload(
            runtime.cwd,
            fileName,
            options.helpCommand,
          )
        : await reserveExplicitDownload(
            runtime.cwd,
            options.file,
            options.overwrite,
            () =>
              new CliFailure({
                type: "FILE_EXISTS",
                exitCode: 2,
                field: "--file",
                message: "显式下载目标已存在。",
                nextAction: {
                  description: "确认后显式覆盖目标文件",
                  command: options.helpCommand,
                },
              }),
            (message) =>
              new CliFailure({
                type: "INVALID_INPUT",
                exitCode: 2,
                field: "--file",
                message,
                nextAction: {
                  description: "选择不经过符号链接的普通文件路径",
                  command: options.helpCommand,
                },
              }),
          );
  } catch (error) {
    if (error instanceof CliFailure) {
      throw error;
    }
    throw downloadFileFailure(options.helpCommand, requestId);
  }
  const hash = createHash("sha256");
  let bytes = 0;
  const reader = response.body.getReader();
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      await reserved.cleanup();
      if (runtime.signal?.aborted) {
        throw cancellationFailure(options.helpCommand);
      }
      throw downloadTransportFailure(error, options.helpCommand, requestId);
    }
    if (chunk.done) {
      break;
    }
    try {
      hash.update(chunk.value);
      bytes += chunk.value.byteLength;
      await writeAllDownloadChunk(reserved.handle, chunk.value);
    } catch (error) {
      await reserved.cleanup();
      if (error instanceof CliFailure) {
        throw error;
      }
      throw downloadFileFailure(options.helpCommand, requestId);
    }
  }
  try {
    await reserved.commit();
  } catch (error) {
    await reserved.cleanup();
    if (error instanceof CliFailure) {
      throw error;
    }
    throw downloadFileFailure(options.helpCommand, requestId);
  }
  return {
    data: {
      filePath: reserved.filePath,
      bytes,
      mediaType:
        response.headers.get("content-type")?.split(";")[0]?.trim() ??
        "application/octet-stream",
      sha256: hash.digest("hex"),
    },
    meta: {
      requestId,
      timezone: options.timezone,
      clientDate: requestClientDate,
    },
  };
}

export async function downloadNoteMedia(
  runtime: CliRuntime,
  options: {
    baseUrl: string;
    apiKey: string;
    timezone: string;
    path: string;
    noteId: string;
    media: "audio" | "image" | "video";
    file?: string;
    overwrite: boolean;
    timeoutMs: number;
  },
) {
  return await downloadMedia(runtime, {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    timezone: options.timezone,
    path: options.path,
    fallbackFileName: fallbackNoteDownloadFileName(
      options.noteId,
      options.media,
    ),
    helpCommand: "sharge notes download --help --json",
    resourceRecoveryCommand: `sharge notes get ${options.noteId} --json`,
    file: options.file,
    overwrite: options.overwrite,
    timeoutMs: options.timeoutMs,
  });
}
