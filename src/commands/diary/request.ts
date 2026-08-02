import { type ApiResponse, requestJson } from "../../api/client.js";
import { type ApiOperation, apiOperations } from "../../api/operations.js";
import type { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import { scopeRequiredFailure } from "../../runtime/scopes.js";

export function requireDiaryApiKey(
  resolved: ReturnType<typeof resolveConfig>,
): string {
  if (resolved.apiKey) return resolved.apiKey;
  throw new CliFailure({
    type: "AUTH_REQUIRED",
    exitCode: 3,
    message: "尚未配置 API Key。",
    nextAction: { description: "登录并保存 API Key", command: "sharge login" },
  });
}

type Context = {
  baseUrl: string;
  apiKey: string;
  timezone: string;
  deadline: number;
  operation: ApiOperation;
};

function remaining(runtime: CliRuntime, options: Context): number {
  const value = options.deadline - (runtime.now ?? Date.now)();
  if (value > 0) return value;
  throw new CliFailure({
    type: "TIMEOUT",
    exitCode: 8,
    retryable: true,
    message: "Diary 命令已超过总超时。",
    nextAction: {
      description: "诊断 Open Platform",
      command: "sharge doctor --json",
    },
  });
}

export async function requestDiary<T>(
  runtime: CliRuntime,
  options: Context & { path: string },
): Promise<ApiResponse<T>> {
  try {
    return await requestJson<T>(runtime, {
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      timezone: options.timezone,
      method: options.operation.method,
      path: options.path,
      timeoutMs: remaining(runtime, options),
    });
  } catch (error) {
    if (!(error instanceof CliFailure) || error.type !== "PERMISSION_DENIED")
      throw error;
    const status = await requestJson<unknown>(runtime, {
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      timezone: options.timezone,
      method: "GET",
      path: apiOperations.authStatus.path,
      timeoutMs: remaining(runtime, options),
    });
    const scopes =
      typeof status.data === "object" &&
      status.data !== null &&
      "scopes" in status.data &&
      Array.isArray(status.data.scopes) &&
      status.data.scopes.every((scope) => typeof scope === "string")
        ? status.data.scopes
        : null;
    if (!scopes) throw error;
    const recovery = scopeRequiredFailure(
      scopes,
      options.operation.requiredScopes,
    );
    throw new CliFailure({
      ...recovery,
      requestId: error.requestId,
      httpStatus: error.httpStatus,
    });
  }
}
