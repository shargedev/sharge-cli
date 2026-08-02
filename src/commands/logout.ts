import type { CommandExecution } from "../cli/definitions.js";
import type { CliRuntime } from "../runtime/context.js";
import { loadOrCreateSettings, writeSettings } from "../runtime/settings.js";

export async function runLogout(
  runtime: CliRuntime,
): Promise<CommandExecution> {
  const store = await loadOrCreateSettings(runtime);
  const settingsCredentialRemoved = store.settings.apiKey !== undefined;
  const previousCredentialRemoved =
    store.settings.previousCredential !== undefined;
  const changed = settingsCredentialRemoved || previousCredentialRemoved;
  delete store.settings.apiKey;
  delete store.settings.previousCredential;
  await writeSettings(runtime, store.settingsPath, store.settings);
  const environmentCredentialActive = Boolean(runtime.env.SHARGE_API_KEY);
  return {
    text: environmentCredentialActive
      ? "已删除 settings 凭证；SHARGE_API_KEY 环境变量仍然有效。\n"
      : "已删除本地文件凭证。\n",
    data: {
      changed,
      settingsCredentialRemoved,
      previousCredentialRemoved,
      environmentCredentialActive,
    },
    warnings: environmentCredentialActive
      ? [
          {
            type: "ENVIRONMENT_CREDENTIAL_ACTIVE",
            message: "SHARGE_API_KEY 环境变量仍然有效；logout 只删除文件凭证。",
            nextActions: [
              {
                description: "清除当前 shell 中的环境变量凭证",
                command: "unset SHARGE_API_KEY",
              },
            ],
          },
        ]
      : [],
  };
}
