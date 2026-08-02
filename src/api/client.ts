import { isSafeNumber, parse as parseLosslessJson } from "lossless-json";
import packageJson from "../../package.json" with { type: "json" };
import type { CliRuntime } from "../runtime/context.js";
import { CliFailure } from "../runtime/errors.js";

export type ApiResponse<T> = {
  data: T;
  requestId: string | null;
  clientDate: string;
  retryAfterMs: number | null;
  httpStatus: number;
};

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function cancellationFailure(): CliFailure {
  return new CliFailure({
    type: "CANCELLED",
    exitCode: 130,
    message: "操作已由用户取消。",
    nextAction: {
      description: "需要时重新执行命令",
      command: "sharge --help",
    },
  });
}

function transportFailure(options: {
  error: unknown;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  requestId?: string | null;
  httpStatus?: number | null;
}): CliFailure {
  const timedOut = isTimeoutError(options.error);
  const writeOutcome = options.method !== "GET";
  return new CliFailure({
    type: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
    exitCode: 8,
    retryable: !writeOutcome,
    ...(writeOutcome ? { outcome: "unknown" as const } : {}),
    requestId: options.requestId ?? null,
    httpStatus: options.httpStatus ?? null,
    message: timedOut
      ? "Open Platform 请求超时。"
      : "无法完整接收 Open Platform 响应。",
    nextAction: {
      description: writeOutcome
        ? "先读取资源确认写操作是否已经生效"
        : "诊断本地配置与 Open Platform 连通性",
      command: "sharge doctor --json",
    },
  });
}

function redactServerMessage(
  message: string,
  sensitiveValues: Array<string | undefined>,
): string {
  let redacted = message;
  for (const value of sensitiveValues) {
    if (value) {
      redacted = redacted.replaceAll(value, "[REDACTED]");
    }
  }
  return redacted;
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) {
    return null;
  }
  if (/^\d+$/.test(value)) {
    return Number(value) * 1_000;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - Date.now());
}

export function apiResponseFailure(
  response: Response,
  body: unknown,
  sensitiveValues: Array<string | undefined> = [],
): CliFailure {
  const requestId = response.headers.get("x-request-id");
  const rawMessage =
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
      ? body.message
      : `Open Platform request failed with HTTP ${response.status}`;
  const message = redactServerMessage(rawMessage, sensitiveValues);
  if (response.status === 401) {
    return new CliFailure({
      type: "CREDENTIAL_INVALID",
      exitCode: 3,
      message: `API Key 无效或已过期：${message}`,
      requestId,
      httpStatus: response.status,
      nextAction: {
        description: "重新登录并轮换 API Key",
        command: "sharge login --force",
      },
    });
  }
  if (response.status === 400) {
    return new CliFailure({
      type: "INVALID_INPUT",
      exitCode: 2,
      message: `Open Platform 拒绝了请求参数：${message}`,
      requestId,
      httpStatus: response.status,
      nextAction: {
        description: "查看命令输入契约",
        command: "sharge --help --json",
      },
    });
  }
  if (response.status === 403) {
    return new CliFailure({
      type: "PERMISSION_DENIED",
      exitCode: 4,
      message: `当前凭证没有执行此操作的权限：${message}`,
      requestId,
      httpStatus: response.status,
      nextAction: {
        description: "查看当前 scope 目录与授权",
        command: "sharge auth scopes --json",
      },
    });
  }
  if (response.status === 404) {
    return new CliFailure({
      type: "NOT_FOUND",
      exitCode: 5,
      message: `资源不存在或不属于当前用户：${message}`,
      requestId,
      httpStatus: response.status,
      nextAction: {
        description: "检查资源标识或重新列出资源",
        command: "sharge --help --json",
      },
    });
  }
  if (response.status === 409) {
    return new CliFailure({
      type: "CONFLICT",
      exitCode: 6,
      message: `资源状态与请求冲突：${message}`,
      requestId,
      httpStatus: response.status,
      nextAction: {
        description: "读取当前状态后再决定下一步",
        command: "sharge --help --json",
      },
    });
  }
  if (response.status === 429) {
    return new CliFailure({
      type: "RATE_LIMITED",
      exitCode: 7,
      retryable: true,
      message: `请求受到限流：${message}`,
      requestId,
      httpStatus: response.status,
      retryAfterMs: retryAfterMs(response),
      nextAction: {
        description: "由调用方决定是否等待后重试",
        command: "sharge auth status --json",
      },
    });
  }
  if (response.status >= 500) {
    return new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      retryable: true,
      message: `Open Platform 暂时不可用：${message}`,
      requestId,
      httpStatus: response.status,
      nextAction: {
        description: "由调用方决定是否稍后重试",
        command: "sharge doctor --json",
      },
    });
  }
  return new CliFailure({
    type: "SERVER_ERROR",
    exitCode: 8,
    retryable: true,
    message: `Open Platform 返回了未支持的响应：${message}`,
    requestId,
    httpStatus: response.status,
    nextAction: {
      description: "记录 requestId 并诊断 Open Platform",
      command: "sharge doctor --json",
    },
  });
}

function dateParts(date: Date, timezone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function clientDate(date: Date, timezone: string): string {
  const parts = dateParts(date, timezone);
  const localEpoch = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const truncatedEpoch = Math.floor(date.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((localEpoch - truncatedEpoch) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(
    2,
    "0",
  )}:${String(absoluteOffset % 60).padStart(2, "0")}`;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

export async function requestJson<T>(
  runtime: CliRuntime,
  options: {
    baseUrl: string;
    apiKey?: string;
    timezone: string;
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    path: string;
    timeoutMs?: number;
    body?: unknown;
    sensitiveValues?: string[];
    acceptedHttpStatuses?: number[];
  },
): Promise<ApiResponse<T>> {
  const requestClientDate = clientDate(
    new Date((runtime.now ?? Date.now)()),
    options.timezone,
  );
  const safePath = new URL(options.path, options.baseUrl).pathname;
  const startedAt = performance.now();
  runtime.networkEvents?.push({
    event: "request",
    timestamp: new Date().toISOString(),
    method: options.method,
    path: safePath,
  });
  let response: Response;
  try {
    const headers: Record<string, string> = {
      "X-Client-Date": requestClientDate,
      "User-Agent": `sharge-cli/${packageJson.version} (${runtime.platform}; Node ${process.version})`,
    };
    if (options.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    response = await fetch(`${options.baseUrl}${options.path}`, {
      method: options.method,
      headers,
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
      signal: runtime.signal
        ? AbortSignal.any([
            runtime.signal,
            AbortSignal.timeout(options.timeoutMs ?? 30_000),
          ])
        : AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch (error) {
    if (runtime.signal?.aborted) {
      throw cancellationFailure();
    }
    const timedOut = isTimeoutError(error);
    runtime.networkEvents?.push({
      event: "network_error",
      timestamp: new Date().toISOString(),
      method: options.method,
      path: safePath,
      errorType: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw transportFailure({
      error,
      method: options.method,
    });
  }
  const responseRequestId = response.headers.get("x-request-id");
  runtime.networkEvents?.push({
    event: "response",
    timestamp: new Date().toISOString(),
    method: options.method,
    path: safePath,
    status: response.status,
    requestId: responseRequestId,
    durationMs: Math.round(performance.now() - startedAt),
  });
  let responseText: string;
  try {
    responseText = await response.text();
  } catch (error) {
    if (runtime.signal?.aborted) {
      throw cancellationFailure();
    }
    const timedOut = isTimeoutError(error);
    runtime.networkEvents?.push({
      event: "network_error",
      timestamp: new Date().toISOString(),
      method: options.method,
      path: safePath,
      errorType: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw transportFailure({
      error,
      method: options.method,
      requestId: responseRequestId,
      httpStatus: response.status,
    });
  }
  let body: unknown;
  try {
    body = parseLosslessJson(responseText, null, {
      parseNumber: (value) => (isSafeNumber(value) ? Number(value) : value),
    });
  } catch {
    if (response.ok) {
      throw new CliFailure({
        type: "SERVER_ERROR",
        exitCode: 8,
        retryable: true,
        message: "Open Platform 返回了无法解析的成功响应。",
        requestId: responseRequestId,
        httpStatus: response.status,
        nextAction: {
          description: "记录 requestId 并诊断 Open Platform",
          command: "sharge doctor --json",
        },
      });
    }
    body = null;
  }
  const acceptedStatus =
    response.ok ||
    (options.acceptedHttpStatuses?.includes(response.status) ?? false);
  if (
    !acceptedStatus ||
    typeof body !== "object" ||
    body === null ||
    !("code" in body) ||
    body.code !== 0 ||
    !("data" in body)
  ) {
    throw apiResponseFailure(response, body, [
      options.apiKey,
      ...(options.sensitiveValues ?? []),
    ]);
  }
  return {
    data: body.data as T,
    requestId: responseRequestId,
    clientDate: requestClientDate,
    retryAfterMs: retryAfterMs(response),
    httpStatus: response.status,
  };
}
