import type { ApiResponse } from "../../api/client.js";
import { apiOperations } from "../../api/operations.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import {
  createDryRunPlan,
  renderDryRunPlanText,
} from "../../runtime/dry-run.js";
import { CliFailure } from "../../runtime/errors.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";
import { shellQuote } from "../../runtime/shell.js";
import { requestCalendar, requireCalendarApiKey } from "./request.js";

type DeleteOptions = {
  type?: string;
  instanceId?: string;
  yes: boolean;
  dryRun: boolean;
  timeoutMs?: number;
  timezoneOverride?: string;
};

function invalid(
  command: "delete",
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

function unknownOutcome(error: unknown, eventId: string): never {
  if (!(error instanceof CliFailure)) throw error;
  if (error.outcome === "unknown") {
    throw new CliFailure({
      type: error.type,
      exitCode: error.exitCode,
      retryable: false,
      outcome: "unknown",
      message: error.message,
      requestId: error.requestId,
      httpStatus: error.httpStatus,
      nextAction: {
        description: "读取日程，确认写操作是否已经生效",
        command: `sharge calendar get ${eventId} --json`,
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
    unknownOutcome(error, eventId);
  }
  const data = requireUpdateResult(response, "delete ");
  return {
    text: updateResultText("Calendar 删除完成", data),
    data: response.data,
    meta: meta(response, resolved),
  };
}
