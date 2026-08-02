import { resolve } from "node:path";
import { downloadMedia } from "../../api/download.js";
import { apiOperations } from "../../api/operations.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import {
  fallbackRecordingDownloadFileName,
  proposeGeneratedDownloadPath,
  validateExplicitDownloadTarget,
} from "../../runtime/download-files.js";
import { CliFailure } from "../../runtime/errors.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";
import { shellQuote } from "../../runtime/shell.js";
import {
  recoverRecordingsPermission,
  requireRecordingsApiKey,
} from "./request.js";

type RecordingsDownloadOptions = {
  file?: string;
  overwrite: boolean;
  dryRun: boolean;
  json: boolean;
  timeoutMs?: number;
  timezoneOverride?: string;
};

function invalid(
  field: string,
  message: string,
  command = "sharge recordings download --help --json",
): CliFailure {
  return new CliFailure({
    type: "INVALID_INPUT",
    exitCode: 2,
    field,
    message,
    nextAction: {
      description: "查看 Recording 下载输入契约",
      command,
    },
  });
}

export async function runRecordingsDownload(
  runtime: CliRuntime,
  recordingId: string,
  options: RecordingsDownloadOptions,
) {
  if (!/^[1-9]\d*$/.test(recordingId)) {
    throw invalid("recording-id", "recording-id 必须是正整数。");
  }
  const helpCommand = "sharge recordings download --help --json";
  const retryCommand = `sharge recordings download ${recordingId}${
    options.json ? " --json" : ""
  }`;
  if (options.file === "-") {
    throw invalid(
      "--file",
      "--file 不支持 -；下载内容只能写入文件。",
      retryCommand,
    );
  }
  if (options.overwrite && options.file === undefined) {
    throw invalid(
      "--overwrite",
      "--overwrite 只能与显式 --file 一起使用。",
      `sharge recordings download ${recordingId} --file <path> --overwrite${
        options.json ? " --json" : ""
      }`,
    );
  }
  if (options.file !== undefined) {
    const file = options.file;
    await validateExplicitDownloadTarget(
      runtime.cwd,
      file,
      options.overwrite,
      () =>
        new CliFailure({
          type: "FILE_EXISTS",
          exitCode: 2,
          field: "--file",
          message: "显式下载目标已存在。",
          nextAction: {
            description: "确认后显式覆盖目标文件",
            command: `sharge recordings download ${recordingId} --file ${shellQuote(file)} --overwrite${
              options.json ? " --json" : ""
            }`,
          },
        }),
      (message) =>
        invalid("--file", message, "sharge recordings download --help --json"),
    );
  }
  const store = await loadOrCreateSettings(runtime, {
    validateCredentials: !options.dryRun,
  });
  const resolved = resolveConfig(runtime, store, options.timezoneOverride, {
    validateCredential: !options.dryRun,
  });
  const operation = apiOperations.recordingsDownload;
  const path = operation.path.replace("{recording_id}", recordingId);
  const fallbackFileName = fallbackRecordingDownloadFileName(recordingId);
  if (options.dryRun) {
    const filePath =
      options.file === undefined
        ? await proposeGeneratedDownloadPath(runtime.cwd, fallbackFileName)
        : resolve(runtime.cwd, options.file);
    const plan = {
      method: "GET" as const,
      url: `${resolved.baseUrl.value}${path}`,
      path,
      filePath,
      fileNameSource: options.file === undefined ? "fallback" : "explicit",
      overwrite: options.overwrite,
      requiredScopes: [...operation.requiredScopes],
      unverified: [
        "remote_media_exists",
        ...(options.file === undefined
          ? ["content_disposition_filename", "target_name_still_available"]
          : []),
      ],
    };
    return {
      text: [
        `method: ${plan.method}`,
        `url: ${plan.url}`,
        `path: ${plan.path}`,
        `filePath: ${plan.filePath}`,
        `fileNameSource: ${plan.fileNameSource}`,
        `overwrite: ${String(plan.overwrite)}`,
        `requiredScopes: ${plan.requiredScopes.join(", ")}`,
        `unverified: ${plan.unverified.join(", ")}`,
        "未发送网络请求，也未创建文件。",
        "",
      ].join("\n"),
      data: plan,
    };
  }
  const apiKey = requireRecordingsApiKey(resolved);
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 600_000);
  try {
    const result = await downloadMedia(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey,
      timezone: resolved.timezone.value,
      path,
      fallbackFileName,
      helpCommand,
      resourceRecoveryCommand: `sharge recordings get ${recordingId} --json`,
      file: options.file,
      overwrite: options.overwrite,
      timeoutMs: Math.max(1, deadline - (runtime.now ?? Date.now)()),
    });
    return {
      text: `${result.data.filePath}\n`,
      data: result.data,
      meta: result.meta,
    };
  } catch (error) {
    if (error instanceof CliFailure && error.type === "PERMISSION_DENIED") {
      return await recoverRecordingsPermission(
        runtime,
        {
          baseUrl: resolved.baseUrl.value,
          apiKey,
          timezone: resolved.timezone.value,
          deadline,
          operation,
        },
        error,
      );
    }
    if (error instanceof CliFailure && error.type === "NOT_FOUND") {
      throw new CliFailure({
        type: "NOT_FOUND",
        exitCode: 5,
        message: error.message,
        requestId: error.requestId,
        httpStatus: error.httpStatus,
        nextAction: {
          description: "读取 Recording，确认音频是否可用",
          command: `sharge recordings get ${recordingId} --json`,
        },
      });
    }
    throw error;
  }
}
