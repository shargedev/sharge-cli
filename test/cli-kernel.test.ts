import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import {
  type CommandDefinition,
  commandDefinitions,
  rootCommandDefinition,
} from "../src/cli/definitions.js";
import { runCli } from "../src/cli.js";
import { CLI_ERROR_TYPES, CliFailure } from "../src/runtime/errors.js";

function createIo() {
  let stdout = "";
  let stderr = "";

  return {
    io: {
      stdout: (value: string) => {
        stdout += value;
      },
      stderr: (value: string) => {
        stderr += value;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe("CLI kernel", () => {
  it("only advertises runtime-supported error types in JSON help", () => {
    const supported = new Set<string>(CLI_ERROR_TYPES);

    for (const definition of [rootCommandDefinition, ...commandDefinitions]) {
      expect(
        definition.errors.every((type) => supported.has(type)),
        `${definition.command}: ${definition.errors.join(", ")}`,
      ).toBe(true);
    }
  });

  it("rejects --jq unless --json is also explicit", async () => {
    const capture = createIo();
    const exitCode = await runCli(
      ["version", "--jq", ".data.version"],
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(capture.stdout()).toBe("");
    expect(capture.stderr()).toContain("--jq 必须与 --json 一起使用");
  });

  it("rejects an invalid global timeout before command execution", async () => {
    const capture = createIo();

    const exitCode = await runCli(
      ["version", "--json", "--timeout", "nonsense"],
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      ok: false,
      error: { type: "INVALID_INPUT", field: "--timeout" },
    });
  });

  it("filters a success envelope with the built-in jq runtime", async () => {
    const capture = createIo();
    const exitCode = await runCli(
      ["version", "--json", "--jq", ".data.version"],
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(capture.stdout()).toBe(`${JSON.stringify(packageJson.version)}\n`);
    expect(capture.stderr()).toBe("");
  });

  it("rejects an undefined jq filter before running a command handler", async () => {
    const capture = createIo();
    let handlerCalls = 0;
    const definitions: CommandDefinition[] = [
      {
        command: "probe",
        path: ["probe"],
        description: "probe",
        requiredScopes: [],
        arguments: [],
        options: [],
        inputSchema: null,
        outputSchema: { type: "object" },
        network: true,
        sideEffects: [],
        destructive: false,
        dryRun: false,
        retrySafe: true,
        timeout: 30_000,
        pagination: null,
        errors: [],
        examples: [],
        handler: async () => {
          handlerCalls += 1;
          return { text: "ok\n", data: { ok: true } };
        },
      },
    ];

    const exitCode = await runCli(
      ["probe", "--json", "--jq", ".data | nonsense"],
      capture.io,
      definitions,
    );

    expect(exitCode).toBe(2);
    expect(handlerCalls).toBe(0);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      ok: false,
      error: { type: "INVALID_INPUT", field: "--jq" },
    });
  });

  it("maps a jq evaluation failure to a stable error without partial stdout", async () => {
    const capture = createIo();

    const exitCode = await runCli(
      ["version", "--json", "--jq", "1 / 0"],
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      ok: false,
      command: "version",
      error: { type: "INVALID_INPUT", field: "--jq" },
    });
  });

  it("renders unknown outcome for a write transport failure", async () => {
    const capture = createIo();
    const definitions: CommandDefinition[] = [
      {
        command: "write",
        path: ["write"],
        description: "write",
        requiredScopes: [],
        arguments: [],
        options: [],
        inputSchema: null,
        outputSchema: { type: "object" },
        network: true,
        sideEffects: ["write"],
        destructive: false,
        dryRun: false,
        retrySafe: false,
        timeout: 30_000,
        pagination: null,
        errors: ["TIMEOUT"],
        examples: [],
        handler: async () => {
          throw new CliFailure({
            type: "TIMEOUT",
            exitCode: 8,
            retryable: false,
            outcome: "unknown",
            message: "写请求结果未知。",
            nextAction: {
              description: "先读取资源确认状态",
              command: "sharge read --json",
            },
          });
        },
      },
    ];

    const exitCode = await runCli(["write", "--json"], capture.io, definitions);

    expect(exitCode).toBe(8);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      error: {
        type: "TIMEOUT",
        retryable: false,
        outcome: "unknown",
      },
    });
  });

  it("applies jq to JSON help success envelopes", async () => {
    const capture = createIo();

    const exitCode = await runCli(
      ["--help", "--json", "--jq", ".data.command"],
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(capture.stdout()).toBe('"sharge"\n');
  });

  it("prints version as text by default", async () => {
    const capture = createIo();

    const exitCode = await runCli(["version"], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.stdout()).toBe(`${packageJson.version}\n`);
    expect(capture.stderr()).toBe("");
  });

  it("prints a stable success envelope when JSON is explicit", async () => {
    const capture = createIo();

    const exitCode = await runCli(["version", "--json"], capture.io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      schemaVersion: "1",
      ok: true,
      command: "version",
      data: {
        version: packageJson.version,
      },
      warnings: [],
      meta: {
        requestId: null,
      },
    });
    expect(JSON.parse(capture.stdout()).meta.runId).toMatch(/^run_/);
    expect(capture.stderr()).toBe("");
  });

  it("accepts the global JSON flag before the command", async () => {
    const capture = createIo();

    const exitCode = await runCli(["--json", "version"], capture.io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      ok: true,
      command: "version",
      data: {
        version: packageJson.version,
      },
    });
    expect(capture.stderr()).toBe("");
  });

  it("discovers implemented commands from Chinese root help", async () => {
    const capture = createIo();

    const exitCode = await runCli(["--help"], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.stdout()).toContain("用法：sharge <命令> [选项]");
    expect(capture.stdout()).toContain("version");
    expect(capture.stdout()).toContain("显示 CLI 版本");
    expect(capture.stdout()).toContain("sharge --help --json");
    expect(capture.stderr()).toBe("");
  });

  it("discovers implemented commands from offline JSON root help", async () => {
    const capture = createIo();

    const exitCode = await runCli(["--help", "--json"], capture.io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      schemaVersion: "1",
      ok: true,
      command: "sharge",
      data: {
        command: "sharge",
        commands: expect.arrayContaining([
          {
            command: "version",
            path: ["version"],
            description: "显示 CLI 版本",
          },
          {
            command: "config.show",
            path: ["config", "show"],
            description: "显示 resolved 配置与来源",
          },
        ]),
      },
      warnings: [],
      meta: {
        requestId: null,
      },
    });
    expect(capture.stderr()).toBe("");
  });

  it("describes a command from the same offline JSON definition", async () => {
    const capture = createIo();

    const exitCode = await runCli(["version", "--help", "--json"], capture.io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      schemaVersion: "1",
      ok: true,
      command: "version",
      data: {
        command: "version",
        description: "显示 CLI 版本",
        requiredScopes: [],
        arguments: [],
        options: expect.arrayContaining([
          expect.objectContaining({
            name: "--json",
            type: "boolean",
            enum: null,
            repeatable: false,
            exclusiveWith: [],
          }),
        ]),
        inputSchema: null,
        outputSchema: {
          type: "object",
        },
        network: false,
        sideEffects: [],
        destructive: false,
        dryRun: false,
        retrySafe: true,
        timeout: null,
        pagination: null,
        errors: [],
        examples: ["sharge version", "sharge version --json"],
      },
      warnings: [],
      meta: {
        requestId: null,
      },
    });
    expect(capture.stderr()).toBe("");
  });

  it("renders command text help from the shared definition", async () => {
    const capture = createIo();

    const exitCode = await runCli(["version", "--help"], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.stdout()).toContain("用法：sharge version [选项]");
    expect(capture.stdout()).toContain("显示 CLI 版本");
    expect(capture.stdout()).toContain("--json");
    expect(capture.stdout()).toContain("sharge version --json");
    expect(capture.stderr()).toBe("");
  });

  it("fails fast on an unknown text command without dumping help", async () => {
    const capture = createIo();

    const exitCode = await runCli(["unknown"], capture.io);

    expect(exitCode).toBe(2);
    expect(capture.stdout()).toBe("");
    expect(capture.stderr()).toContain("未知命令：unknown");
    expect(capture.stderr()).toContain("下一步：sharge --help");
    expect(capture.stderr()).not.toContain("用法：");
  });

  it("returns an error envelope for an unknown JSON command", async () => {
    const capture = createIo();

    const exitCode = await runCli(["unknown", "--json"], capture.io);

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      schemaVersion: "1",
      ok: false,
      command: "sharge",
      data: null,
      warnings: [],
      error: {
        type: "INVALID_COMMAND",
        retryable: false,
        nextActions: [
          {
            command: "sharge --help --json",
          },
        ],
      },
      meta: {
        requestId: null,
        httpStatus: null,
      },
    });
    expect(capture.stderr()).toBe("");
  });

  it("guides an agent to command help for an unknown option", async () => {
    const capture = createIo();

    const exitCode = await runCli(["version", "--wat", "--json"], capture.io);

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      ok: false,
      command: "version",
      error: {
        type: "INVALID_COMMAND",
        field: "--wat",
        nextActions: [
          {
            command: "sharge version --help --json",
          },
        ],
      },
    });
    expect(capture.stderr()).toBe("");
  });

  it("does not hide an unknown option behind command help", async () => {
    const capture = createIo();

    const exitCode = await runCli(
      ["version", "--help", "--wat", "--json"],
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      ok: false,
      command: "version",
      error: {
        field: "--wat",
      },
    });
    expect(capture.stderr()).toBe("");
  });

  it("does not hide an unknown option behind root help", async () => {
    const capture = createIo();

    const exitCode = await runCli(["--help", "--wat", "--json"], capture.io);

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      ok: false,
      command: "sharge",
      error: {
        field: "--wat",
        nextActions: [
          {
            command: "sharge --help --json",
          },
        ],
      },
    });
    expect(capture.stderr()).toBe("");
  });

  it("shows root text help when no command is provided", async () => {
    const capture = createIo();

    const exitCode = await runCli([], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.stdout()).toContain("用法：sharge <命令> [选项]");
    expect(capture.stderr()).toBe("");
  });

  it("fails locally when a command definition is missing a required positional", async () => {
    const capture = createIo();
    const inspectDefinition = {
      command: "inspect",
      path: ["inspect"],
      description: "检查资源",
      requiredScopes: [],
      arguments: [
        {
          name: "resourceId",
          description: "资源 ID",
          required: true,
          variadic: false,
        },
      ],
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
      errors: ["INVALID_INPUT"],
      examples: ["sharge inspect resource_1"],
      handler: async () => ({
        text: "不应执行\n",
        data: {},
      }),
    } satisfies CommandDefinition;

    const exitCode = await runCli(["inspect", "--json"], capture.io, [
      inspectDefinition,
    ]);

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.stdout())).toMatchObject({
      ok: false,
      command: "inspect",
      error: {
        type: "INVALID_INPUT",
        field: "resourceId",
        nextActions: [
          {
            command: "sharge inspect --help --json",
          },
        ],
      },
    });
    expect(capture.stderr()).toBe("");
  });
});
