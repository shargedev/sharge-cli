import type { z } from "zod";
import type { ApiResponse } from "../../api/client.js";
import { apiOperations } from "../../api/operations.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import {
  createDryRunPlan,
  renderDryRunPlanText,
} from "../../runtime/dry-run.js";
import { CliFailure } from "../../runtime/errors.js";
import { parseJsonInput } from "../../runtime/input.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";
import { notesUpdateZodSchema } from "./input-contract.js";
import { requestNotes, requireNotesApiKey } from "./request.js";

type NotesUpdateOptions = {
  input?: string;
  title?: string;
  content?: string;
  generateInput: boolean;
  dryRun: boolean;
  json: boolean;
  jq?: string;
  timeoutMs?: number;
  timezoneOverride?: string;
};

function invalidUpdate(
  message: string,
  field: string,
  details: { path?: string; expected?: string; actual?: string } = {},
): CliFailure {
  return new CliFailure({
    type: "INVALID_INPUT",
    exitCode: 2,
    field,
    ...details,
    message,
    nextAction: {
      description: "查看 Notes 更新输入契约",
      command: "sharge notes update --help --json",
    },
  });
}

function valueType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function inputPath(parts: PropertyKey[]): string {
  let path = "$";
  for (const part of parts) {
    if (typeof part === "number") {
      path += `[${part}]`;
      continue;
    }
    const key = String(part);
    path += /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
      ? `.${key}`
      : `[${JSON.stringify(key)}]`;
  }
  return path;
}

function valueAtPath(value: unknown, parts: PropertyKey[]): unknown {
  let current = value;
  for (const part of parts) {
    if (
      typeof current !== "object" ||
      current === null ||
      typeof part === "symbol"
    ) {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

function invalidSchemaInput(
  candidate: unknown,
  issue: z.core.$ZodIssue,
): CliFailure {
  if (issue.code === "unrecognized_keys") {
    const key = issue.keys[0] ?? "unknown";
    const actual =
      typeof candidate === "object" && candidate !== null
        ? (candidate as Record<string, unknown>)[key]
        : candidate;
    return invalidUpdate(`--input 包含未知字段：${key}`, "--input", {
      path: inputPath([key]),
      expected: "known field: title or content",
      actual: valueType(actual),
    });
  }
  return invalidUpdate(
    "Notes update 至少需要 title 或 content，字段必须是 string 或 null。",
    "--input",
    {
      path: inputPath(issue.path),
      expected:
        issue.code === "invalid_type"
          ? String(issue.expected)
          : "at least one of: title or content",
      actual: valueType(valueAtPath(candidate, issue.path)),
    },
  );
}

function recoverWriteFailure(error: unknown, noteId: string): never {
  if (!(error instanceof CliFailure)) {
    throw error;
  }
  if (error.type === "NOT_FOUND") {
    throw new CliFailure({
      type: "NOT_FOUND",
      exitCode: 5,
      message: error.message,
      requestId: error.requestId,
      httpStatus: error.httpStatus,
      nextAction: {
        description: "重新列出当前用户的 Quick Note",
        command: "sharge notes list --json",
      },
    });
  }
  if (
    (error.type === "TIMEOUT" || error.type === "NETWORK_ERROR") &&
    error.outcome === "unknown"
  ) {
    throw new CliFailure({
      type: error.type,
      exitCode: error.exitCode,
      retryable: false,
      outcome: "unknown",
      message: error.message,
      requestId: error.requestId,
      httpStatus: error.httpStatus,
      nextAction: {
        description: "读取 Quick Note，确认写操作是否已经生效",
        command: `sharge notes get ${noteId} --json`,
      },
    });
  }
  throw error;
}

export async function runNotesUpdate(
  runtime: CliRuntime,
  noteId: string,
  options: NotesUpdateOptions,
) {
  if (!/^[1-9]\d*$/.test(noteId)) {
    throw invalidUpdate("note-id 必须是正整数。", "note-id");
  }
  const hasFlags = options.title !== undefined || options.content !== undefined;
  if (options.generateInput) {
    if (
      options.input !== undefined ||
      hasFlags ||
      options.dryRun ||
      options.json ||
      options.jq !== undefined
    ) {
      throw invalidUpdate(
        "--generate-input 必须单独使用，不能与业务输入或输出选项混用。",
        "--generate-input",
      );
    }
    const template = {
      title: "",
      content: "",
    };
    return {
      text: `${JSON.stringify(template, null, 2)}\n`,
      data: template,
    };
  }
  if (options.input !== undefined && hasFlags) {
    throw invalidUpdate("业务 flags 不能与 --input 混用。", "--input");
  }
  const candidate =
    options.input !== undefined
      ? await parseJsonInput(
          runtime,
          options.input,
          "sharge notes update --help --json",
        )
      : {
          ...(options.title !== undefined ? { title: options.title } : {}),
          ...(options.content !== undefined
            ? { content: options.content }
            : {}),
        };
  const parsed = notesUpdateZodSchema.safeParse(candidate);
  if (!parsed.success) {
    throw invalidSchemaInput(candidate, parsed.error.issues[0]);
  }
  const store = await loadOrCreateSettings(runtime, {
    validateCredentials: !options.dryRun,
  });
  const resolved = resolveConfig(runtime, store, options.timezoneOverride, {
    validateCredential: !options.dryRun,
  });
  const operation = apiOperations.notesUpdate;
  const path = operation.path.replace("{note_id}", noteId);
  if (options.dryRun) {
    const plan = createDryRunPlan({
      method: operation.method,
      baseUrl: resolved.baseUrl.value,
      path,
      body: parsed.data,
      requiredScopes: operation.requiredScopes,
      sideEffects: ["update_quick_note", "update_related_calendar_events"],
      retrySafe: false,
      unverified: ["resource_exists", "resource_owned_by_current_user"],
    });
    return {
      text: renderDryRunPlanText(plan),
      data: plan,
    };
  }
  const apiKey = requireNotesApiKey(resolved);
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000);
  let response: ApiResponse<unknown>;
  try {
    response = await requestNotes<unknown>(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey,
      timezone: resolved.timezone.value,
      operation,
      path,
      body: parsed.data,
      deadline,
    });
  } catch (error) {
    recoverWriteFailure(error, noteId);
  }
  if (typeof response.data !== "object" || response.data === null) {
    throw new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      message: "Open Platform 返回了不完整的 Quick Note 更新响应。",
      requestId: response.requestId,
      httpStatus: response.httpStatus,
      nextAction: {
        description: "读取 Quick Note，确认更新结果",
        command: `sharge notes get ${noteId} --json`,
      },
    });
  }
  const note = response.data as Record<string, unknown>;
  const title =
    typeof note.title === "string" && note.title.length > 0
      ? note.title
      : "（无标题）";
  return {
    text: `已更新 Quick Note #${noteId}：${title}\n`,
    data: response.data,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}

type NotesDeleteOptions = {
  yes: boolean;
  dryRun: boolean;
  timeoutMs?: number;
  timezoneOverride?: string;
};

export async function runNotesDelete(
  runtime: CliRuntime,
  noteId: string,
  options: NotesDeleteOptions,
) {
  if (!/^[1-9]\d*$/.test(noteId)) {
    throw invalidUpdate("note-id 必须是正整数。", "note-id");
  }
  if (!options.dryRun && !options.yes) {
    throw new CliFailure({
      type: "INVALID_INPUT",
      exitCode: 2,
      field: "--yes",
      message: "真实删除 Quick Note 必须显式提供 --yes。",
      nextAction: {
        description: "确认不可恢复的删除操作",
        command: `sharge notes delete ${noteId} --yes --json`,
      },
    });
  }
  const store = await loadOrCreateSettings(runtime, {
    validateCredentials: !options.dryRun,
  });
  const resolved = resolveConfig(runtime, store, options.timezoneOverride, {
    validateCredential: !options.dryRun,
  });
  const operation = apiOperations.notesDelete;
  const path = operation.path.replace("{note_id}", noteId);
  if (options.dryRun) {
    const plan = createDryRunPlan({
      method: operation.method,
      baseUrl: resolved.baseUrl.value,
      path,
      body: null,
      requiredScopes: operation.requiredScopes,
      sideEffects: ["delete_quick_note", "delete_related_calendar_events"],
      retrySafe: false,
      unverified: ["resource_exists", "resource_owned_by_current_user"],
    });
    return {
      text: renderDryRunPlanText(plan),
      data: plan,
    };
  }
  const apiKey = requireNotesApiKey(resolved);
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000);
  let response: ApiResponse<null>;
  try {
    response = await requestNotes<null>(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey,
      timezone: resolved.timezone.value,
      operation,
      path,
      deadline,
    });
  } catch (error) {
    recoverWriteFailure(error, noteId);
  }
  if (response.data !== null) {
    throw new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      message: "Open Platform 返回了不完整的 Quick Note 删除响应。",
      requestId: response.requestId,
      httpStatus: response.httpStatus,
      nextAction: {
        description: "读取 Quick Note，确认删除结果",
        command: `sharge notes get ${noteId} --json`,
      },
    });
  }
  return {
    text: `已删除 Quick Note #${noteId}。\n`,
    data: null,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}
