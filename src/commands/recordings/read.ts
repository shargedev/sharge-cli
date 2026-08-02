import type { ApiResponse } from "../../api/client.js";
import { apiOperations } from "../../api/operations.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";
import { requestRecordings, requireRecordingsApiKey } from "./request.js";

export type RecordingsListOptions = {
  cursor?: string;
  pageSize?: string;
  direction?: string;
  startDate?: string;
  endDate?: string;
  recordingType?: string;
  sortBy?: string;
  sortOrder?: string;
  timeoutMs?: number;
  timezoneOverride?: string;
};

export type RecordingsSearchOptions = {
  limit?: string;
  recordingType?: string;
  language?: string;
  summaryTemplateId?: string;
  timeoutMs?: number;
  timezoneOverride?: string;
};

type RecordingPage = {
  items: Array<Record<string, unknown>>;
  next_cursor: number | string | null;
  prev_cursor: number | string | null;
  has_more: boolean;
};

function invalid(
  command: "list" | "search" | "get",
  field: string,
  message: string,
): CliFailure {
  return new CliFailure({
    type: "INVALID_INPUT",
    exitCode: 2,
    field,
    message,
    nextAction: {
      description: "查看 Recordings 读取输入契约",
      command: `sharge recordings ${command} --help --json`,
    },
  });
}

function validatePositiveInteger(
  value: string | undefined,
  field: "--cursor" | "--page-size",
  maximum?: number,
): void {
  if (
    value !== undefined &&
    (!/^[1-9]\d*$/.test(value) ||
      (maximum !== undefined && Number(value) > maximum))
  ) {
    throw invalid(
      "list",
      field,
      maximum === undefined
        ? `${field} 必须是正整数。`
        : `${field} 必须是 1–${maximum} 的整数。`,
    );
  }
}

function validateDate(
  value: string | undefined,
  field: "--start-date" | "--end-date",
): void {
  if (value === undefined) return;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth =
    match === null
      ? 0
      : [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
          month - 1
        ];
  if (
    match === null ||
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    daysInMonth === undefined ||
    day > daysInMonth
  ) {
    throw invalid("list", field, `${field} 必须是真实的 YYYY-MM-DD 日期。`);
  }
}

function requirePage(response: ApiResponse<unknown>): RecordingPage {
  const data = response.data;
  const cursor = (value: unknown) =>
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && value > 0) ||
    (typeof value === "string" && /^[1-9]\d*$/.test(value));
  if (
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data) ||
    !("items" in data) ||
    !Array.isArray(data.items) ||
    !data.items.every(
      (item) =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    ) ||
    !("next_cursor" in data) ||
    !cursor(data.next_cursor) ||
    !("prev_cursor" in data) ||
    !cursor(data.prev_cursor) ||
    !("has_more" in data) ||
    typeof data.has_more !== "boolean"
  ) {
    throw new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      message: "Open Platform 返回了不完整的 Recordings 分页响应。",
      requestId: response.requestId,
      httpStatus: response.httpStatus,
      nextAction: {
        description: "记录 requestId 并诊断 Open Platform",
        command: "sharge doctor --json",
      },
    });
  }
  return data as RecordingPage;
}

function line(item: Record<string, unknown>): string {
  const id = "recording_id" in item ? String(item.recording_id) : "?";
  const title =
    typeof item.title === "string" && item.title.length > 0
      ? item.title
      : "（无标题）";
  const type =
    typeof item.recording_type === "string" ? item.recording_type : "unknown";
  return `#${id} ${title} [${type}]`;
}

export async function runRecordingsList(
  runtime: CliRuntime,
  options: RecordingsListOptions,
) {
  validatePositiveInteger(options.cursor, "--cursor");
  validatePositiveInteger(options.pageSize, "--page-size", 50);
  validateDate(options.startDate, "--start-date");
  validateDate(options.endDate, "--end-date");
  if (
    options.startDate !== undefined &&
    options.endDate !== undefined &&
    options.startDate > options.endDate
  ) {
    throw invalid("list", "--start-date", "--start-date 不能晚于 --end-date。");
  }
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, options.timezoneOverride);
  const apiKey = requireRecordingsApiKey(resolved);
  const operation = apiOperations.recordingsList;
  const query = new URLSearchParams();
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  query.set("page_size", options.pageSize ?? "20");
  query.set("direction", options.direction ?? "forward");
  if (options.startDate !== undefined)
    query.set("start_date", options.startDate);
  if (options.endDate !== undefined) query.set("end_date", options.endDate);
  query.set("timezone", resolved.timezone.value);
  if (options.recordingType !== undefined)
    query.set("recording_type", options.recordingType);
  query.set("sort_by", options.sortBy ?? "timestamp");
  query.set("sort_order", options.sortOrder ?? "desc");
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000);
  const response = await requestRecordings<unknown>(runtime, {
    baseUrl: resolved.baseUrl.value,
    apiKey,
    timezone: resolved.timezone.value,
    deadline,
    operation,
    path: `${operation.path}?${query}`,
  });
  const page = requirePage(response);
  const lines = page.items.map(line);
  const direction = options.direction ?? "forward";
  const continuationCursor =
    direction === "backward" ? page.prev_cursor : page.next_cursor;
  if (page.has_more && continuationCursor !== null) {
    const next = [
      "sharge recordings list",
      `--cursor ${String(continuationCursor)}`,
      `--page-size ${options.pageSize ?? "20"}`,
      `--direction ${direction}`,
    ];
    if (options.startDate !== undefined)
      next.push(`--start-date ${options.startDate}`);
    if (options.endDate !== undefined)
      next.push(`--end-date ${options.endDate}`);
    if (options.recordingType !== undefined)
      next.push(`--recording-type ${options.recordingType}`);
    next.push(`--sort-by ${options.sortBy ?? "timestamp"}`);
    next.push(`--sort-order ${options.sortOrder ?? "desc"}`);
    next.push(`--timezone ${resolved.timezone.value}`);
    next.push("--json");
    lines.push(`下一页：${next.join(" ")}`);
  }
  return {
    text: `${lines.length > 0 ? lines.join("\n") : "没有录音。"}\n`,
    data: response.data,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}

function requireSearch(
  response: ApiResponse<unknown>,
): Array<Record<string, unknown>> {
  if (
    !Array.isArray(response.data) ||
    !response.data.every(
      (item) =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    )
  ) {
    throw new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      message: "Open Platform 返回了不完整的 Recordings 搜索响应。",
      requestId: response.requestId,
      httpStatus: response.httpStatus,
      nextAction: {
        description: "记录 requestId 并诊断 Open Platform",
        command: "sharge doctor --json",
      },
    });
  }
  return response.data as Array<Record<string, unknown>>;
}

function requireDetail(
  response: ApiResponse<unknown>,
): Record<string, unknown> {
  const data = response.data;
  if (
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data) ||
    !("transcript" in data) ||
    typeof data.transcript !== "object" ||
    data.transcript === null ||
    Array.isArray(data.transcript) ||
    !("overviews" in data) ||
    typeof data.overviews !== "object" ||
    data.overviews === null ||
    Array.isArray(data.overviews) ||
    !("speaker_map" in data) ||
    typeof data.speaker_map !== "object" ||
    data.speaker_map === null ||
    Array.isArray(data.speaker_map) ||
    !("highlights" in data) ||
    !Array.isArray(data.highlights)
  ) {
    throw new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      message: "Open Platform 返回了不完整的 Recordings 详情响应。",
      requestId: response.requestId,
      httpStatus: response.httpStatus,
      nextAction: {
        description: "记录 requestId 并诊断 Open Platform",
        command: "sharge doctor --json",
      },
    });
  }
  return data;
}

export async function runRecordingsSearch(
  runtime: CliRuntime,
  keyword: string,
  options: RecordingsSearchOptions,
) {
  const normalizedKeyword = keyword.trim();
  if (normalizedKeyword.length === 0) {
    throw invalid("search", "keyword", "Recordings 搜索词不能为空。");
  }
  if (
    options.limit !== undefined &&
    (!/^[1-9]\d*$/.test(options.limit) || Number(options.limit) > 50)
  ) {
    throw invalid("search", "--limit", "--limit 必须是 1–50 的整数。");
  }
  if (options.language !== undefined && options.language.trim().length === 0) {
    throw invalid("search", "--language", "--language 不能为空。");
  }
  if (
    options.summaryTemplateId !== undefined &&
    options.summaryTemplateId.trim().length === 0
  ) {
    throw invalid(
      "search",
      "--summary-template-id",
      "--summary-template-id 不能为空。",
    );
  }
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, options.timezoneOverride);
  const apiKey = requireRecordingsApiKey(resolved);
  const operation = apiOperations.recordingsSearch;
  const query = new URLSearchParams({
    keyword: normalizedKeyword,
    limit: options.limit ?? "20",
  });
  if (options.recordingType !== undefined) {
    query.set("recording_type", options.recordingType);
  }
  if (options.language !== undefined) {
    query.set("language", options.language.trim());
  }
  if (options.summaryTemplateId !== undefined) {
    query.set("summary_template_id", options.summaryTemplateId.trim());
  }
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000);
  const response = await requestRecordings<unknown>(runtime, {
    baseUrl: resolved.baseUrl.value,
    apiKey,
    timezone: resolved.timezone.value,
    deadline,
    operation,
    path: `${operation.path}?${query}`,
  });
  const requestedLanguage = options.language?.trim();
  const requestedTemplate = options.summaryTemplateId?.trim();
  const items = requireSearch(response).filter(
    (item) =>
      (options.recordingType === undefined ||
        item.recording_type === options.recordingType) &&
      (requestedLanguage === undefined ||
        item.language === requestedLanguage) &&
      (requestedTemplate === undefined ||
        item.summary_template_id === requestedTemplate),
  );
  return {
    text: `${
      items.length > 0 ? items.map(line).join("\n") : "没有匹配的录音。"
    }\n`,
    data: items,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}

export async function runRecordingsGet(
  runtime: CliRuntime,
  recordingId: string,
  options: Pick<RecordingsSearchOptions, "timeoutMs" | "timezoneOverride">,
) {
  if (!/^[1-9]\d*$/.test(recordingId)) {
    throw invalid("get", "recording-id", "recording-id 必须是正整数。");
  }
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, options.timezoneOverride);
  const apiKey = requireRecordingsApiKey(resolved);
  const operation = apiOperations.recordingsGet;
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000);
  let response: ApiResponse<unknown>;
  try {
    response = await requestRecordings<unknown>(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey,
      timezone: resolved.timezone.value,
      deadline,
      operation,
      path: operation.path.replace("{recording_id}", recordingId),
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
          description: "重新列出当前用户可见的录音",
          command: "sharge recordings list --json",
        },
      });
    }
    throw error;
  }
  const detail = requireDetail(response);
  return {
    text: `${line(detail)}\n`,
    data: response.data,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}
