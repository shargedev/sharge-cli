import { randomUUID } from "node:crypto";
import { evaluate as evaluateJq, type ProgAst } from "@jq-tools/jq";
import {
  type CommandDefinition,
  type CommandExecution,
  commandDefinitions,
  commandHelpData,
  inheritedOptions,
  type OptionDefinition,
  resolveCommandDefinition,
  rootCommandDefinition,
} from "./cli/definitions.js";
import { type CliRuntime, defaultCliRuntime } from "./runtime/context.js";
import { parseTimeoutMs } from "./runtime/duration.js";
import { type CliErrorType, CliFailure } from "./runtime/errors.js";
import { compileJq } from "./runtime/jq.js";
import { appendInvocationLog } from "./runtime/logger.js";

export type CliIo = {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
};

type ErrorType = CliErrorType;

export type CliRunTrace = {
  command?: string;
  errorType?: ErrorType;
};

type NextAction = {
  description: string;
  command: string;
};

type LocalError = {
  type: ErrorType;
  message: string;
  retryable: boolean;
  field?: string;
  path?: string;
  expected?: string;
  actual?: string;
  outcome?: "unknown";
  retryAfterMs?: number;
  requiredScopes?: string[];
  nextActions: NextAction[];
};

function createRunId(): string {
  return `run_${randomUUID()}`;
}

function createMeta(runId: string) {
  return {
    runId,
    requestId: null,
  };
}

function successEnvelope(
  command: string,
  data: unknown,
  runId: string,
  warnings: CommandExecution["warnings"] = [],
  networkMeta?: {
    requestId: string | null;
    timezone: string;
    clientDate: string;
  },
) {
  return {
    schemaVersion: "1" as const,
    ok: true as const,
    command,
    data,
    warnings,
    meta: {
      ...createMeta(runId),
      ...networkMeta,
    },
  };
}

function failureEnvelope(
  command: string,
  error: LocalError,
  runId: string,
  requestMeta?: {
    requestId?: string | null;
    httpStatus?: number | null;
  },
) {
  return {
    schemaVersion: "1" as const,
    ok: false as const,
    command,
    data: null,
    warnings: [],
    error,
    meta: {
      ...createMeta(runId),
      ...requestMeta,
      httpStatus: requestMeta?.httpStatus ?? null,
    },
  };
}

function writeJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value)}\n`);
}

function optionNames(definition: CommandDefinition): string[] {
  return inheritedOptions(definition).flatMap((option) => [
    option.name,
    ...option.aliases,
  ]);
}

function parseInvocation(args: string[], definitions: CommandDefinition[]) {
  const optionsByName = new Map<string, OptionDefinition>();
  for (const option of [
    ...rootCommandDefinition.options,
    ...definitions.flatMap((definition) => definition.options),
  ]) {
    optionsByName.set(option.name, option);
    for (const alias of option.aliases) {
      optionsByName.set(alias, option);
    }
  }

  const positionals: string[] = [];
  const options: Record<string, boolean | string | string[]> = {};
  const rawOptions: string[] = [];
  let missingOptionValue: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("-")) {
      positionals.push(argument);
      continue;
    }

    rawOptions.push(argument);
    const option = optionsByName.get(argument);
    if (!option) {
      continue;
    }
    if (option.type === "boolean") {
      options[option.name] = true;
      continue;
    }
    const value = args[index + 1];
    if (
      value === undefined ||
      ((value.startsWith("--") || optionsByName.has(value)) &&
        !(
          (option.name === "--input" || option.name === "--file") &&
          value === "-"
        ))
    ) {
      missingOptionValue = option.name;
      continue;
    }
    const existing = options[option.name];
    if (option.repeatable) {
      options[option.name] = Array.isArray(existing)
        ? [...existing, value]
        : typeof existing === "string"
          ? [existing, value]
          : [value];
    } else {
      options[option.name] = value;
    }
    index += 1;
  }

  return {
    positionals,
    options,
    rawOptions,
    missingOptionValue,
  };
}

function renderOptions(definition: CommandDefinition): string[] {
  return inheritedOptions(definition).map((option) => {
    const aliases =
      option.aliases.length > 0 ? `${option.aliases.join(", ")}, ` : "";
    const required = option.required ? "（必填）" : "";
    return `  ${aliases}${option.name}${required}  ${option.description}`;
  });
}

function renderRootTextHelp(definitions: CommandDefinition[]): string {
  const commandLines = definitions
    .map(
      (definition) =>
        `  ${definition.path.join(" ")}  ${definition.description}`,
    )
    .join("\n");

  return [
    "Sharge CLI",
    "",
    rootCommandDefinition.description,
    "",
    "用法：sharge <命令> [选项]",
    "",
    "命令：",
    commandLines,
    "",
    "全局选项：",
    ...renderOptions(rootCommandDefinition),
    "",
    "示例：",
    ...rootCommandDefinition.examples.map((example) => `  ${example}`),
    "",
  ].join("\n");
}

function childCommands(
  definition: CommandDefinition,
  definitions: CommandDefinition[],
) {
  return definitions.filter(
    (candidate) =>
      candidate.path.length === definition.path.length + 1 &&
      definition.path.every((part, index) => candidate.path[index] === part),
  );
}

function renderCommandTextHelp(
  definition: CommandDefinition,
  definitions: CommandDefinition[],
): string {
  const positionalUsage = definition.arguments
    .map((argument) =>
      argument.required ? `<${argument.name}>` : `[${argument.name}]`,
    )
    .join(" ");
  const usageSuffix = positionalUsage ? ` ${positionalUsage}` : "";
  const children = childCommands(definition, definitions);

  return [
    definition.description,
    "",
    `用法：sharge ${definition.path.join(" ")}${usageSuffix} [选项]`,
    "",
    ...(definition.arguments.length > 0
      ? [
          "参数：",
          ...definition.arguments.map(
            (argument) => `  ${argument.name}  ${argument.description}`,
          ),
          "",
        ]
      : []),
    ...(children.length > 0
      ? [
          "子命令：",
          ...children.map(
            (child) =>
              `  ${child.path.slice(definition.path.length).join(" ")}  ${child.description}`,
          ),
          "",
        ]
      : []),
    "选项：",
    ...renderOptions(definition),
    "",
    "示例：",
    ...definition.examples.map((example) => `  ${example}`),
    "",
  ].join("\n");
}

function rootHelpData(definitions: CommandDefinition[]) {
  return {
    ...commandHelpData(rootCommandDefinition),
    commands: definitions.map((definition) => ({
      command: definition.command,
      path: definition.path,
      description: definition.description,
    })),
  };
}

function writeLocalError(
  io: CliIo,
  options: {
    json: boolean;
    command: string;
    type: ErrorType;
    message: string;
    field?: string;
    path?: string;
    expected?: string;
    actual?: string;
    nextAction: NextAction;
    runId: string;
    trace?: CliRunTrace;
    exitCode?: number;
    retryable?: boolean;
    outcome?: "unknown";
    requestId?: string | null;
    httpStatus?: number | null;
    retryAfterMs?: number | null;
    requiredScopes?: string[];
  },
): number {
  if (options.trace) {
    options.trace.command = options.command;
    options.trace.errorType = options.type;
  }
  if (options.json) {
    writeJson(
      io,
      failureEnvelope(
        options.command,
        {
          type: options.type,
          message: options.message,
          retryable: options.retryable ?? false,
          ...(options.field ? { field: options.field } : {}),
          ...(options.path ? { path: options.path } : {}),
          ...(options.expected ? { expected: options.expected } : {}),
          ...(options.actual ? { actual: options.actual } : {}),
          ...(options.outcome ? { outcome: options.outcome } : {}),
          ...(options.retryAfterMs !== null &&
          options.retryAfterMs !== undefined
            ? { retryAfterMs: options.retryAfterMs }
            : {}),
          ...(options.requiredScopes
            ? { requiredScopes: options.requiredScopes }
            : {}),
          nextActions: [options.nextAction],
        },
        options.runId,
        {
          requestId: options.requestId ?? null,
          httpStatus: options.httpStatus ?? null,
        },
      ),
    );
  } else {
    io.stderr(`${options.message}\n下一步：${options.nextAction.command}\n`);
  }
  return options.exitCode ?? 2;
}

function writeSuccessJson(
  io: CliIo,
  options: {
    command: string;
    data: unknown;
    runId: string;
    jqProgram?: ProgAst;
    trace?: CliRunTrace;
    meta?: {
      requestId: string | null;
      timezone: string;
      clientDate: string;
    };
    warnings?: CommandExecution["warnings"];
  },
): number | null {
  const envelope = successEnvelope(
    options.command,
    options.data,
    options.runId,
    options.warnings,
    options.meta,
  );
  if (!options.jqProgram) {
    writeJson(io, envelope);
    return null;
  }
  try {
    const values = [...evaluateJq(options.jqProgram, [envelope])];
    for (const value of values) {
      const rendered = JSON.stringify(value);
      if (rendered !== undefined) {
        io.stdout(`${rendered}\n`);
      }
    }
    return null;
  } catch {
    return writeLocalError(io, {
      json: true,
      command: options.command,
      type: "INVALID_INPUT",
      message: "无法执行 --jq 表达式。",
      field: "--jq",
      nextAction: {
        description: "修正 jq 表达式后重试",
        command: `sharge ${options.command.replaceAll(".", " ")} --json --jq '.'`,
      },
      runId: options.runId,
      trace: options.trace,
    });
  }
}

function commandHelpAction(
  definition: CommandDefinition,
  json: boolean,
): NextAction {
  return {
    description: "查看命令用法",
    command: `sharge ${definition.path.join(" ")} --help${
      json ? " --json" : ""
    }`,
  };
}

function argumentValues(
  definition: CommandDefinition,
  values: string[],
): Record<string, string> {
  return Object.fromEntries(
    definition.arguments
      .map((argument, index) => [argument.name, values[index]])
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export async function runCli(
  args: string[],
  io: CliIo,
  definitions = commandDefinitions,
  runtime: CliRuntime = defaultCliRuntime(),
  runId = createRunId(),
  trace?: CliRunTrace,
): Promise<number> {
  const parsed = parseInvocation(args, definitions);
  const { positionals } = parsed;
  const definition = resolveCommandDefinition(positionals, definitions);
  const optionOwner = definition ?? rootCommandDefinition;
  const jsonRequested = parsed.options["--json"] === true;
  const helpRequested = parsed.options["--help"] === true;
  const knownOptions = optionNames(optionOwner);
  const unsupportedOption = parsed.rawOptions.find(
    (argument) => !knownOptions.includes(argument),
  );

  if (unsupportedOption) {
    return writeLocalError(io, {
      json: jsonRequested,
      command: definition?.command ?? rootCommandDefinition.command,
      type: "INVALID_COMMAND",
      message: `不支持的选项：${unsupportedOption}`,
      field: unsupportedOption,
      nextAction: definition
        ? commandHelpAction(definition, jsonRequested)
        : {
            description: "查看全局选项",
            command: `sharge --help${jsonRequested ? " --json" : ""}`,
          },
      runId,
      trace,
    });
  }

  if (parsed.missingOptionValue) {
    return writeLocalError(io, {
      json: jsonRequested,
      command: definition?.command ?? rootCommandDefinition.command,
      type: "INVALID_INPUT",
      message: `选项缺少值：${parsed.missingOptionValue}`,
      field: parsed.missingOptionValue,
      nextAction: definition
        ? commandHelpAction(definition, jsonRequested)
        : {
            description: "查看全局选项",
            command: `sharge --help${jsonRequested ? " --json" : ""}`,
          },
      runId,
      trace,
    });
  }

  if (typeof parsed.options["--timeout"] === "string") {
    try {
      parseTimeoutMs(parsed.options["--timeout"]);
    } catch (error) {
      if (error instanceof CliFailure) {
        return writeLocalError(io, {
          json: jsonRequested,
          command: definition?.command ?? rootCommandDefinition.command,
          type: error.type,
          message: error.message,
          ...(error.field ? { field: error.field } : {}),
          nextAction: error.nextAction,
          runId,
          trace,
          exitCode: error.exitCode,
        });
      }
      throw error;
    }
  }

  if (
    typeof parsed.options["--jq"] === "string" &&
    parsed.options["--json"] !== true
  ) {
    return writeLocalError(io, {
      json: false,
      command: definition?.command ?? rootCommandDefinition.command,
      type: "INVALID_INPUT",
      message: "--jq 必须与 --json 一起使用。",
      field: "--jq",
      nextAction: {
        description: "同时启用 JSON 输出",
        command: `sharge ${
          definition?.path.join(" ") ?? ""
        } --json --jq '${parsed.options["--jq"]}'`.replace(/\s+/g, " "),
      },
      runId,
      trace,
    });
  }

  let jqProgram: ProgAst | undefined;
  if (typeof parsed.options["--jq"] === "string") {
    try {
      jqProgram = compileJq(parsed.options["--jq"]);
    } catch {
      return writeLocalError(io, {
        json: true,
        command: definition?.command ?? rootCommandDefinition.command,
        type: "INVALID_INPUT",
        message: "无法解析 --jq 表达式。",
        field: "--jq",
        nextAction: {
          description: "修正 jq 表达式后重试",
          command: `sharge ${
            definition?.path.join(" ") ?? ""
          } --json --jq '.'`.replace(/\s+/g, " "),
        },
        runId,
        trace,
      });
    }
  }

  if (!definition && positionals.length === 0) {
    if (args.length === 0 || helpRequested) {
      if (jsonRequested) {
        const jqExitCode = writeSuccessJson(io, {
          command: rootCommandDefinition.command,
          data: rootHelpData(definitions),
          runId,
          jqProgram,
          trace,
        });
        if (jqExitCode !== null) {
          return jqExitCode;
        }
      } else {
        io.stdout(renderRootTextHelp(definitions));
      }
      return 0;
    }
  }

  if (!definition) {
    const unknown = positionals.join(" ") || args.join(" ");
    return writeLocalError(io, {
      json: jsonRequested,
      command: rootCommandDefinition.command,
      type: "INVALID_COMMAND",
      message: `未知命令：${unknown}`,
      nextAction: {
        description: "查看可用命令",
        command: `sharge --help${jsonRequested ? " --json" : ""}`,
      },
      runId,
      trace,
    });
  }

  if (helpRequested) {
    if (trace) {
      trace.command = definition.command;
    }
    const children = childCommands(definition, definitions);
    const helpData = {
      ...commandHelpData(definition),
      ...(children.length > 0
        ? {
            commands: children.map((child) => ({
              command: child.command,
              path: child.path,
              description: child.description,
            })),
          }
        : {}),
    };
    if (jsonRequested) {
      const jqExitCode = writeSuccessJson(io, {
        command: definition.command,
        data: helpData,
        runId,
        jqProgram,
        trace,
      });
      if (jqExitCode !== null) {
        return jqExitCode;
      }
    } else {
      io.stdout(renderCommandTextHelp(definition, definitions));
    }
    return 0;
  }

  const suppliedArguments = positionals.slice(definition.path.length);
  const missingArgument = definition.arguments.find(
    (argument, index) =>
      argument.required && suppliedArguments[index] === undefined,
  );
  if (missingArgument) {
    return writeLocalError(io, {
      json: jsonRequested,
      command: definition.command,
      type: "INVALID_INPUT",
      message: `缺少必填参数：${missingArgument.name}`,
      field: missingArgument.name,
      nextAction: commandHelpAction(definition, jsonRequested),
      runId,
      trace,
    });
  }

  const invalidEnumArgument = definition.arguments.find(
    (argument, index) =>
      argument.enum &&
      suppliedArguments[index] !== undefined &&
      !argument.enum.includes(suppliedArguments[index]),
  );
  if (invalidEnumArgument) {
    return writeLocalError(io, {
      json: jsonRequested,
      command: definition.command,
      type: "INVALID_INPUT",
      message: `${invalidEnumArgument.name} 只允许：${invalidEnumArgument.enum?.join(", ")}`,
      field: invalidEnumArgument.name,
      nextAction: commandHelpAction(definition, jsonRequested),
      runId,
      trace,
    });
  }

  const invalidEnumOption = inheritedOptions(definition)
    .filter((option) => option.enum !== null)
    .map((option) => {
      const supplied = parsed.options[option.name];
      const values = Array.isArray(supplied)
        ? supplied
        : typeof supplied === "string"
          ? [supplied]
          : [];
      return {
        option,
        value: values.find((value) => !option.enum?.includes(value)),
      };
    })
    .find((candidate) => candidate.value !== undefined);
  if (invalidEnumOption?.value !== undefined) {
    return writeLocalError(io, {
      json: jsonRequested,
      command: definition.command,
      type: "INVALID_INPUT",
      message: `${invalidEnumOption.option.name} 只允许：${invalidEnumOption.option.enum?.join(", ")}`,
      field: invalidEnumOption.option.name,
      actual: invalidEnumOption.value,
      expected: invalidEnumOption.option.enum?.join("|"),
      nextAction: commandHelpAction(definition, jsonRequested),
      runId,
      trace,
    });
  }

  if (
    !definition.arguments.some((argument) => argument.variadic) &&
    suppliedArguments.length > definition.arguments.length
  ) {
    const unexpected = suppliedArguments[definition.arguments.length];
    return writeLocalError(io, {
      json: jsonRequested,
      command: definition.command,
      type: "INVALID_INPUT",
      message: `不支持的位置参数：${unexpected}`,
      field: unexpected,
      nextAction: commandHelpAction(definition, jsonRequested),
      runId,
      trace,
    });
  }

  if (!definition.handler) {
    return writeLocalError(io, {
      json: jsonRequested,
      command: definition.command,
      type: "INVALID_COMMAND",
      message: `命令尚不可执行：${definition.path.join(" ")}`,
      nextAction: commandHelpAction(definition, jsonRequested),
      runId,
      trace,
    });
  }

  let result: CommandExecution;
  try {
    result = await definition.handler({
      arguments: argumentValues(definition, suppliedArguments),
      options: parsed.options,
      runtime,
      emitStatus: (status) => {
        const { message, ...event } = status;
        if (jsonRequested) {
          io.stderr(
            `${JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "info",
              ...event,
            })}\n`,
          );
        } else {
          io.stderr(`${message}\n`);
        }
      },
    });
  } catch (error) {
    if (error instanceof CliFailure) {
      return writeLocalError(io, {
        json: jsonRequested,
        command: definition.command,
        type: error.type,
        message: error.message,
        ...(error.field ? { field: error.field } : {}),
        ...(error.path ? { path: error.path } : {}),
        ...(error.expected ? { expected: error.expected } : {}),
        ...(error.actual ? { actual: error.actual } : {}),
        nextAction: error.nextAction,
        runId,
        trace,
        exitCode: error.exitCode,
        retryable: error.retryable,
        outcome: error.outcome,
        requestId: error.requestId,
        httpStatus: error.httpStatus,
        retryAfterMs: error.retryAfterMs,
        requiredScopes: error.requiredScopes,
      });
    }
    return writeLocalError(io, {
      json: jsonRequested,
      command: definition.command,
      type: "INTERNAL_ERROR",
      message: "CLI 发生未预期的本地错误。",
      nextAction: {
        description: "查看日志路径并使用 --debug 重试",
        command: "sharge logs path",
      },
      runId,
      trace,
      exitCode: 1,
    });
  }
  if (trace) {
    trace.command = definition.command;
  }
  if (jsonRequested) {
    const jqExitCode = writeSuccessJson(io, {
      command: definition.command,
      data: result.data,
      runId,
      jqProgram,
      trace,
      meta: result.meta,
      warnings: result.warnings,
    });
    if (jqExitCode !== null) {
      return jqExitCode;
    }
  } else {
    io.stdout(result.text);
  }
  return result.exitCode ?? 0;
}

export async function main(
  argv = process.argv,
  runtime: CliRuntime = defaultCliRuntime(),
  io: CliIo = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  const args = argv.slice(2);
  const runId = createRunId();
  const invocationStartedAt = new Date().toISOString();
  const startedAt = performance.now();
  const executionRuntime: CliRuntime = {
    ...runtime,
    networkEvents: [],
  };
  const trace: CliRunTrace = {};
  const exitCode = await runCli(
    args,
    io,
    commandDefinitions,
    executionRuntime,
    runId,
    trace,
  );
  const durationMs = Math.round(performance.now() - startedAt);
  const parsed = parseInvocation(args, commandDefinitions);
  const definition = resolveCommandDefinition(
    parsed.positionals,
    commandDefinitions,
  );
  const owner = definition ?? rootCommandDefinition;
  const canonicalOptionNames = [
    ...new Set(
      parsed.rawOptions.flatMap((name) => {
        const option = inheritedOptions(owner).find(
          (candidate) =>
            candidate.name === name || candidate.aliases.includes(name),
        );
        return option ? [option.name] : [];
      }),
    ),
  ];
  const command =
    trace.command ?? definition?.command ?? rootCommandDefinition.command;
  const logResult = await appendInvocationLog(runtime, {
    runId,
    command,
    startedAt: invocationStartedAt,
    optionNames: canonicalOptionNames,
    exitCode,
    durationMs,
    networkEvents: executionRuntime.networkEvents,
    ...(trace.errorType ? { errorType: trace.errorType } : {}),
  });
  const debugRequested = args.includes("--debug");
  const jsonRequested = args.includes("--json");
  if (debugRequested) {
    if (jsonRequested) {
      io.stderr(
        `${JSON.stringify({
          type: "CLI_COMPLETE",
          runId,
          command,
          exitCode,
          durationMs,
        })}\n`,
      );
    } else {
      io.stderr(
        `调试：命令 ${command} 完成，退出码 ${exitCode}，耗时 ${durationMs}ms。\n`,
      );
    }
  }
  if (!logResult.written && debugRequested) {
    if (jsonRequested) {
      io.stderr(
        `${JSON.stringify({
          type: "LOG_WRITE_FAILED",
          runId,
          message: "持久化日志写入失败，命令结果不受影响。",
        })}\n`,
      );
    } else {
      io.stderr("警告：持久化日志写入失败，命令结果不受影响。\n");
    }
  }
  return exitCode;
}
