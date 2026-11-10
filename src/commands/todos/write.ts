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
import { requestCalendar, requireCalendarApiKey } from "../calendar/request.js";
import {
  todoChanged,
  todoId,
  todoInputs,
  todoReceipt,
} from "./input-contract.js";
import { invalidTodo } from "./read.js";

type Action = "create" | "update" | "complete" | "delete";
export type TodoWriteOptions = {
  input?: string;
  title?: string;
  startTime?: string;
  clearStartTime: boolean;
  timezone?: string;
  ids: string[];
  completed?: string;
  generateInput: boolean;
  dryRun: boolean;
  json: boolean;
  jq?: string;
  yes: boolean;
  timeoutMs?: number;
  timezoneOverride?: string;
};
const operations = {
  create: apiOperations.todosCreate,
  update: apiOperations.todosUpdate,
  complete: apiOperations.todosComplete,
  delete: apiOperations.todosDelete,
};

/** A submitted write is never replayed. Unknown outcomes expose explicit read commands. */
function unknownWrite(
  action: Action,
  ids: string[],
  error: {
    type?: CliFailure["type"];
    message: string;
    requestId?: string | null;
    httpStatus?: number | null;
  },
): CliFailure {
  return new CliFailure({
    type: error.type ?? "SERVER_ERROR",
    exitCode: 8,
    retryable: false,
    outcome: "unknown",
    message: error.message,
    requestId: error.requestId,
    httpStatus: error.httpStatus,
    nextAction: {
      description: "先读取待办确认写操作是否生效，不自动重发",
      command:
        action === "create"
          ? "sharge todos list --json"
          : ids.map((id) => `sharge todos get ${id} --json`).join("; "),
    },
  });
}
export async function runTodosWrite(
  runtime: CliRuntime,
  action: Action,
  id: string | undefined,
  options: TodoWriteOptions,
) {
  if (action === "update" && !todoId.safeParse(id).success)
    throw invalidTodo(
      action,
      "待办 ID 必须是 1..18446744073709551615 的十进制字符串。",
      "todo-id",
    );
  const hasBusiness =
    options.title !== undefined ||
    options.startTime !== undefined ||
    options.clearStartTime ||
    options.ids.length > 0 ||
    options.completed !== undefined;
  if (options.generateInput) {
    if (
      options.input !== undefined ||
      hasBusiness ||
      options.dryRun ||
      options.json ||
      options.jq !== undefined
    )
      throw invalidTodo(
        action,
        "--generate-input 必须单独使用。",
        "--generate-input",
      );
    const template =
      action === "create"
        ? { title: "" }
        : action === "update"
          ? { title: "", start_time: null }
          : action === "complete"
            ? { ids: ["123"], completed: true }
            : { ids: ["123"] };
    return { data: template, text: `${JSON.stringify(template, null, 2)}\n` };
  }
  if (options.input !== undefined && hasBusiness)
    throw invalidTodo(action, "业务 flags 不能与 --input 混用。", "--input");
  if (options.startTime !== undefined && options.clearStartTime)
    throw invalidTodo(
      action,
      "--start-time 与 --clear-start-time 不能同时使用。",
    );
  const candidate =
    options.input !== undefined
      ? await parseJsonInput(
          runtime,
          options.input,
          `sharge todos ${action} --help --json`,
        )
      : action === "complete" || action === "delete"
        ? {
            ids: options.ids,
            ...(action === "complete"
              ? {
                  completed:
                    options.completed === "true"
                      ? true
                      : options.completed === "false"
                        ? false
                        : undefined,
                }
              : {}),
          }
        : {
            ...(options.title !== undefined ? { title: options.title } : {}),
            ...(options.startTime !== undefined
              ? { start_time: options.startTime }
              : options.clearStartTime
                ? { start_time: null }
                : {}),
            ...(action === "create" && options.timezone !== undefined
              ? { timezone: options.timezone }
              : {}),
          };
  const parsed = todoInputs[action].safeParse(candidate);
  if (!parsed.success)
    throw invalidTodo(
      action,
      `${parsed.error.issues[0].message}；ID 必须写成十进制字符串，不转成 Number。`,
      options.input !== undefined ? "--input" : undefined,
    );
  const body = parsed.data;
  // A null start on creation means the same as omitting it; PATCH preserves null.
  if (action === "create" && "start_time" in body && body.start_time === null)
    delete body.start_time;
  if (action === "delete" && !options.dryRun && !options.yes)
    throw invalidTodo(action, "真实删除待办必须显式提供 --yes。", "--yes");
  const store = await loadOrCreateSettings(runtime, {
    validateCredentials: !options.dryRun,
  });
  const resolved = resolveConfig(runtime, store, options.timezoneOverride, {
    validateCredential: !options.dryRun,
  });
  const operation = operations[action];
  const path = operation.path.replace("{id}", id ?? "");
  if (options.dryRun) {
    const plan = createDryRunPlan({
      method: operation.method,
      baseUrl: resolved.baseUrl.value,
      path,
      body,
      requiredScopes: operation.requiredScopes,
      sideEffects: [`${action}_todos`],
      retrySafe: false,
      unverified: ["resource_exists", "resource_owned_by_current_user"],
    });
    return { data: plan, text: renderDryRunPlanText(plan) };
  }
  const recoveryIds = "ids" in body ? body.ids : id ? [id] : [];
  let response: ApiResponse<unknown>;
  try {
    response = await requestCalendar<unknown>(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey: requireCalendarApiKey(resolved),
      timezone: resolved.timezone.value,
      operation,
      path,
      body,
      integerIds: action === "complete" || action === "delete",
      deadline: (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000),
    });
  } catch (error) {
    if (
      error instanceof CliFailure &&
      (error.outcome === "unknown" ||
        (error.type === "SERVER_ERROR" &&
          error.httpStatus !== null &&
          error.httpStatus >= 200 &&
          error.httpStatus < 300))
    )
      throw unknownWrite(action, recoveryIds, error);
    throw error;
  }
  const receipt = (
    action === "complete" || action === "delete" ? todoChanged : todoReceipt
  ).safeParse(response.data);
  if (
    !receipt.success ||
    response.httpStatus !== (action === "create" ? 201 : 200)
  )
    throw unknownWrite(action, recoveryIds, {
      message: "Open Platform 返回了不完整的待办写入回执。",
      requestId: response.requestId,
      httpStatus: response.httpStatus,
    });
  const data = receipt.data;
  return {
    data,
    text:
      "changed_count" in data
        ? `实际变更 ${data.changed_count} 条\n`
        : `已${action === "create" ? "创建" : "更新"}待办 #${data.id}：${data.title}\n`,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}
