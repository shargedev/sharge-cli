import type { CommandExecution } from "../../cli/definitions.js";
import {
  DEFAULT_BASE_URL,
  environmentName,
  normalizeBaseUrl,
  resolveConfig,
} from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import { loadOrCreateSettings, writeSettings } from "../../runtime/settings.js";
import { applyBaseUrlSwitch } from "./set.js";

function invalidKey(): CliFailure {
  return new CliFailure({
    message: "只允许移除 base-url 或 timezone。",
    field: "key",
    nextAction: {
      description: "查看 config unset 参数",
      command: "sharge config unset --help --json",
    },
  });
}

export async function runConfigUnset(
  runtime: CliRuntime,
  key: string,
): Promise<CommandExecution> {
  const store = await loadOrCreateSettings(runtime);
  const before = resolveConfig(runtime, store);
  let data: Record<string, unknown>;

  if (key === "base-url") {
    const targetSource = runtime.env.SHARGE_BASE_URL ? "env" : "default";
    const targetBaseUrl = normalizeBaseUrl(
      runtime.env.SHARGE_BASE_URL ?? DEFAULT_BASE_URL,
    );
    const switchResult = applyBaseUrlSwitch(
      store.settings,
      before.baseUrl.value,
      targetBaseUrl,
    );
    delete store.settings.baseUrl;
    data = {
      changed: before.baseUrl.source === "settings",
      key,
      value: targetBaseUrl,
      source: targetSource,
      environment: environmentName(targetBaseUrl),
      credentialRestored: switchResult.credentialRestored,
    };
  } else if (key === "timezone") {
    const changed = store.settings.timezone !== undefined;
    delete store.settings.timezone;
    const after = resolveConfig(runtime, store);
    data = {
      changed,
      key,
      value: after.timezone.value,
      source: after.timezone.source,
    };
  } else {
    throw invalidKey();
  }

  await writeSettings(runtime, store.settingsPath, store.settings);
  return {
    text: `已移除 ${key}；当前值：${String(data.value)}\n`,
    data,
  };
}
