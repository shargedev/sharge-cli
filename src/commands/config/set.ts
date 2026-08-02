import type { CommandExecution } from "../../cli/definitions.js";
import {
  environmentName,
  normalizeBaseUrl,
  resolveConfig,
  validateTimezone,
} from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import {
  loadOrCreateSettings,
  type Settings,
  writeSettings,
} from "../../runtime/settings.js";

function invalidValue(field: string, message: string): CliFailure {
  return new CliFailure({
    message,
    field,
    nextAction: {
      description: "查看 config set 参数",
      command: "sharge config set --help --json",
    },
  });
}

export function applyBaseUrlSwitch(
  settings: Settings,
  currentBaseUrl: string,
  targetBaseUrl: string,
): { credentialRestored: boolean } {
  if (targetBaseUrl === currentBaseUrl) {
    settings.baseUrl = targetBaseUrl;
    return { credentialRestored: false };
  }

  const currentCredential = settings.apiKey
    ? {
        baseUrl: currentBaseUrl,
        apiKey: settings.apiKey,
      }
    : undefined;
  if (settings.previousCredential?.baseUrl === targetBaseUrl) {
    settings.apiKey = settings.previousCredential.apiKey;
    if (currentCredential) {
      settings.previousCredential = currentCredential;
    } else {
      delete settings.previousCredential;
    }
    settings.baseUrl = targetBaseUrl;
    return { credentialRestored: true };
  }

  if (currentCredential) {
    settings.previousCredential = currentCredential;
  }
  delete settings.apiKey;
  settings.baseUrl = targetBaseUrl;
  return { credentialRestored: false };
}

export async function runConfigSet(
  runtime: CliRuntime,
  key: string,
  value: string,
): Promise<CommandExecution> {
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store);

  let data: Record<string, unknown>;
  if (key === "base-url") {
    let normalized: string;
    try {
      normalized = normalizeBaseUrl(value);
    } catch {
      throw invalidValue(
        "value",
        "Base URL 必须是有效 HTTPS URL；localhost 可以使用 HTTP。",
      );
    }
    const switchResult = applyBaseUrlSwitch(
      store.settings,
      resolved.baseUrl.value,
      normalized,
    );
    data = {
      changed: normalized !== resolved.baseUrl.value,
      key,
      value: normalized,
      environment: environmentName(normalized),
      credentialRestored: switchResult.credentialRestored,
    };
  } else if (key === "timezone") {
    try {
      store.settings.timezone = validateTimezone(value);
    } catch {
      throw invalidValue("value", "Timezone 必须是有效 IANA 名称。");
    }
    data = {
      changed: value !== resolved.timezone.value,
      key,
      value,
    };
  } else {
    throw invalidValue("key", "只允许设置 base-url 或 timezone。");
  }

  await writeSettings(runtime, store.settingsPath, store.settings);
  return {
    text: `已设置 ${key}：${String(data.value)}\n`,
    data,
  };
}
