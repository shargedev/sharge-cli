import { type ApiResponse, requestJson } from "../../api/client.js";
import { type ApiOperation, apiOperations } from "../../api/operations.js";
import type { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import { scopeRequiredFailure } from "../../runtime/scopes.js";

export function requireCalendarApiKey(
  resolved: ReturnType<typeof resolveConfig>,
): string {
  if (!resolved.apiKey) {
    throw new CliFailure({
      type: "AUTH_REQUIRED",
      exitCode: 3,
      message: "尚未配置 API Key。",
      nextAction: {
        description: "登录并保存 API Key",
        command: "sharge login",
      },
    });
  }
  return resolved.apiKey;
}

type CalendarRequestContext = {
  baseUrl: string;
  apiKey: string;
  timezone: string;
  deadline: number;
  operation: ApiOperation;
};

function remainingCalendarTimeout(
  runtime: CliRuntime,
  options: CalendarRequestContext,
  cause?: CliFailure,
): number {
  const remaining = options.deadline - (runtime.now ?? Date.now)();
  if (remaining <= 0) {
    throw new CliFailure({
      type: "TIMEOUT",
      exitCode: 8,
      retryable: options.operation.method === "GET",
      ...(options.operation.method === "GET"
        ? {}
        : { outcome: "unknown" as const }),
      message: "Calendar 命令在完成权限恢复前已超过总超时。",
      requestId: cause?.requestId,
      httpStatus: cause?.httpStatus,
      nextAction: {
        description: "诊断本地配置与 Open Platform 连通性",
        command: "sharge doctor --json",
      },
    });
  }
  return remaining;
}

async function recoverCalendarPermission(
  runtime: CliRuntime,
  options: CalendarRequestContext,
  error: CliFailure,
): Promise<never> {
  const statusOperation = apiOperations.authStatus;
  const status = await requestJson<unknown>(runtime, {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    timezone: options.timezone,
    method: statusOperation.method,
    path: statusOperation.path,
    timeoutMs: remainingCalendarTimeout(runtime, options, error),
  });
  const currentScopes =
    typeof status.data === "object" &&
    status.data !== null &&
    "scopes" in status.data &&
    Array.isArray(status.data.scopes) &&
    status.data.scopes.every((scope) => typeof scope === "string")
      ? status.data.scopes
      : null;
  if (!currentScopes) {
    throw error;
  }
  const recovery = scopeRequiredFailure(
    currentScopes,
    options.operation.requiredScopes,
  );
  throw new CliFailure({
    type: recovery.type,
    exitCode: recovery.exitCode,
    message: recovery.message,
    requiredScopes: recovery.requiredScopes,
    requestId: error.requestId,
    httpStatus: error.httpStatus,
    nextAction: recovery.nextAction,
  });
}

export async function requestCalendar<T>(
  runtime: CliRuntime,
  options: CalendarRequestContext & { path: string; body?: unknown },
): Promise<ApiResponse<T>> {
  try {
    return await requestJson<T>(runtime, {
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      timezone: options.timezone,
      method: options.operation.method,
      path: options.path,
      ...(options.body === undefined ? {} : { body: options.body }),
      timeoutMs: remainingCalendarTimeout(runtime, options),
    });
  } catch (error) {
    if (!(error instanceof CliFailure) || error.type !== "PERMISSION_DENIED") {
      throw error;
    }
    return await recoverCalendarPermission(runtime, options, error);
  }
}
