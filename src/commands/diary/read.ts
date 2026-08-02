import type { ApiResponse } from "../../api/client.js";
import { apiOperations } from "../../api/operations.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";
import { requestDiary, requireDiaryApiKey } from "./request.js";

type Options = { timeoutMs?: number; timezoneOverride?: string };

function invalid(command: string, field: string, message: string): CliFailure {
  return new CliFailure({
    type: "INVALID_INPUT",
    exitCode: 2,
    field,
    message,
    nextAction: {
      description: "查看 Diary 输入契约",
      command: `sharge diary ${command} --help --json`,
    },
  });
}

function validDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maximum = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  return maximum !== undefined && day <= maximum;
}

async function context(runtime: CliRuntime, options: Options) {
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, options.timezoneOverride);
  return {
    resolved,
    apiKey: requireDiaryApiKey(resolved),
    deadline: (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000),
  };
}

function invalidResponse(
  response: ApiResponse<unknown>,
  label: string,
): CliFailure {
  return new CliFailure({
    type: "SERVER_ERROR",
    exitCode: 8,
    message: `Open Platform 返回了不完整的 ${label}。`,
    requestId: response.requestId,
    httpStatus: response.httpStatus,
    nextAction: {
      description: "记录 requestId 并诊断 Open Platform",
      command: "sharge doctor --json",
    },
  });
}

function array(response: ApiResponse<unknown>): Array<Record<string, unknown>> {
  if (
    !Array.isArray(response.data) ||
    !response.data.every(
      (item) =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    )
  )
    throw invalidResponse(response, "Diary 列表响应");
  return response.data as Array<Record<string, unknown>>;
}

function text(items: Array<Record<string, unknown>>): string {
  return `${items.length ? items.map((item) => `${String(item.identifier)} ${String(item.title ?? "")}`).join("\n") : "没有日记。"}\n`;
}

export async function runDiaryList(
  runtime: CliRuntime,
  monthValue: string,
  options: Options,
) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || year < 1900 || year > 9999 || month < 1 || month > 12)
    throw invalid(
      "list",
      "month",
      "month 必须是 1900-01 到 9999-12 的 YYYY-MM。",
    );
  const { resolved, apiKey, deadline } = await context(runtime, options);
  const operation = apiOperations.diaryList;
  const response = await requestDiary<unknown>(runtime, {
    baseUrl: resolved.baseUrl.value,
    apiKey,
    timezone: resolved.timezone.value,
    deadline,
    operation,
    path: `${operation.path}?year=${year}&month=${month}`,
  });
  const items = array(response);
  return {
    text: text(items),
    data: items,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}

export async function runDiarySearch(
  runtime: CliRuntime,
  keyword: string,
  limit: string | undefined,
  options: Options,
) {
  const normalized = keyword.trim();
  if (!normalized || [...normalized].length > 200)
    throw invalid("search", "keyword", "keyword 长度必须是 1–200。");
  if (limit !== undefined && (!/^[1-9]\d*$/.test(limit) || Number(limit) > 100))
    throw invalid("search", "--limit", "--limit 必须是 1–100 的整数。");
  const { resolved, apiKey, deadline } = await context(runtime, options);
  const operation = apiOperations.diarySearch;
  const query = new URLSearchParams({
    keyword: normalized,
    limit: limit ?? "20",
  });
  const response = await requestDiary<unknown>(runtime, {
    baseUrl: resolved.baseUrl.value,
    apiKey,
    timezone: resolved.timezone.value,
    deadline,
    operation,
    path: `${operation.path}?${query}`,
  });
  const items = array(response);
  return {
    text: text(items),
    data: items,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}

export async function runDiaryGet(
  runtime: CliRuntime,
  identifier: string,
  options: Options,
) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(identifier);
  if (
    !match ||
    !validDate(Number(match[1]), Number(match[2]), Number(match[3]))
  )
    throw invalid(
      "get",
      "identifier",
      "identifier 必须是真实的 YYYYMMDD 日期。",
    );
  const { resolved, apiKey, deadline } = await context(runtime, options);
  const operation = apiOperations.diaryGet;
  let response: ApiResponse<unknown>;
  try {
    response = await requestDiary<unknown>(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey,
      timezone: resolved.timezone.value,
      deadline,
      operation,
      path: operation.path
        .replace("{report_type}", "daily")
        .replace("{identifier}", identifier),
    });
  } catch (error) {
    if (error instanceof CliFailure && error.type === "NOT_FOUND")
      throw new CliFailure({
        type: "NOT_FOUND",
        exitCode: 5,
        message: error.message,
        requestId: error.requestId,
        httpStatus: error.httpStatus,
        nextAction: {
          description: "列出该月日记",
          command: `sharge diary list ${identifier.slice(0, 4)}-${identifier.slice(4, 6)} --json`,
        },
      });
    throw error;
  }
  const raw = response.data as Record<string, unknown> | null;
  if (
    typeof response.data !== "object" ||
    response.data === null ||
    Array.isArray(response.data) ||
    raw?.report_type !== "daily" ||
    raw.identifier !== identifier
  )
    throw invalidResponse(response, "Daily Diary 响应");
  const data = response.data as Record<string, unknown>;
  return {
    text: `${String(data.title ?? identifier)}\n`,
    data,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}
