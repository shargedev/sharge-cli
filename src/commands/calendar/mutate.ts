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
  type CalendarTodoStatusInput,
  calendarTodoStatusZodSchema,
} from "./input-contract.js";
import { requestCalendar, requireCalendarApiKey } from "./request.js";

type DeleteOptions = {
  type?: string;
  instanceId?: string;
  yes: boolean;
  dryRun: boolean;
  timeoutMs?: number;
  timezoneOverride?: string;
};

type TodoStatusOptions = {
  eventIds: string[];
  status?: string;
  input?: string;
  generateInput: boolean;
  dryRun: boolean;
  json: boolean;
  jq?: string;
  timeoutMs?: number;
  timezoneOverride?: string;
};

function invalid(
  command: "delete" | "todos set-status",
  field: string,
  message: string,
  details: { path?: string; expected?: string; actual?: string } = {},
): CliFailure {
  return new CliFailure({
    type: "INVALID_INPUT",
    exitCode: 2,
    field,
    ...details,
    message,
    nextAction: {
      description: "查看 Calendar 命令输入契约",
      command: `sharge calendar ${command} --help --json`,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireUpdateResult(
  response: ApiResponse<unknown>,
  label: string,
): Record<string, unknown> {
  const data = response.data;
  if (
    !isRecord(data) ||
    !["all", "instance", "future"].includes(String(data.action)) ||
    !Array.isArray(data.created_events) ||
    !Array.isArray(data.updated_events) ||
    !Array.isArray(data.deleted_events)
  ) {
    throw new CliFailure({
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
  return data;
}

function meta(
  response: ApiResponse<unknown>,
  resolved: ReturnType<typeof resolveConfig>,
) {
  return {
    requestId: response.requestId,
    timezone: resolved.timezone.value,
    clientDate: response.clientDate,
  };
}

function calendarGetRecoveryCommand(eventIds: string[]): string {
  return eventIds.length === 1
    ? `sharge calendar get ${eventIds[0]} --json`
    : `for id in ${eventIds.join(" ")}; do sharge calendar get "$id" --json; done`;
}

function unknownOutcome(error: unknown, eventIds: string[]): never {
  if (!(error instanceof CliFailure)) throw error;
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
        description:
          eventIds.length === 1
            ? "读取 Calendar item，确认写操作是否已经生效"
            : "逐个读取所有 Calendar Todo，确认批量写入是否已经生效",
        command: calendarGetRecoveryCommand(eventIds),
      },
    });
  }
  throw error;
}

function updateResultText(
  prefix: string,
  data: Record<string, unknown>,
): string {
  const ids = (field: string) => {
    const values = data[field];
    if (!Array.isArray(values)) return "无";
    const result = values
      .filter((value) => isRecord(value) && "id" in value)
      .map((value) => `#${String(value.id)}`);
    return result.length > 0 ? result.join(",") : "无";
  };
  return `${prefix}（范围=${String(data.action)}）：更新=${ids("updated_events")}；删除=${ids("deleted_events")}。\n`;
}

export async function runCalendarDelete(
  runtime: CliRuntime,
  eventId: string,
  options: DeleteOptions,
) {
  if (!/^[1-9]\d*$/.test(eventId)) {
    throw invalid("delete", "event-id", "event-id 必须是正整数。");
  }
  const type = options.type ?? "all";
  if (
    (type === "current" || type === "future") &&
    options.instanceId === undefined
  ) {
    throw invalid(
      "delete",
      "--instance-id",
      `--type ${type} 必须提供 opaque --instance-id。`,
    );
  }
  if (type === "all" && options.instanceId !== undefined) {
    throw invalid(
      "delete",
      "--instance-id",
      "--type all 不接受 --instance-id。",
    );
  }
  if (!options.dryRun && !options.yes) {
    const instanceArgument =
      options.instanceId === undefined
        ? ""
        : ` --instance-id ${shellQuote(options.instanceId)}`;
    throw new CliFailure({
      type: "INVALID_INPUT",
      exitCode: 2,
      field: "--yes",
      message: "真实删除 Calendar item 必须显式提供 --yes。",
      nextAction: {
        description: "确认不可恢复的删除操作",
        command: `sharge calendar delete ${eventId} --type ${type}${instanceArgument} --yes --json`,
      },
    });
  }
  const operation = apiOperations.calendarDelete;
  const query = new URLSearchParams({ type });
  if (options.instanceId !== undefined) {
    query.set("instance_id", options.instanceId);
  }
  const path = `${operation.path.replace("{event_id}", eventId)}?${query}`;
  const store = await loadOrCreateSettings(runtime, {
    validateCredentials: !options.dryRun,
  });
  const resolved = resolveConfig(runtime, store, options.timezoneOverride, {
    validateCredential: !options.dryRun,
  });
  if (options.dryRun) {
    const plan = createDryRunPlan({
      method: operation.method,
      baseUrl: resolved.baseUrl.value,
      path,
      body: null,
      requiredScopes: operation.requiredScopes,
      sideEffects: [
        "delete_calendar_items",
        "delete_calendar_instances",
        "cancel_calendar_alarms",
      ],
      retrySafe: false,
      unverified: [
        "resource_exists",
        "resource_owned_by_current_user",
        "instance_exists_when_required",
      ],
    });
    return { text: renderDryRunPlanText(plan), data: plan };
  }
  const apiKey = requireCalendarApiKey(resolved);
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000);
  let response: ApiResponse<unknown>;
  try {
    response = await requestCalendar(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey,
      timezone: resolved.timezone.value,
      operation,
      path,
      deadline,
    });
  } catch (error) {
    unknownOutcome(error, [eventId]);
  }
  const data = requireUpdateResult(response, "delete ");
  return {
    text: updateResultText("Calendar 删除完成", data),
    data: response.data,
    meta: meta(response, resolved),
  };
}

function normalizeFlagId(value: string): number | string {
  if (!/^[1-9]\d*$/.test(value)) {
    throw invalid(
      "todos set-status",
      "--event-id",
      "--event-id 必须是正整数。",
    );
  }
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : value;
}

function todoIssue(candidate: unknown, issue: z.core.$ZodIssue): CliFailure {
  if (issue.code === "unrecognized_keys") {
    const key = issue.keys[0] ?? "unknown";
    return invalid(
      "todos set-status",
      "--input",
      `--input 包含未知字段：${key}`,
      {
        path: `$.${key}`,
        expected: "known fields: event_ids, status",
        actual:
          candidate !== null && typeof candidate === "object"
            ? typeof (candidate as Record<string, unknown>)[key]
            : typeof candidate,
      },
    );
  }
  const key = String(issue.path[0] ?? "");
  const field = key === "status" ? "--status" : "--event-id";
  let path = "$";
  for (const part of issue.path) {
    path += typeof part === "number" ? `[${part}]` : `.${String(part)}`;
  }
  return invalid("todos set-status", field, issue.message, {
    path,
    expected:
      key === "status"
        ? "completed|uncompleted"
        : "one or more positive integer IDs",
  });
}

async function resolveTodoInput(
  runtime: CliRuntime,
  options: TodoStatusOptions,
): Promise<CalendarTodoStatusInput> {
  if (
    options.input !== undefined &&
    (options.eventIds.length > 0 || options.status !== undefined)
  ) {
    throw invalid(
      "todos set-status",
      "--input",
      "业务 flags 不能与 --input 混用。",
    );
  }
  const candidate =
    options.input !== undefined
      ? await parseJsonInput(
          runtime,
          options.input,
          "sharge calendar todos set-status --help --json",
        )
      : {
          event_ids: options.eventIds.map(normalizeFlagId),
          status: options.status,
        };
  const result = calendarTodoStatusZodSchema.safeParse(candidate);
  if (!result.success) {
    throw todoIssue(candidate, result.error.issues[0]);
  }
  return result.data;
}

function backendTodoBody(input: CalendarTodoStatusInput) {
  return input.status === "completed"
    ? { completed_ids: input.event_ids, uncompleted_ids: [] }
    : { completed_ids: [], uncompleted_ids: input.event_ids };
}

export async function runCalendarTodoSetStatus(
  runtime: CliRuntime,
  options: TodoStatusOptions,
) {
  if (options.generateInput) {
    if (
      options.input !== undefined ||
      options.eventIds.length > 0 ||
      options.status !== undefined ||
      options.dryRun ||
      options.json ||
      options.jq !== undefined
    ) {
      throw invalid(
        "todos set-status",
        "--generate-input",
        "--generate-input 必须单独使用，不能与业务输入或输出选项混用。",
      );
    }
    const data = { event_ids: [], status: "completed" };
    return { text: `${JSON.stringify(data, null, 2)}\n`, data };
  }
  const input = await resolveTodoInput(runtime, options);
  const body = backendTodoBody(input);
  const store = await loadOrCreateSettings(runtime, {
    validateCredentials: !options.dryRun,
  });
  const resolved = resolveConfig(runtime, store, options.timezoneOverride, {
    validateCredential: !options.dryRun,
  });
  const operation = apiOperations.calendarTodoStatus;
  if (options.dryRun) {
    const plan = createDryRunPlan({
      method: operation.method,
      baseUrl: resolved.baseUrl.value,
      path: operation.path,
      body,
      requiredScopes: operation.requiredScopes,
      sideEffects: ["update_calendar_todo_status"],
      retrySafe: false,
      unverified: [
        "resources_exist",
        "resources_owned_by_current_user",
        "resources_are_todos",
      ],
    });
    return { text: renderDryRunPlanText(plan), data: plan };
  }
  const apiKey = requireCalendarApiKey(resolved);
  const deadline = (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000);
  let response: ApiResponse<unknown>;
  try {
    response = await requestCalendar(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey,
      timezone: resolved.timezone.value,
      operation,
      path: operation.path,
      body,
      deadline,
    });
  } catch (error) {
    unknownOutcome(error, input.event_ids.map(String));
  }
  if (
    !isRecord(response.data) ||
    !Array.isArray(response.data.completed_ids) ||
    !Array.isArray(response.data.uncompleted_ids)
  ) {
    throw new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      message: "Open Platform 返回了不完整的 Calendar Todo 状态响应。",
      requestId: response.requestId,
      httpStatus: response.httpStatus,
      nextAction: {
        description: "逐个读取所有 Calendar Todo，确认状态",
        command: calendarGetRecoveryCommand(input.event_ids.map(String)),
      },
    });
  }
  return {
    text: `已将 ${input.event_ids.length} 个 Calendar Todo 标记为${
      input.status === "completed" ? "已完成" : "未完成"
    }。\n`,
    data: response.data,
    meta: meta(response, resolved),
  };
}
