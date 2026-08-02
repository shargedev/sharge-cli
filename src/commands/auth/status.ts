import { requestJson } from "../../api/client.js";
import { apiOperations } from "../../api/operations.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";

export async function runAuthStatus(
  runtime: CliRuntime,
  timeoutMs?: number,
  timezoneOverride?: string,
) {
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, timezoneOverride);
  if (!resolved.apiKey) {
    throw new CliFailure({
      message: "尚未配置 API Key。",
      field: "apiKey",
      type: "AUTH_REQUIRED",
      exitCode: 3,
      nextAction: {
        description: "登录并保存 API Key",
        command: "sharge login",
      },
    });
  }
  const operation = apiOperations.authStatus;
  const response = await requestJson<Record<string, unknown>>(runtime, {
    baseUrl: resolved.baseUrl.value,
    apiKey: resolved.apiKey,
    timezone: resolved.timezone.value,
    method: operation.method,
    path: operation.path,
    timeoutMs,
  });
  const data = {
    credential: {
      source: resolved.credential.source,
      settingsPath: store.settingsPath,
      keyPrefix: resolved.credential.keyPrefix,
      baseUrl: resolved.baseUrl.value,
      environment: resolved.baseUrl.environment,
    },
    auth: response.data,
  };
  return {
    text: `认证有效，用户：${String(response.data.user_id ?? "unknown")}。\n`,
    data,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}
