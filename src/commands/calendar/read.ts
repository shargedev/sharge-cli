import type { ApiResponse } from "../../api/client.js";
import { apiOperations } from "../../api/operations.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";
import { requestCalendar, requireCalendarApiKey } from "./request.js";

const OFFSET_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

export type CalendarReadOptions = {
  sourceType?: string;
  timezoneOverride?: string;
  timeoutMs?: number;
};

type CalendarListOptions = CalendarReadOptions & {
  start?: string;
  end?: string;
};

type CalendarSearchOptions = CalendarReadOptions & {
  limit?: string;
};

function invalidInput(
  command: "month" | "list" | "search" | "get",
  field: string,
  message: string,
): CliFailure {
  return new CliFailure({
    type: "INVALID_INPUT",
    exitCode: 2,
    field,
    message,
    nextAction: {
      description: "查看 Calendar 读取命令输入契约",
      command: `sharge calendar ${command} --help --json`,
    },
  });
}

function validateOffsetDateTime(
  value: string | undefined,
  field: "--start" | "--end",
): asserts value is string {
  const match = value === undefined ? null : OFFSET_DATETIME.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = Number(match?.[6]);
  const offsetHour = match?.[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match?.[9] === undefined ? 0 : Number(match[9]);
  const daysInMonth =
    match === null ? 0 : new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    value === undefined ||
    match === null ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    Number.isNaN(Date.parse(value))
  ) {
    throw invalidInput(
      "list",
      field,
      `${field} 必须是带显式 offset 的 RFC 3339 时间。`,
    );
  }
}

function validateRange(options: CalendarListOptions): {
  start: string;
  end: string;
} {
  validateOffsetDateTime(options.start, "--start");
  validateOffsetDateTime(options.end, "--end");
  const startMs = Date.parse(options.start);
  const endMs = Date.parse(options.end);
  if (endMs <= startMs) {
    throw invalidInput("list", "--end", "--end 必须晚于 --start。");
  }
  if (endMs - startMs > 31 * 24 * 60 * 60 * 1_000) {
    throw invalidInput("list", "--end", "Calendar 时间范围不能超过 31 天。");
  }
  return { start: options.start, end: options.end };
}

function validateMonth(value: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    throw invalidInput("month", "month", "month 必须使用 YYYY-MM 格式。");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1970 || year > 2100 || month < 1 || month > 12) {
    throw invalidInput(
      "month",
      "month",
      "month 必须在 1970-01 到 2100-12 之间。",
    );
  }
  return { year, month };
}

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

function invalidCalendarResponse(
  response: ApiResponse<unknown>,
  label: string,
): CliFailure {
  return new CliFailure({
    type: "SERVER_ERROR",
    exitCode: 8,
    message: `Open Platform 返回了不完整的 Calendar ${label}响应。`,
    requestId: response.requestId,
    httpStatus: response.httpStatus,
    nextAction: {
      description: "记录 requestId 并诊断 Open Platform",
      command: "sharge doctor --json",
    },
  });
}

function requireRecord(
  response: ApiResponse<unknown>,
  command: "month" | "list" | "get",
): Record<string, unknown> {
  if (!isRecord(response.data)) {
    throw invalidCalendarResponse(response, `${command} `);
  }
  return response.data;
}

function requireMonth(response: ApiResponse<unknown>): Record<string, unknown> {
  const result = requireRecord(response, "month");
  if (
    !isRecord(result.dates) ||
    Object.values(result.dates).some(
      (instances) =>
        !Array.isArray(instances) || instances.some((item) => !isRecord(item)),
    ) ||
    !isRecord(result.events) ||
    Object.values(result.events).some((event) => !isRecord(event)) ||
    typeof result.has_new_instances !== "boolean"
  ) {
    throw invalidCalendarResponse(response, "月视图");
  }
  return result;
}

function requireRange(response: ApiResponse<unknown>): Record<string, unknown> {
  const result = requireRecord(response, "list");
  if (
    !Array.isArray(result.events) ||
    result.events.some((event) => !isRecord(event)) ||
    !Array.isArray(result.instances) ||
    result.instances.some((instance) => !isRecord(instance))
  ) {
    throw invalidCalendarResponse(response, "范围");
  }
  return result;
}

function requireSearch(
  response: ApiResponse<unknown>,
): Array<Record<string, unknown>> {
  const data = response.data;
  if (!Array.isArray(data) || !data.every((item) => isRecord(item))) {
    throw invalidCalendarResponse(response, "搜索");
  }
  return data as Array<Record<string, unknown>>;
}

function itemLine(item: Record<string, unknown>): string {
  const id = "id" in item ? String(item.id) : "?";
  const title =
    typeof item.title === "string" && item.title.length > 0
      ? item.title
      : "（无标题）";
  const type = typeof item.type === "string" ? item.type : "unknown";
  const start =
    typeof item.start_time === "string" ? ` ${item.start_time}` : "";
  return `#${id} ${title} [${type}]${start}`;
}

function execution(
  response: ApiResponse<unknown>,
  resolved: ReturnType<typeof resolveConfig>,
  text: string,
) {
  return {
    text: text.endsWith("\n") ? text : `${text}\n`,
    data: response.data,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}

async function calendarRequest(
  runtime: CliRuntime,
  operation: (typeof apiOperations)[
    | "calendarMonth"
    | "calendarList"
    | "calendarSearch"
    | "calendarGet"],
  path: string | ((resolved: ReturnType<typeof resolveConfig>) => string),
  options: CalendarReadOptions,
) {
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, options.timezoneOverride);
  const apiKey = requireCalendarApiKey(resolved);
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000);
  const resolvedPath = typeof path === "string" ? path : path(resolved);
  const response = await requestCalendar<unknown>(runtime, {
    baseUrl: resolved.baseUrl.value,
    apiKey,
    timezone: resolved.timezone.value,
    operation,
    path: resolvedPath,
    deadline,
  });
  return { response, resolved };
}

function appendSourceTypeQuery(
  query: URLSearchParams,
  options: CalendarReadOptions,
): void {
  if (options.sourceType !== undefined) {
    query.set("source_type", options.sourceType);
  }
}

export async function runCalendarMonth(
  runtime: CliRuntime,
  value: string,
  options: CalendarReadOptions,
) {
  const month = validateMonth(value);
  const operation = apiOperations.calendarMonth;
  const { response, resolved } = await calendarRequest(
    runtime,
    operation,
    (config) => {
      const query = new URLSearchParams({
        year: String(month.year),
        month: String(month.month),
        timezone: config.timezone.value,
      });
      appendSourceTypeQuery(query, options);
      return `${operation.path}?${query}`;
    },
    options,
  );
  const result = requireMonth(response);
  const events = Object.values(
    result.events as Record<string, Record<string, unknown>>,
  );
  return execution(
    response,
    resolved,
    events.length > 0
      ? events.map((event) => itemLine(event)).join("\n")
      : "没有 Calendar item。",
  );
}

export async function runCalendarList(
  runtime: CliRuntime,
  options: CalendarListOptions,
) {
  const range = validateRange(options);
  const operation = apiOperations.calendarList;
  const { response, resolved } = await calendarRequest(
    runtime,
    operation,
    (config) => {
      const query = new URLSearchParams({
        start: range.start,
        end: range.end,
        timezone: config.timezone.value,
      });
      appendSourceTypeQuery(query, options);
      return `${operation.path}?${query}`;
    },
    options,
  );
  const result = requireRange(response);
  const events = result.events as Array<Record<string, unknown>>;
  return execution(
    response,
    resolved,
    events.length > 0
      ? events.map((event) => itemLine(event)).join("\n")
      : "没有 Calendar item。",
  );
}

export async function runCalendarSearch(
  runtime: CliRuntime,
  keyword: string,
  options: CalendarSearchOptions,
) {
  const normalizedKeyword = keyword.trim();
  if (normalizedKeyword.length === 0) {
    throw invalidInput("search", "keyword", "Calendar 搜索词不能为空。");
  }
  if (
    options.limit !== undefined &&
    (!/^[1-9]\d*$/.test(options.limit) ||
      Number(options.limit) < 1 ||
      Number(options.limit) > 100)
  ) {
    throw invalidInput("search", "--limit", "--limit 必须是 1–100 的整数。");
  }
  const query = new URLSearchParams({ keyword: normalizedKeyword });
  if (options.sourceType !== undefined) {
    query.set("source_type", options.sourceType);
  }
  if (options.limit !== undefined) {
    query.set("limit", options.limit);
  }
  const operation = apiOperations.calendarSearch;
  const { response, resolved } = await calendarRequest(
    runtime,
    operation,
    `${operation.path}?${query}`,
    options,
  );
  const result = requireSearch(response);
  return execution(
    response,
    resolved,
    result.length > 0
      ? result.map((event) => itemLine(event)).join("\n")
      : "没有匹配的 Calendar item。",
  );
}

export async function runCalendarGet(
  runtime: CliRuntime,
  eventId: string,
  options: Pick<CalendarReadOptions, "timeoutMs" | "timezoneOverride">,
) {
  if (!/^[1-9]\d*$/.test(eventId)) {
    throw invalidInput("get", "event-id", "event-id 必须是正整数。");
  }
  const operation = apiOperations.calendarGet;
  let response: ApiResponse<unknown>;
  let resolved: ReturnType<typeof resolveConfig>;
  try {
    const result = await calendarRequest(
      runtime,
      operation,
      operation.path.replace("{event_id}", eventId),
      options,
    );
    response = result.response;
    resolved = result.resolved;
  } catch (error) {
    if (error instanceof CliFailure && error.type === "NOT_FOUND") {
      throw new CliFailure({
        type: "NOT_FOUND",
        exitCode: 5,
        message: error.message,
        requestId: error.requestId,
        httpStatus: error.httpStatus,
        nextAction: {
          description: "查看当前用户可见的正式 Calendar item",
          command: "sharge calendar list --help --json",
        },
      });
    }
    throw error;
  }
  const event = requireRecord(response, "get");
  return execution(response, resolved, itemLine(event));
}
