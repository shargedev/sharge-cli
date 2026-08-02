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
import { shellQuote } from "../../runtime/shell.js";
import {
  type CalendarCreateInput,
  type CalendarUpdateInput,
  calendarCreateFieldNames,
  calendarCreateZodSchema,
  calendarUpdateFieldNames,
  calendarUpdateZodSchema,
} from "./input-contract.js";
import { requestCalendar, requireCalendarApiKey } from "./request.js";

export type CalendarWriteOptions = {
  input?: string;
  title?: string;
  description?: string;
  location?: string;
  eventTimezone?: string;
  type?: string;
  startTime?: string;
  endTime?: string;
  isAllDay?: string;
  rrule?: string;
  enableAlarm?: string;
  triggerSeconds?: string;
  triggerDescription?: string;
  action?: string;
  instanceId?: string;
  generateInput: boolean;
  dryRun: boolean;
  json: boolean;
  jq?: string;
  timeoutMs?: number;
  timezoneOverride?: string;
};

const flagByField: Record<string, string> = {
  title: "--title",
  description: "--description",
  location: "--location",
  timezone: "--event-timezone",
  type: "--type",
  start_time: "--start-time",
  end_time: "--end-time",
  is_all_day: "--is-all-day",
  rrule: "--rrule",
  enable_alarm: "--enable-alarm",
  trigger_seconds: "--trigger-seconds",
  trigger_description: "--trigger-description",
  action: "--action",
  instance_id: "--instance-id",
};

function invalidWrite(
  command: "create" | "update",
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
      description: "查看 Calendar 写入输入契约",
      command: `sharge calendar ${command} --help --json`,
    },
  });
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function inputPath(parts: PropertyKey[]): string {
  let path = "$";
  for (const part of parts) {
    path += typeof part === "number" ? `[${part}]` : `.${String(part)}`;
  }
  return path;
}

function valueAtPath(value: unknown, parts: PropertyKey[]): unknown {
  let current = value;
  for (const part of parts) {
    if (
      current === null ||
      typeof current !== "object" ||
      typeof part === "symbol"
    ) {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

function schemaFailure(
  command: "create" | "update",
  candidate: unknown,
  issue: z.core.$ZodIssue,
): CliFailure {
  if (issue.code === "unrecognized_keys") {
    const key = issue.keys[0] ?? "unknown";
    const actual =
      candidate !== null && typeof candidate === "object"
        ? (candidate as Record<string, unknown>)[key]
        : candidate;
    return invalidWrite(command, `--input 包含未知字段：${key}`, "--input", {
      path: inputPath([key]),
      expected: `known fields: ${
        command === "create"
          ? calendarCreateFieldNames.join(", ")
          : calendarUpdateFieldNames.join(", ")
      }`,
      actual: valueType(actual),
    });
  }
  const firstPath = issue.path[0];
  const field =
    typeof firstPath === "string"
      ? (flagByField[firstPath] ?? "--input")
      : "--input";
  const missing =
    issue.code === "invalid_type" &&
    valueAtPath(candidate, issue.path) === undefined;
  return invalidWrite(
    command,
    missing
      ? `完整 Calendar ${command === "update" ? "PUT" : "输入"}缺少字段：${String(firstPath)}`
      : issue.message,
    command === "update" && missing ? "--input" : field,
    {
      path: inputPath(issue.path),
      expected:
        issue.code === "invalid_type" ? String(issue.expected) : issue.message,
      actual: valueType(valueAtPath(candidate, issue.path)),
    },
  );
}

function parseBoolean(
  command: "create" | "update",
  flag: string,
  value: string | undefined,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw invalidWrite(command, `${flag} 只接受 true 或 false。`, flag);
}

function parseInteger(
  command: "create" | "update",
  flag: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(value)) {
    throw invalidWrite(command, `${flag} 必须是整数。`, flag);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw invalidWrite(command, `${flag} 超出安全整数范围。`, flag);
  }
  return parsed;
}

function hasBusinessFlags(options: CalendarWriteOptions): boolean {
  return [
    options.title,
    options.description,
    options.location,
    options.eventTimezone,
    options.type,
    options.startTime,
    options.endTime,
    options.isAllDay,
    options.rrule,
    options.enableAlarm,
    options.triggerSeconds,
    options.triggerDescription,
    options.action,
    options.instanceId,
  ].some((value) => value !== undefined);
}

function candidateFromFlags(
  command: "create" | "update",
  options: CalendarWriteOptions,
): Record<string, unknown> {
  const base = {
    title: options.title,
    description: options.description ?? null,
    location: options.location ?? null,
    timezone: options.eventTimezone ?? null,
    type: options.type ?? "event",
    start_time: options.startTime,
    end_time: options.endTime ?? null,
    is_all_day:
      parseBoolean(command, "--is-all-day", options.isAllDay) ?? false,
    rrule: options.rrule ?? null,
    enable_alarm:
      parseBoolean(command, "--enable-alarm", options.enableAlarm) ?? null,
    trigger_seconds:
      parseInteger(command, "--trigger-seconds", options.triggerSeconds) ?? 0,
    trigger_description: options.triggerDescription ?? null,
  };
  return command === "create"
    ? base
    : {
        ...base,
        action: options.action ?? "all",
        instance_id: options.instanceId ?? null,
      };
}

function template(command: "create" | "update") {
  const create = {
    title: "",
    description: null,
    location: null,
    timezone: null,
    type: "event",
    start_time: "",
    end_time: null,
    is_all_day: false,
    rrule: null,
    enable_alarm: null,
    trigger_seconds: 0,
    trigger_description: null,
  };
  return command === "create"
    ? create
    : { ...create, action: "all", instance_id: null };
}

async function resolveInput(
  runtime: CliRuntime,
  command: "create" | "update",
  options: CalendarWriteOptions,
): Promise<CalendarCreateInput | CalendarUpdateInput> {
  if (options.input !== undefined && hasBusinessFlags(options)) {
    throw invalidWrite(command, "业务 flags 不能与 --input 混用。", "--input");
  }
  const candidate =
    options.input === undefined
      ? candidateFromFlags(command, options)
      : await parseJsonInput(
          runtime,
          options.input,
          `sharge calendar ${command} --help --json`,
        );
  const result =
    command === "create"
      ? calendarCreateZodSchema.safeParse(candidate)
      : calendarUpdateZodSchema.safeParse(candidate);
  if (!result.success) {
    throw schemaFailure(command, candidate, result.error.issues[0]);
  }
  return result.data;
}

function validateGenerateInput(
  command: "create" | "update",
  options: CalendarWriteOptions,
) {
  if (
    options.input !== undefined ||
    hasBusinessFlags(options) ||
    options.dryRun ||
    options.json ||
    options.jq !== undefined
  ) {
    throw invalidWrite(
      command,
      "--generate-input 必须单独使用，不能与业务输入或输出选项混用。",
      "--generate-input",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireWriteResponse(
  command: "create" | "update",
  response: ApiResponse<unknown>,
): Record<string, unknown> {
  const valid =
    isRecord(response.data) &&
    (command === "create"
      ? "id" in response.data
      : (response.data.action === "all" ||
          response.data.action === "instance" ||
          response.data.action === "future") &&
        Array.isArray(response.data.created_events) &&
        Array.isArray(response.data.updated_events) &&
        Array.isArray(response.data.deleted_events));
  if (!valid) {
    throw new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      message: `Open Platform 返回了不完整的 Calendar ${command} 响应。`,
      requestId: response.requestId,
      httpStatus: response.httpStatus,
      nextAction: {
        description: "记录 requestId 并诊断 Open Platform",
        command: "sharge doctor --json",
      },
    });
  }
  return response.data as Record<string, unknown>;
}

function recoverWriteFailure(
  error: unknown,
  options: { title: string },
): never {
  if (!(error instanceof CliFailure)) throw error;
  if (
    (error.type === "TIMEOUT" || error.type === "NETWORK_ERROR") &&
    error.outcome === "unknown"
  ) {
    const nextCommand = `sharge calendar search ${shellQuote(options.title)} --json`;
    throw new CliFailure({
      type: error.type,
      exitCode: error.exitCode,
      retryable: false,
      outcome: "unknown",
      message: error.message,
      requestId: error.requestId,
      httpStatus: error.httpStatus,
      nextAction: {
        description: "先读取 Calendar，确认写操作是否已经生效",
        command: nextCommand,
      },
    });
  }
  throw error;
}

async function runCalendarWrite(
  runtime: CliRuntime,
  command: "create" | "update",
  eventId: string | undefined,
  options: CalendarWriteOptions,
) {
  if (command === "update" && !/^[1-9]\d*$/.test(eventId ?? "")) {
    throw invalidWrite("update", "event-id 必须是正整数。", "event-id");
  }
  if (options.generateInput) {
    validateGenerateInput(command, options);
    const data = template(command);
    return { text: `${JSON.stringify(data, null, 2)}\n`, data };
  }
  const input = await resolveInput(runtime, command, options);
  const store = await loadOrCreateSettings(runtime, {
    validateCredentials: !options.dryRun,
  });
  const resolved = resolveConfig(runtime, store, options.timezoneOverride, {
    validateCredential: !options.dryRun,
  });
  const operation =
    command === "create"
      ? apiOperations.calendarCreate
      : apiOperations.calendarUpdate;
  const path =
    command === "create"
      ? operation.path
      : operation.path.replace("{event_id}", eventId as string);
  if (options.dryRun) {
    const plan = createDryRunPlan({
      method: operation.method,
      baseUrl: resolved.baseUrl.value,
      path,
      body: input,
      requiredScopes: operation.requiredScopes,
      sideEffects:
        command === "create"
          ? [
              "create_calendar_item",
              "create_calendar_instances",
              "schedule_calendar_alarm",
            ]
          : [
              "update_calendar_item",
              "update_calendar_instances",
              "reschedule_calendar_alarm",
            ],
      retrySafe: false,
      unverified:
        command === "create"
          ? ["calendar_business_rules"]
          : [
              "resource_exists",
              "resource_owned_by_current_user",
              "instance_exists_when_required",
              "calendar_business_rules",
            ],
    });
    return { text: renderDryRunPlanText(plan), data: plan };
  }
  const apiKey = requireCalendarApiKey(resolved);
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000);
  let response: ApiResponse<unknown>;
  try {
    response = await requestCalendar<unknown>(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey,
      timezone: resolved.timezone.value,
      operation,
      path,
      body: input,
      deadline,
    });
  } catch (error) {
    recoverWriteFailure(error, {
      title: input.title,
    });
  }
  const data = requireWriteResponse(command, response);
  const text =
    command === "create"
      ? `已创建 Calendar #${String(data.id)}：${String(data.title ?? "（无标题）")}\n`
      : renderUpdateText(data);
  return {
    text,
    data: response.data,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}

function renderUpdateText(data: Record<string, unknown>): string {
  const ids = (field: string): string => {
    const items = data[field];
    if (!Array.isArray(items)) return "无";
    const values = items
      .filter((item) => isRecord(item) && "id" in item)
      .map((item) => `#${String(item.id)}`);
    return values.length > 0 ? values.join(",") : "无";
  };
  return `Calendar 更新完成（范围=${String(data.action)}）：新建=${ids("created_events")}；更新=${ids("updated_events")}；删除=${ids("deleted_events")}。\n`;
}

export async function runCalendarCreate(
  runtime: CliRuntime,
  options: CalendarWriteOptions,
) {
  return runCalendarWrite(runtime, "create", undefined, options);
}

export async function runCalendarUpdate(
  runtime: CliRuntime,
  eventId: string,
  options: CalendarWriteOptions,
) {
  return runCalendarWrite(runtime, "update", eventId, options);
}
