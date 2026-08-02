import type { ApiResponse } from "../../api/client.js";
import { apiOperations } from "../../api/operations.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";
import { shellQuote } from "../../runtime/shell.js";
import { requestNotes, requireNotesApiKey } from "./request.js";

type NotesReadOptions = {
  cursor?: string;
  limit?: string;
  createdAtStart?: string;
  createdAtEnd?: string;
  timeoutMs?: number;
  timezoneOverride?: string;
};

type NotePage = {
  items: Array<Record<string, unknown>>;
  has_more: boolean;
  next_cursor: number | null;
};

function invalidOption(
  field: string,
  message: string,
  helpCommand: "list" | "search",
): CliFailure {
  return new CliFailure({
    type: "INVALID_INPUT",
    exitCode: 2,
    field,
    message,
    nextAction: {
      description: `查看 Notes ${helpCommand === "list" ? "列表" : "搜索"}输入契约`,
      command: `sharge notes ${helpCommand} --help --json`,
    },
  });
}

function validateOffsetDateTime(
  value: string | undefined,
  field: "--created-at-start" | "--created-at-end",
  helpCommand: "list" | "search",
): void {
  if (
    value !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
      Number.isNaN(Date.parse(value)))
  ) {
    throw invalidOption(
      field,
      `${field} 必须是带显式 offset 的 RFC 3339 时间。`,
      helpCommand,
    );
  }
}

function validateListOptions(
  options: NotesReadOptions,
  helpCommand: "list" | "search",
): void {
  if (options.cursor !== undefined && !/^\d+$/.test(options.cursor)) {
    throw invalidOption(
      "--cursor",
      "--cursor 必须是上一页返回的非负整数。",
      helpCommand,
    );
  }
  if (
    options.limit !== undefined &&
    (!/^[1-9]\d*$/.test(options.limit) ||
      Number(options.limit) < 1 ||
      Number(options.limit) > 100)
  ) {
    throw invalidOption(
      "--limit",
      "--limit 必须是 1–100 的整数。",
      helpCommand,
    );
  }
  validateOffsetDateTime(
    options.createdAtStart,
    "--created-at-start",
    helpCommand,
  );
  validateOffsetDateTime(options.createdAtEnd, "--created-at-end", helpCommand);
  if (
    options.createdAtStart !== undefined &&
    options.createdAtEnd !== undefined &&
    Date.parse(options.createdAtStart) > Date.parse(options.createdAtEnd)
  ) {
    throw invalidOption(
      "--created-at-start",
      "--created-at-start 不能晚于 --created-at-end。",
      helpCommand,
    );
  }
}

function parseNotePage(data: unknown): NotePage {
  if (
    typeof data !== "object" ||
    data === null ||
    !("items" in data) ||
    !Array.isArray(data.items) ||
    !data.items.every((item) => typeof item === "object" && item !== null) ||
    !("has_more" in data) ||
    typeof data.has_more !== "boolean" ||
    !("next_cursor" in data) ||
    (data.next_cursor !== null &&
      !(
        (typeof data.next_cursor === "number" &&
          Number.isInteger(data.next_cursor)) ||
        (typeof data.next_cursor === "string" && /^\d+$/.test(data.next_cursor))
      ))
  ) {
    throw new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      message: "Open Platform 返回了不完整的 Quick Note 分页响应。",
      nextAction: {
        description: "记录 requestId 并诊断 Open Platform",
        command: "sharge doctor --json",
      },
    });
  }
  return data as NotePage;
}

function renderNotePage(
  page: NotePage,
  options: NotesReadOptions,
  searchQuery?: string,
): string {
  const lines = page.items.map((item) => {
    const id = "id" in item ? String(item.id) : "?";
    const title =
      "title" in item && typeof item.title === "string" && item.title.length > 0
        ? item.title
        : "（无标题）";
    const status = "status" in item ? String(item.status) : "unknown";
    return `#${id} ${title} [${status}]`;
  });
  if (page.has_more && page.next_cursor !== null) {
    const next: Array<string | number> =
      searchQuery === undefined
        ? ["sharge", "notes", "list"]
        : ["sharge", "notes", "search", shellQuote(searchQuery)];
    next.push("--cursor", page.next_cursor);
    if (options.limit !== undefined) {
      next.push("--limit", options.limit);
    }
    if (options.createdAtStart !== undefined) {
      next.push("--created-at-start", shellQuote(options.createdAtStart));
    }
    if (options.createdAtEnd !== undefined) {
      next.push("--created-at-end", shellQuote(options.createdAtEnd));
    }
    lines.push(`下一页：${next.join(" ")}`);
  }
  return `${lines.join("\n")}\n`;
}

async function runNotesPage(
  runtime: CliRuntime,
  options: NotesReadOptions,
  searchQuery?: string,
) {
  validateListOptions(options, searchQuery === undefined ? "list" : "search");
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, options.timezoneOverride);
  const apiKey = requireNotesApiKey(resolved);
  const query = new URLSearchParams();
  if (options.cursor !== undefined) {
    query.set("cursor", options.cursor);
  }
  if (options.limit !== undefined) {
    query.set("limit", options.limit);
  }
  if (options.createdAtStart !== undefined) {
    query.set("created_at_start", options.createdAtStart);
  }
  if (options.createdAtEnd !== undefined) {
    query.set("created_at_end", options.createdAtEnd);
  }
  if (searchQuery !== undefined) {
    query.set("search", searchQuery);
  }
  const operation = apiOperations.notesList;
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000);
  const response = await requestNotes<unknown>(runtime, {
    baseUrl: resolved.baseUrl.value,
    apiKey,
    timezone: resolved.timezone.value,
    operation,
    path: `${operation.path}${query.size > 0 ? `?${query}` : ""}`,
    deadline,
  });
  const page = parseNotePage(response.data);
  return {
    text: renderNotePage(page, options, searchQuery),
    data: response.data,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}

export async function runNotesList(
  runtime: CliRuntime,
  options: NotesReadOptions,
) {
  return await runNotesPage(runtime, options);
}

export async function runNotesSearch(
  runtime: CliRuntime,
  searchQuery: string,
  options: NotesReadOptions,
) {
  if (searchQuery.trim().length === 0) {
    throw new CliFailure({
      type: "INVALID_INPUT",
      exitCode: 2,
      field: "query",
      message: "Notes 搜索词不能为空。",
      nextAction: {
        description: "查看 Notes 搜索输入契约",
        command: "sharge notes search --help --json",
      },
    });
  }
  return await runNotesPage(runtime, options, searchQuery);
}

export async function runNotesGet(
  runtime: CliRuntime,
  noteId: string,
  options: Pick<NotesReadOptions, "timeoutMs" | "timezoneOverride">,
) {
  if (!/^[1-9]\d*$/.test(noteId)) {
    throw new CliFailure({
      type: "INVALID_INPUT",
      exitCode: 2,
      field: "note-id",
      message: "note-id 必须是正整数。",
      nextAction: {
        description: "查看 Notes 详情输入契约",
        command: "sharge notes get --help --json",
      },
    });
  }
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, options.timezoneOverride);
  const apiKey = requireNotesApiKey(resolved);
  const operation = apiOperations.notesGet;
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000);
  let response: ApiResponse<unknown>;
  try {
    response = await requestNotes<unknown>(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey,
      timezone: resolved.timezone.value,
      operation,
      path: operation.path.replace("{note_id}", noteId),
      deadline,
    });
  } catch (error) {
    if (error instanceof CliFailure && error.type === "NOT_FOUND") {
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
    throw error;
  }
  const note =
    typeof response.data === "object" && response.data !== null
      ? (response.data as Record<string, unknown>)
      : null;
  if (!note) {
    throw new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      message: "Open Platform 返回了不完整的 Quick Note 详情响应。",
      requestId: response.requestId,
      httpStatus: response.httpStatus,
      nextAction: {
        description: "记录 requestId 并诊断 Open Platform",
        command: "sharge doctor --json",
      },
    });
  }
  const title =
    typeof note.title === "string" && note.title.length > 0
      ? note.title
      : "（无标题）";
  const status = "status" in note ? String(note.status) : "unknown";
  const content = typeof note.content === "string" ? note.content : "";
  return {
    text: `#${noteId} ${title} [${status}]\n${content}\n`,
    data: response.data,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}
