import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type CliRuntime, readProcessStdin } from "./context.js";
import { CliFailure } from "./errors.js";

function invalidInput(
  message: string,
  helpCommand: string,
  details: { path?: string; expected?: string; actual?: string } = {},
): CliFailure {
  return new CliFailure({
    type: "INVALID_INPUT",
    exitCode: 2,
    field: "--input",
    ...details,
    message,
    nextAction: {
      description: "查看结构化输入契约",
      command: helpCommand,
    },
  });
}

export async function parseJsonInput(
  runtime: CliRuntime,
  value: string,
  helpCommand: string,
): Promise<unknown> {
  let raw = value;
  if (value === "-") {
    try {
      raw = await (runtime.readStdin
        ? runtime.readStdin()
        : readProcessStdin());
    } catch {
      throw invalidInput("无法从 stdin 读取 --input JSON。", helpCommand);
    }
  }
  if (value.startsWith("@")) {
    const fileName = value.slice(1);
    if (fileName.length === 0) {
      throw invalidInput("--input @ 后必须提供文件路径。", helpCommand);
    }
    try {
      raw = await readFile(resolve(runtime.cwd, fileName), "utf8");
    } catch {
      throw invalidInput(`无法读取 --input 文件：${fileName}`, helpCommand);
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw invalidInput("--input 不是有效 JSON。", helpCommand, {
      path: "$",
      expected: "valid JSON",
      actual: "invalid JSON",
    });
  }
}
