import { apiOperations } from "../../api/operations.js";
import { resolveConfig } from "../../runtime/config.js";
import type { CliRuntime } from "../../runtime/context.js";
import { CliFailure } from "../../runtime/errors.js";
import { loadOrCreateSettings } from "../../runtime/settings.js";
import { requestCalendar, requireCalendarApiKey } from "../calendar/request.js";
import { todoId, todoPage, todoReceipt } from "./input-contract.js";

export function invalidTodo(
  action: string,
  message: string,
  field?: string,
): CliFailure {
  return new CliFailure({
    type: "INVALID_INPUT",
    exitCode: 2,
    field,
    message,
    nextAction: {
      description: "查看待办命令输入契约",
      command: `sharge todos ${action} --help --json`,
    },
  });
}
type ReadOptions = {
  status?: string;
  limit?: string;
  cursor?: string;
  timeoutMs?: number;
  timezoneOverride?: string;
};
export async function runTodosRead(
  runtime: CliRuntime,
  action: "list" | "get",
  id: string | undefined,
  options: ReadOptions,
) {
  const operation =
    action === "list" ? apiOperations.todosList : apiOperations.todosGet;
  let path: string = operation.path;
  if (action === "get") {
    if (!todoId.safeParse(id).success)
      throw invalidTodo(
        action,
        "待办 ID 必须是 1..18446744073709551615 的十进制字符串。",
        "todo-id",
      );
    path = path.replace("{id}", id ?? "");
  } else {
    const limit = options.limit ?? "20";
    if (!/^[1-9]\d*$/.test(limit) || Number(limit) > 100)
      throw invalidTodo(action, "--limit 必须是 1–100 的整数。", "--limit");
    if (
      options.cursor !== undefined &&
      (options.cursor.length < 1 || options.cursor.length > 512)
    )
      throw invalidTodo(action, "cursor 必须是 1–512 字符。", "--cursor");
    const query = new URLSearchParams({
      status: options.status ?? "unfinished",
      limit,
    });
    if (options.cursor !== undefined) query.set("cursor", options.cursor);
    path += `?${query}`;
  }
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, options.timezoneOverride);
  const response = await requestCalendar<unknown>(runtime, {
    baseUrl: resolved.baseUrl.value,
    apiKey: requireCalendarApiKey(resolved),
    timezone: resolved.timezone.value,
    operation,
    path,
    deadline: (runtime.now ?? Date.now)() + (options.timeoutMs ?? 30_000),
  });
  const parsed = (action === "list" ? todoPage : todoReceipt).safeParse(
    response.data,
  );
  if (!parsed.success)
    throw new CliFailure({
      type: "SERVER_ERROR",
      exitCode: 8,
      message: "Open Platform 返回了不完整的待办响应。",
      requestId: response.requestId,
      httpStatus: response.httpStatus,
      nextAction: {
        description: "重新读取待办",
        command: "sharge todos list --json",
      },
    });
  const data = parsed.data;
  const items =
    "items" in data && Array.isArray(data.items) ? data.items : [data];
  const text =
    items
      .map(
        (item) =>
          `#${item.id} ${item.title} [${item.completed ? "已完成" : "未完成"}]${item.start_time ? ` ${item.start_time}` : ""}`,
      )
      .join("\n") || "没有待办。";
  return {
    data,
    text: `${text}\n`,
    meta: {
      requestId: response.requestId,
      timezone: resolved.timezone.value,
      clientDate: response.clientDate,
    },
  };
}
