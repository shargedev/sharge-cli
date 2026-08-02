import type { CommandExecution } from "../../cli/definitions.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";

export async function runConfigShow(
  runtime: CliRuntime,
  timezoneOverride?: string,
): Promise<CommandExecution> {
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, timezoneOverride);
  const data = {
    settingsPath: store.settingsPath,
    installationId: store.settings.installationId,
    baseUrl: resolved.baseUrl,
    credential: resolved.credential,
    timezone: resolved.timezone,
    previousCredential: {
      present: Boolean(store.settings.previousCredential),
      baseUrl: store.settings.previousCredential?.baseUrl ?? null,
    },
    logPath: store.logPath,
  };

  return {
    text: [
      `Base URL：${data.baseUrl.value} (${data.baseUrl.environment}, ${data.baseUrl.source})`,
      `凭证来源：${data.credential.source}`,
      `Timezone：${data.timezone.value} (${data.timezone.source})`,
      `Settings：${data.settingsPath}`,
      `日志：${data.logPath}`,
      "",
    ].join("\n"),
    data,
  };
}
