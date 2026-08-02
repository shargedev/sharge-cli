import { CliFailure } from "./errors.js";

export function parseTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^([1-9]\d*)(s|m)$/.exec(value);
  if (!match) {
    throw new CliFailure({
      message: "timeout 必须是带 s 或 m 单位的正整数。",
      field: "--timeout",
      nextAction: {
        description: "使用带单位的 timeout",
        command: "sharge auth status --timeout 30s --json",
      },
    });
  }
  const multiplier = match[2] === "m" ? 60_000 : 1_000;
  return Number(match[1]) * multiplier;
}
