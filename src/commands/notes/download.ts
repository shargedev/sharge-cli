import { resolve } from "node:path";
import { downloadNoteMedia } from "../../api/download.js";
import { apiOperations } from "../../api/operations.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import {
  fallbackNoteDownloadFileName,
  proposeGeneratedDownloadPath,
  validateExplicitDownloadTarget,
} from "../../runtime/download-files.js";
import { CliFailure } from "../../runtime/errors.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";
import { shellQuote } from "../../runtime/shell.js";
import { recoverNotesPermission, requireNotesApiKey } from "./request.js";

type NotesDownloadOptions = {
  media?: string;
  file?: string;
  overwrite: boolean;
  dryRun: boolean;
  json: boolean;
  timeoutMs?: number;
  timezoneOverride?: string;
};

export async function runNotesDownload(
  runtime: CliRuntime,
  noteId: string,
  options: NotesDownloadOptions,
) {
  if (!/^[1-9]\d*$/.test(noteId)) {
    throw new CliFailure({
      type: "INVALID_INPUT",
      exitCode: 2,
      field: "note-id",
      message: "note-id 必须是正整数。",
      nextAction: {
        description: "查看 Notes 下载输入契约",
        command: "sharge notes download --help --json",
      },
    });
  }
  if (
    options.media !== "audio" &&
    options.media !== "image" &&
    options.media !== "video"
  ) {
    throw new CliFailure({
      type: "INVALID_INPUT",
      exitCode: 2,
      field: "--media",
      message: "--media 必须是 audio、image 或 video。",
      nextAction: {
        description: "选择 Note 已提供的媒体类型",
        command: "sharge notes download --help --json",
      },
    });
  }
  if (options.file === "-") {
    throw new CliFailure({
      type: "INVALID_INPUT",
      exitCode: 2,
      field: "--file",
      message: "--file 不支持 -；下载内容只能写入文件。",
      nextAction: {
        description: "省略 --file 使用安全默认文件名",
        command: `sharge notes download ${noteId} --media ${options.media}${options.json ? " --json" : ""}`,
      },
    });
  }
  if (options.overwrite && options.file === undefined) {
    throw new CliFailure({
      type: "INVALID_INPUT",
      exitCode: 2,
      field: "--overwrite",
      message: "--overwrite 只能与显式 --file 一起使用。",
      nextAction: {
        description: "指定要覆盖的目标文件",
        command: `sharge notes download ${noteId} --media ${options.media} --file <path> --overwrite${options.json ? " --json" : ""}`,
      },
    });
  }
  if (options.file !== undefined) {
    const file = options.file;
    const invalidFileTarget = (message: string) =>
      new CliFailure({
        type: "INVALID_INPUT",
        exitCode: 2,
        field: "--file",
        message,
        nextAction: {
          description: "选择普通文件所在的现有目录",
          command: "sharge notes download --help --json",
        },
      });
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
            command: `sharge notes download ${noteId} --media ${options.media} --file ${shellQuote(file)} --overwrite${options.json ? " --json" : ""}`,
          },
        }),
      invalidFileTarget,
    );
  }
  const store = await loadOrCreateSettings(runtime, {
    validateCredentials: !options.dryRun,
  });
  const resolved = resolveConfig(runtime, store, options.timezoneOverride, {
    validateCredential: !options.dryRun,
  });
  const operation = apiOperations.notesDownload;
  const path = operation.path
    .replace("{note_id}", noteId)
    .replace("{media_type}", options.media);
  if (options.dryRun) {
    const filePath =
      options.file === undefined
        ? await proposeGeneratedDownloadPath(
            runtime.cwd,
            fallbackNoteDownloadFileName(noteId, options.media),
          )
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
  const apiKey = requireNotesApiKey(resolved);
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 600_000);
  let result: Awaited<ReturnType<typeof downloadNoteMedia>>;
  try {
    result = await downloadNoteMedia(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey,
      timezone: resolved.timezone.value,
      path,
      noteId,
      media: options.media,
      file: options.file,
      overwrite: options.overwrite,
      timeoutMs: Math.max(1, deadline - (runtime.now ?? Date.now)()),
    });
  } catch (error) {
    if (error instanceof CliFailure && error.type === "PERMISSION_DENIED") {
      return await recoverNotesPermission(
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
          description: "读取 Quick Note，确认媒体是否可用",
          command: `sharge notes get ${noteId} --json`,
        },
      });
    }
    throw error;
  }
  return {
    text: `${result.data.filePath}\n`,
    data: result.data,
    meta: result.meta,
  };
}
