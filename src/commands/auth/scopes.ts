import { requestJson } from "../../api/client.js";
import { apiOperations } from "../../api/operations.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";

export async function runAuthScopes(
  runtime: CliRuntime,
  timeoutMs?: number,
  timezoneOverride?: string,
) {
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, timezoneOverride);
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
  const operation = apiOperations.authScopes;
  const response = await requestJson<unknown[]>(runtime, {
    baseUrl: resolved.baseUrl.value,
    apiKey: resolved.apiKey,
    timezone: resolved.timezone.value,
    method: operation.method,
    path: operation.path,
    timeoutMs,
  });
  return {
    text: response.data
      .map((item) => {
        const scope =
          typeof item === "object" && item !== null && "scope" in item
            ? String(item.scope)
            : "unknown";
        const granted =
          typeof item === "object" && item !== null && "granted" in item
            ? item.granted === true
            : false;
        return `${granted ? "✓" : "·"} ${scope}`;
      })
      .join("\n")
      .concat("\n"),
    data: response.data,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}
