import { execFile } from "node:child_process";
import { chmod } from "node:fs/promises";
import { promisify } from "node:util";
import type { CliRuntime } from "./context.js";
import { CliFailure } from "./errors.js";

const execFileAsync = promisify(execFile);

export async function hardenPermissions(
  runtime: CliRuntime,
  path: string,
  kind: "directory" | "file",
): Promise<void> {
  if (runtime.platform !== "win32") {
    await chmod(path, kind === "directory" ? 0o700 : 0o600);
    return;
  }

  const username = runtime.env.USERNAME ?? runtime.env.USER;
  if (!username) {
    throw new CliFailure({
      message: "无法识别当前 Windows 用户，不能安全设置文件 ACL。",
      field: "settingsPath",
      nextAction: {
        description: "设置 USERNAME 后重试",
        command: "sharge config show --json",
      },
    });
  }
  const permission =
    kind === "directory" ? `${username}:(OI)(CI)F` : `${username}:F`;
  await execFileAsync("icacls", [
    path,
    "/inheritance:r",
    "/grant:r",
    permission,
  ]);
}
