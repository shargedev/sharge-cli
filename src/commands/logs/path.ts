import type { CommandExecution } from "../../cli/definitions.js";
import type { CliRuntime } from "../../runtime/context.js";
import { settingsPaths } from "../../runtime/settings.js";

export async function runLogsPath(
  runtime: CliRuntime,
): Promise<CommandExecution> {
  const { logPath } = settingsPaths(runtime);
  return {
    text: `${logPath}\n`,
    data: {
      filePath: logPath,
    },
  };
}
