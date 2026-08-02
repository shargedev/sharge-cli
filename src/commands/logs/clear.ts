import { lstat, unlink } from "node:fs/promises";
import type { CommandExecution } from "../../cli/definitions.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import { settingsPaths } from "../../runtime/settings.js";

function requiredYes(json: boolean): CliFailure {
  return new CliFailure({
    message: "清理日志必须显式提供 --yes。",
    field: "--yes",
    nextAction: {
      description: "确认后清理当前和轮转日志",
      command: `sharge logs clear --yes${json ? " --json" : ""}`,
    },
  });
}

export async function runLogsClear(
  runtime: CliRuntime,
  options: { yes: boolean; json: boolean },
): Promise<CommandExecution> {
  if (!options.yes) {
    throw requiredYes(options.json);
  }

  const { logPath } = settingsPaths(runtime);
  const paths = [
    logPath,
    ...Array.from({ length: 4 }, (_, index) => `${logPath}.${index + 1}`),
  ];
  let removedFiles = 0;
  for (const path of paths) {
    try {
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new CliFailure({
          message: `拒绝清理不安全的日志路径：${path}`,
          field: "logPath",
          nextAction: {
            description: "移除符号链接或非普通文件后重试",
            command: `sharge logs clear --yes${options.json ? " --json" : ""}`,
          },
        });
      }
      await unlink(path);
      removedFiles += 1;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }

  return {
    text: `已清理日志文件：${removedFiles}\n`,
    data: {
      cleared: true,
      removedFiles,
    },
  };
}
