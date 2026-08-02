import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import packageJson from "../../package.json" with { type: "json" };
import { type ApiResponse, requestJson } from "../api/client.js";
import { apiOperations } from "../api/operations.js";
import { resolveConfig } from "../runtime/config.js";
import type { CliRuntime } from "../runtime/context.js";
import { CliFailure } from "../runtime/errors.js";
import {
  loadOrCreateSettings,
  type SettingsStore,
  settingsPaths,
} from "../runtime/settings.js";

type DoctorCheck = {
  name: string;
  status: "pass" | "fail";
  message: string;
  nextActions?: Array<{ command: string }>;
};

function result(
  checks: DoctorCheck[],
  exitCode = 0,
  meta?: {
    requestId: string | null;
    timezone: string;
    clientDate: string;
  },
) {
  return {
    text: `${checks
      .map(
        (check) =>
          `${check.status === "pass" ? "✓" : "✗"} ${check.name}: ${check.message}`,
      )
      .join("\n")}\n`,
    data: {
      healthy: checks.every((check) => check.status === "pass"),
      checks,
    },
    ...(exitCode === 0 ? {} : { exitCode }),
    ...(meta ? { meta } : {}),
  };
}

function failedCheck(name: string, error: CliFailure): DoctorCheck {
  return {
    name,
    status: "fail",
    message: error.message,
    nextActions: [{ command: error.nextAction.command }],
  };
}

function remainingTimeout(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

async function inspectSettingsDirectory(
  runtime: CliRuntime,
  checks: DoctorCheck[],
): Promise<boolean> {
  const { directoryPath } = settingsPaths(runtime);
  try {
    const metadata = await lstat(directoryPath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      checks.push({
        name: "settings.directory",
        status: "fail",
        message: `${directoryPath} 不是安全的普通目录`,
        nextActions: [{ command: "sharge config show --json" }],
      });
      return false;
    }
    checks.push({
      name: "settings.directory",
      status: "pass",
      message: directoryPath,
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      checks.push({
        name: "settings.directory",
        status: "fail",
        message: "无法检查 settings 目录",
        nextActions: [{ command: "sharge config show --json" }],
      });
      return false;
    }
    checks.push({
      name: "settings.directory",
      status: "pass",
      message: `${directoryPath} 将安全创建`,
    });
  }
  return true;
}

async function loadSettingsForDoctor(
  runtime: CliRuntime,
  checks: DoctorCheck[],
): Promise<SettingsStore | null> {
  if (!(await inspectSettingsDirectory(runtime, checks))) {
    return null;
  }
  try {
    const store = await loadOrCreateSettings(runtime);
    checks.push({
      name: "settings",
      status: "pass",
      message: "settings JSON 与 schema 有效",
    });
    const metadata = await lstat(store.settingsPath);
    checks.push({
      name: "settings.permissions",
      status: "pass",
      message:
        runtime.platform === "win32"
          ? "settings 使用当前用户 ACL"
          : `settings 权限为 ${(metadata.mode & 0o777).toString(8).padStart(4, "0")}`,
    });
    return store;
  } catch (error) {
    const failure =
      error instanceof CliFailure
        ? error
        : new CliFailure({
            message: "无法读取 settings。",
            nextAction: {
              description: "检查 settings 路径",
              command: "sharge config show --json",
            },
          });
    checks.push(
      failedCheck(
        failure.field === "apiKey" ? "credential" : "settings",
        failure,
      ),
    );
    return null;
  }
}

export async function runDoctor(
  runtime: CliRuntime,
  timeoutMs = 30_000,
  timezoneOverride?: string,
) {
  const deadline = Date.now() + timeoutMs;
  const checks: DoctorCheck[] = [
    {
      name: "runtime",
      status: "pass",
      message: `sharge ${packageJson.version} / Node ${process.version}`,
    },
  ];
  const store = await loadSettingsForDoctor(runtime, checks);
  if (!store) {
    return result(checks, 2);
  }

  let resolved: ReturnType<typeof resolveConfig>;
  try {
    resolved = resolveConfig(runtime, store, timezoneOverride);
    checks.push(
      {
        name: "config",
        status: "pass",
        message: `${resolved.baseUrl.value} (${resolved.baseUrl.environment})`,
      },
      {
        name: "timezone",
        status: "pass",
        message: `${resolved.timezone.value} (${resolved.timezone.source})`,
      },
    );
  } catch (error) {
    const failure =
      error instanceof CliFailure
        ? error
        : new CliFailure({
            message: "无法解析配置。",
            nextAction: {
              description: "检查 resolved 配置",
              command: "sharge config show --json",
            },
          });
    checks.push(failedCheck("config", failure));
    return result(checks, failure.exitCode);
  }

  if (!resolved.apiKey) {
    checks.push({
      name: "credential",
      status: "fail",
      message: "尚未登录",
      nextActions: [{ command: "sharge login" }],
    });
  } else {
    checks.push({
      name: "credential",
      status: "pass",
      message: `${resolved.credential.source}:${resolved.credential.keyPrefix}`,
    });
  }

  try {
    await access(store.directoryPath, constants.W_OK);
    checks.push({
      name: "logs",
      status: "pass",
      message: store.logPath,
    });
  } catch {
    checks.push({
      name: "logs",
      status: "fail",
      message: "日志目录不可写",
      nextActions: [{ command: "sharge logs path --json" }],
    });
    return result(checks, 2);
  }

  if (!resolved.apiKey) {
    return result(checks, 3);
  }

  let auth: ApiResponse<Record<string, unknown>>;
  try {
    const operation = apiOperations.authStatus;
    auth = await requestJson<Record<string, unknown>>(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey: resolved.apiKey,
      timezone: resolved.timezone.value,
      method: operation.method,
      path: operation.path,
      timeoutMs: remainingTimeout(deadline),
    });
  } catch (error) {
    if (!(error instanceof CliFailure)) {
      throw error;
    }
    if (error.type === "CREDENTIAL_INVALID") {
      checks.push({
        name: "network",
        status: "pass",
        message: "Open Platform 可连接",
      });
    }
    checks.push(
      failedCheck(
        error.type === "CREDENTIAL_INVALID" ? "auth" : "network",
        error,
      ),
    );
    return result(checks, error.exitCode);
  }
  checks.push(
    {
      name: "network",
      status: "pass",
      message: "Open Platform 可连接",
    },
    {
      name: "auth",
      status: "pass",
      message: `用户 ${String(auth.data.user_id ?? "unknown")}`,
    },
  );

  let scopes: ApiResponse<unknown[]>;
  try {
    const operation = apiOperations.authScopes;
    scopes = await requestJson<unknown[]>(runtime, {
      baseUrl: resolved.baseUrl.value,
      apiKey: resolved.apiKey,
      timezone: resolved.timezone.value,
      method: operation.method,
      path: operation.path,
      timeoutMs: remainingTimeout(deadline),
    });
    if (!Array.isArray(scopes.data)) {
      throw new CliFailure({
        type: "SERVER_ERROR",
        exitCode: 8,
        retryable: true,
        message: "scope 目录响应不是数组。",
        requestId: scopes.requestId,
        httpStatus: 200,
        nextAction: {
          description: "记录 requestId 并诊断 Open Platform",
          command: "sharge doctor --debug",
        },
      });
    }
  } catch (error) {
    if (!(error instanceof CliFailure)) {
      throw error;
    }
    checks.push(failedCheck("scopes", error));
    return result(checks, error.exitCode);
  }
  checks.push({
    name: "scopes",
    status: "pass",
    message: `${scopes.data.length} 个 scope`,
  });
  return result(checks, 0, {
    requestId: scopes.requestId,
    timezone: resolved.timezone.value,
    clientDate: scopes.clientDate,
  });
}
