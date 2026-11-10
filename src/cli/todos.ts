import { apiOperations } from "../api/operations.js";
import {
  todoInputSchemas,
  todoOutputSchema,
} from "../commands/todos/input-contract.js";
import { runTodosRead } from "../commands/todos/read.js";
import { runTodosWrite } from "../commands/todos/write.js";
import { parseTimeoutMs } from "../runtime/duration.js";
import type {
  CommandContext,
  CommandDefinition,
  OptionDefinition,
} from "./definitions.js";

const errors: CommandDefinition["errors"] = [
  "INVALID_INPUT",
  "AUTH_REQUIRED",
  "CREDENTIAL_INVALID",
  "PERMISSION_DENIED",
  "SCOPE_REQUIRED",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "TIMEOUT",
  "NETWORK_ERROR",
  "CANCELLED",
];
function option(
  name: string,
  description: string,
  extra: Partial<OptionDefinition> = {},
): OptionDefinition {
  return {
    name,
    aliases: [],
    type: "string",
    description,
    default: null,
    enum: null,
    repeatable: false,
    exclusiveWith: [],
    ...extra,
  };
}
const descriptions = {
  list: "读取一页待办，默认只列未完成",
  get: "按 ID 读取一条待办",
  create: "创建一条待办，时间可不填",
  update: "局部修改一条待办的标题或开始时间",
  complete: "批量将待办标记为已完成或未完成，最多 100 个",
  delete: "批量删除待办，最多 100 个",
};
const idArgument = {
  name: "todo-id",
  description: "待办正整数 ID，写成字符串，不转成 Number",
  required: true,
  variadic: false,
};
function writeOptions(
  action: "create" | "update" | "complete" | "delete",
): OptionDefinition[] {
  const business =
    action === "create" || action === "update"
      ? [
          option("--title", "待办标题，去掉首尾空白后 1–255 字"),
          option(
            "--start-time",
            "开始时间，必须带显式 offset；不传表示不设时间",
          ),
          ...(action === "update"
            ? [
                option("--clear-start-time", "清除开始时间", {
                  type: "boolean",
                  default: false,
                  exclusiveWith: ["--start-time"],
                }),
              ]
            : [option("--timezone", "IANA 时区或 UTC 偏移")]),
        ]
      : [
          option("--todo-id", "待办正整数 ID，写成字符串，不转成 Number", {
            repeatable: true,
          }),
          ...(action === "complete"
            ? [
                option("--completed", "true 标为已完成，false 恢复未完成", {
                  enum: ["true", "false"],
                }),
              ]
            : []),
        ];
  for (const item of business)
    item.exclusiveWith.push("--input", "--generate-input");
  if (action === "update")
    business
      .find((o) => o.name === "--start-time")
      ?.exclusiveWith.push("--clear-start-time");
  return [
    ...business,
    option("--input", "inline JSON、@file 或 -（stdin）", {
      exclusiveWith: [...business.map((o) => o.name), "--generate-input"],
    }),
    option("--generate-input", "离线输出原始产品 JSON 模板", {
      type: "boolean",
      default: false,
      exclusiveWith: [
        ...business.map((o) => o.name),
        "--input",
        "--dry-run",
        "--json",
        "--jq",
      ],
    }),
    option("--dry-run", "只输出零网络执行计划", {
      type: "boolean",
      default: false,
      exclusiveWith: ["--generate-input"],
    }),
  ];
}
function stringOption(
  context: CommandContext,
  name: string,
): string | undefined {
  const v = context.options[name];
  return typeof v === "string" ? v : undefined;
}
const common = {
  requiredScopes: [],
  arguments: [],
  options: [],
  inputSchema: null,
  outputSchema: { type: "object" },
  network: false,
  sideEffects: [],
  destructive: false,
  dryRun: false,
  retrySafe: true,
  timeout: null,
  pagination: null,
  errors,
  examples: [],
  handler: null,
} satisfies Omit<CommandDefinition, "command" | "path" | "description">;
export function todosDefinitions(
  dryRunSchema: Record<string, unknown>,
): CommandDefinition[] {
  return [
    {
      ...common,
      command: "todos",
      path: ["todos"],
      description: "读取和管理待办",
      examples: ["sharge todos --help --json"],
    },
    ...(["list", "get", "create", "update", "complete", "delete"] as const).map(
      (action): CommandDefinition => {
        const read = action === "list" || action === "get";
        const operation =
          apiOperations[
            (
              {
                list: "todosList",
                get: "todosGet",
                create: "todosCreate",
                update: "todosUpdate",
                complete: "todosComplete",
                delete: "todosDelete",
              } as const
            )[action]
          ];
        const output =
          action === "list"
            ? {
                type: "object",
                required: ["items", "next_cursor", "has_more"],
                properties: {
                  items: { type: "array", items: todoOutputSchema },
                  next_cursor: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },
                  has_more: { type: "boolean" },
                },
              }
            : action === "complete" || action === "delete"
              ? {
                  type: "object",
                  required: ["changed_count"],
                  properties: {
                    changed_count: { type: "integer", minimum: 0 },
                  },
                }
              : todoOutputSchema;
        return {
          ...common,
          command: `todos.${action}`,
          path: ["todos", action],
          description: descriptions[action],
          requiredScopes: [...operation.requiredScopes],
          arguments:
            action === "get" || action === "update" ? [idArgument] : [],
          options:
            action === "list"
              ? [
                  option("--status", "unfinished（默认）、completed 或 all", {
                    default: "unfinished",
                    enum: ["unfinished", "completed", "all"],
                  }),
                  option("--limit", "当前页最大条数，1–100", { default: "20" }),
                  option("--cursor", "上一页返回的 opaque cursor"),
                ]
              : action === "get"
                ? []
                : writeOptions(action),
          inputSchema: read ? null : todoInputSchemas[action],
          outputSchema: read ? output : { anyOf: [output, dryRunSchema] },
          network: true,
          sideEffects: read ? [] : [`${action}_todos`],
          destructive: action === "delete",
          dryRun: !read,
          retrySafe: read,
          timeout: 30_000,
          pagination:
            action === "list"
              ? {
                  type: "cursor",
                  requestField: "cursor",
                  nextField: "next_cursor",
                  hasMoreField: "has_more",
                  autoPaginate: false,
                  defaultLimit: 20,
                  maxLimit: 100,
                }
              : null,
          examples:
            action === "list"
              ? ["sharge todos list --json"]
              : action === "get"
                ? ["sharge todos get 123 --json"]
                : action === "create"
                  ? ["sharge todos create --title '准备评审' --dry-run --json"]
                  : action === "update"
                    ? [
                        "sharge todos update 123 --clear-start-time --dry-run --json",
                      ]
                    : action === "complete"
                      ? [
                          "sharge todos complete --todo-id 123 --completed true --dry-run --json",
                        ]
                      : ["sharge todos delete --todo-id 123 --yes --json"],
          handler: async (context) => {
            const timeoutMs = parseTimeoutMs(
              stringOption(context, "--timeout"),
            );
            const timezoneOverride =
              action === "create"
                ? undefined
                : stringOption(context, "--timezone");
            if (action === "list" || action === "get")
              return runTodosRead(
                context.runtime,
                action,
                context.arguments["todo-id"],
                {
                  status: stringOption(context, "--status"),
                  limit: stringOption(context, "--limit"),
                  cursor: stringOption(context, "--cursor"),
                  timeoutMs,
                  timezoneOverride,
                },
              );
            const ids = context.options["--todo-id"];
            return runTodosWrite(
              context.runtime,
              action,
              context.arguments["todo-id"],
              {
                input: stringOption(context, "--input"),
                title: stringOption(context, "--title"),
                startTime: stringOption(context, "--start-time"),
                clearStartTime: context.options["--clear-start-time"] === true,
                timezone: stringOption(context, "--timezone"),
                ids: Array.isArray(ids)
                  ? ids
                  : typeof ids === "string"
                    ? [ids]
                    : [],
                completed: stringOption(context, "--completed"),
                generateInput: context.options["--generate-input"] === true,
                dryRun: context.options["--dry-run"] === true,
                json: context.options["--json"] === true,
                jq: stringOption(context, "--jq"),
                yes: context.options["--yes"] === true,
                timeoutMs,
                timezoneOverride,
              },
            );
          },
        };
      },
    ),
  ];
}
