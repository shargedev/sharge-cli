import { z } from "zod";
import packageJson from "../../package.json" with { type: "json" };
import { type ApiResponse, requestJson } from "../api/client.js";
import type { CommandExecution } from "../cli/definitions.js";
import { normalizeApiKey, resolveConfig } from "../runtime/config.js";
import type { CliRuntime } from "../runtime/context.js";
import { CliFailure } from "../runtime/errors.js";
import { canonicalScopes, OPEN_PLATFORM_SCOPES } from "../runtime/scopes.js";
import { loadOrCreateSettings, writeSettings } from "../runtime/settings.js";

const authorizationSchema = z.object({
  authorization_id: z.string().min(1),
  polling_token: z.string().min(1),
  verification_uri: z.url(),
  verification_uri_complete: z.url(),
  user_code: z.string().min(1),
  expires_in: z.number().int().positive(),
  poll_interval: z.number().int().positive(),
});

const pollSchema = z.object({
  status: z.enum([
    "pending",
    "processing",
    "approved",
    "denied",
    "expired",
    "consumed",
    "superseded",
  ]),
  key: z.string().nullable().optional(),
  key_id: z.number().int().nullable().optional(),
  scopes: z.array(z.string()).nullable().optional(),
  expires_at: z.string().nullable().optional(),
});

const authStatusSchema = z.object({
  scopes: z.array(z.string()),
});

type StatusEmitter = (status: {
  event: string;
  message: string;
  [key: string]: unknown;
}) => void;

function osName(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return "macOS";
  }
  if (platform === "win32") {
    return "Windows";
  }
  if (platform === "linux") {
    return "Linux";
  }
  return platform;
}

function invalidLoginResponse(): CliFailure {
  return new CliFailure({
    type: "SERVER_ERROR",
    exitCode: 8,
    message: "Open Platform 返回了不完整的登录协议响应。",
    nextAction: {
      description: "诊断 Open Platform 协议与连通性",
      command: "sharge doctor --json",
    },
  });
}

function cancelledLogin(): CliFailure {
  return new CliFailure({
    type: "CANCELLED",
    exitCode: 130,
    message: "登录已由用户取消。",
    nextAction: {
      description: "需要登录时重新创建授权会话",
      command: "sharge login --force",
    },
  });
}

function scopesCover(granted: string[], target: readonly string[]): boolean {
  const scopeSet = new Set(granted);
  return target.every((scope) => scopeSet.has(scope));
}

export async function runLogin(
  runtime: CliRuntime,
  options: {
    noBrowser: boolean;
    force: boolean;
    timeoutMs?: number;
    timezoneOverride?: string;
    scopes?: string[];
    emitStatus: StatusEmitter;
  },
): Promise<CommandExecution> {
  const now = runtime.now ?? Date.now;
  const startedAt = now();
  const requestedScopes = options.scopes ?? [];
  const unsupportedScope = requestedScopes.find(
    (scope) =>
      !OPEN_PLATFORM_SCOPES.includes(
        scope as (typeof OPEN_PLATFORM_SCOPES)[number],
      ),
  );
  if (unsupportedScope) {
    throw new CliFailure({
      type: "INVALID_INPUT",
      exitCode: 2,
      field: "--scope",
      message: `不支持的 scope：${unsupportedScope}`,
      nextAction: {
        description: "查看 login 支持的 scope",
        command: "sharge login --help --json",
      },
    });
  }
  const requestedScopeSet = new Set(requestedScopes);
  const scopes =
    requestedScopes.length === 0
      ? [...OPEN_PLATFORM_SCOPES]
      : canonicalScopes(requestedScopeSet);
  const store = await loadOrCreateSettings(runtime);
  const resolved = resolveConfig(runtime, store, options.timezoneOverride);

  if (!options.force && store.settings.apiKey && resolved.apiKey) {
    try {
      const statusResponse = await requestJson<unknown>(runtime, {
        baseUrl: resolved.baseUrl.value,
        apiKey: resolved.apiKey,
        timezone: resolved.timezone.value,
        method: "GET",
        path: "/open-api/v1/auth/status",
        timeoutMs: options.timeoutMs,
      });
      const status = authStatusSchema.safeParse(statusResponse.data);
      if (!status.success) {
        throw invalidLoginResponse();
      }
      if (scopesCover(status.data.scopes, scopes)) {
        return {
          text: "当前 settings 凭证有效且已覆盖目标 scopes，无需重新登录。\n",
          data: {
            changed: false,
            scopes,
          },
          meta: {
            requestId: statusResponse.requestId,
            timezone: resolved.timezone.value,
            clientDate: statusResponse.clientDate,
          },
        };
      }
    } catch (error) {
      if (
        !(error instanceof CliFailure) ||
        error.type !== "CREDENTIAL_INVALID"
      ) {
        throw error;
      }
    }
  }

  // Exercise the same atomic replace path before a one-time credential can
  // ever be claimed. A later write may still fail, but common permission and
  // filesystem failures are discovered before opening the browser.
  await writeSettings(runtime, store.settingsPath, store.settings);

  const createResponse = await requestJson<unknown>(runtime, {
    baseUrl: resolved.baseUrl.value,
    timezone: resolved.timezone.value,
    method: "POST",
    path: "/ai/open-platform/cli-authorizations",
    timeoutMs:
      options.timeoutMs === undefined
        ? undefined
        : Math.max(1, startedAt + options.timeoutMs - now()),
    body: {
      client_id: "sharge-cli",
      installation_id: store.settings.installationId,
      client_info: {
        version: packageJson.version,
        ...(runtime.deviceName ? { device_name: runtime.deviceName } : {}),
        os: osName(runtime.platform),
        arch: process.arch,
      },
      scopes,
    },
  });
  const created = authorizationSchema.safeParse(createResponse.data);
  if (!created.success) {
    throw invalidLoginResponse();
  }
  const authorizationDeadline = now() + created.data.expires_in * 1_000;
  const deadline =
    options.timeoutMs === undefined
      ? authorizationDeadline
      : Math.min(authorizationDeadline, startedAt + options.timeoutMs);

  options.emitStatus({
    event: "authorization.created",
    message: [
      "请在浏览器中完成授权：",
      created.data.verification_uri_complete,
      `核对码：${created.data.user_code}`,
      `授权会话将在 ${created.data.expires_in} 秒后过期。`,
    ].join("\n"),
    authorizationId: created.data.authorization_id,
    userCode: created.data.user_code,
    verificationUriComplete: created.data.verification_uri_complete,
    expiresIn: created.data.expires_in,
  });

  if (!options.noBrowser) {
    const opened = await (runtime.openExternal?.(
      created.data.verification_uri_complete,
    ) ?? Promise.resolve(false));
    options.emitStatus({
      event: opened ? "browser.opened" : "browser.open_failed",
      message: opened
        ? "已尝试在默认浏览器中打开授权页面。"
        : `无法自动打开浏览器，请复制此 URL：${created.data.verification_uri_complete}`,
    });
  }

  const sleep =
    runtime.sleep ??
    (async (milliseconds: number) =>
      await new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const wait = async (milliseconds: number) => {
    try {
      await sleep(milliseconds, runtime.signal);
    } catch (error) {
      if (
        runtime.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw cancelledLogin();
      }
      throw error;
    }
  };
  let nextPollDelayMs = created.data.poll_interval * 1_000;
  for (;;) {
    const remainingBeforeWait = deadline - now();
    if (remainingBeforeWait <= 0) {
      options.emitStatus({
        event: "authorization.expired",
        message: "本地登录等待已超时。",
      });
      throw new CliFailure({
        type: "TIMEOUT",
        exitCode: 8,
        retryable: true,
        message: "登录等待已达到本地总超时。",
        nextAction: {
          description: "重新创建浏览器授权会话",
          command: "sharge login --force",
        },
      });
    }
    if (nextPollDelayMs >= remainingBeforeWait) {
      await wait(remainingBeforeWait);
      options.emitStatus({
        event: "authorization.expired",
        message: "本地登录等待已超时。",
      });
      throw new CliFailure({
        type: "TIMEOUT",
        exitCode: 8,
        retryable: true,
        message: "登录等待已达到本地总超时。",
        nextAction: {
          description: "重新创建浏览器授权会话",
          command: "sharge login --force",
        },
      });
    }
    await wait(nextPollDelayMs);
    let pollResponse: ApiResponse<unknown>;
    try {
      pollResponse = await requestJson<unknown>(runtime, {
        baseUrl: resolved.baseUrl.value,
        timezone: resolved.timezone.value,
        method: "POST",
        path: `/ai/open-platform/cli-authorizations/${encodeURIComponent(created.data.authorization_id)}/poll`,
        timeoutMs: Math.max(1, deadline - now()),
        body: {
          polling_token: created.data.polling_token,
        },
        sensitiveValues: [created.data.polling_token],
        acceptedHttpStatuses: [410],
      });
    } catch (error) {
      if (error instanceof CliFailure && error.type === "RATE_LIMITED") {
        nextPollDelayMs =
          error.retryAfterMs ?? created.data.poll_interval * 1_000;
        options.emitStatus({
          event: "authorization.processing",
          message: "轮询受到限流，将按服务端要求继续等待。",
          retryAfterMs: nextPollDelayMs,
        });
        continue;
      }
      throw error;
    }
    const parsedPoll = pollSchema.safeParse(pollResponse.data);
    if (!parsedPoll.success) {
      throw invalidLoginResponse();
    }
    if (parsedPoll.data.status === "pending") {
      nextPollDelayMs =
        pollResponse.retryAfterMs ?? created.data.poll_interval * 1_000;
      options.emitStatus({
        event: "authorization.pending",
        message: "等待授权…",
      });
      continue;
    }
    if (parsedPoll.data.status === "processing") {
      nextPollDelayMs =
        pollResponse.retryAfterMs ?? created.data.poll_interval * 1_000;
      options.emitStatus({
        event: "authorization.processing",
        message: "正在签发 API Key…",
      });
      continue;
    }
    if (parsedPoll.data.status === "denied") {
      options.emitStatus({
        event: "authorization.denied",
        message: "用户拒绝了本次授权。",
      });
      throw new CliFailure({
        type: "AUTHORIZATION_DENIED",
        exitCode: 3,
        message: "用户拒绝了本次授权。",
        requestId: pollResponse.requestId,
        httpStatus: pollResponse.httpStatus,
        nextAction: {
          description: "需要登录时重新创建浏览器授权会话",
          command: "sharge login --force",
        },
      });
    }
    if (parsedPoll.data.status === "expired") {
      options.emitStatus({
        event: "authorization.expired",
        message: "授权会话已过期。",
      });
      throw new CliFailure({
        type: "AUTHORIZATION_EXPIRED",
        exitCode: 3,
        message: "授权会话已过期。",
        requestId: pollResponse.requestId,
        httpStatus: pollResponse.httpStatus,
        nextAction: {
          description: "重新创建浏览器授权会话",
          command: "sharge login --force",
        },
      });
    }
    if (parsedPoll.data.status === "consumed") {
      options.emitStatus({
        event: "authorization.consumed",
        message: "本次授权的凭证已经被领取。",
      });
      throw new CliFailure({
        type: "AUTHORIZATION_CONSUMED",
        exitCode: 3,
        message: "本次授权的凭证已经被领取，无法再次获取。",
        requestId: pollResponse.requestId,
        httpStatus: pollResponse.httpStatus,
        nextAction: {
          description: "重新授权并轮换 API Key",
          command: "sharge login --force",
        },
      });
    }
    if (parsedPoll.data.status === "superseded") {
      options.emitStatus({
        event: "authorization.superseded",
        message: "同一安装实例的新授权会话已替代当前会话。",
      });
      throw new CliFailure({
        type: "AUTHORIZATION_SUPERSEDED",
        exitCode: 3,
        message: "同一安装实例的新授权会话已替代当前会话。",
        requestId: pollResponse.requestId,
        httpStatus: pollResponse.httpStatus,
        nextAction: {
          description: "使用最新会话重新授权",
          command: "sharge login --force",
        },
      });
    }
    if (parsedPoll.data.status !== "approved") {
      throw new CliFailure({
        type: "CREDENTIAL_INVALID",
        exitCode: 3,
        message: `授权未完成：${parsedPoll.data.status}。`,
        nextAction: {
          description: "重新创建浏览器授权会话",
          command: "sharge login --force",
        },
      });
    }
    if (
      !parsedPoll.data.key ||
      parsedPoll.data.key_id == null ||
      !parsedPoll.data.scopes
    ) {
      throw invalidLoginResponse();
    }

    store.settings.apiKey = normalizeApiKey(parsedPoll.data.key);
    await writeSettings(runtime, store.settingsPath, store.settings);
    options.emitStatus({
      event: "credential.saved",
      message: `API Key 已安全保存到 ${store.settingsPath}。`,
    });
    options.emitStatus({
      event: "authorization.approved",
      message: "登录完成。",
    });
    return {
      text: `登录完成，API Key 已保存到 ${store.settingsPath}。\n`,
      data: {
        changed: true,
        keyId: parsedPoll.data.key_id,
        scopes: parsedPoll.data.scopes,
        expiresAt: parsedPoll.data.expires_at ?? null,
        settingsPath: store.settingsPath,
      },
      meta: {
        requestId: pollResponse.requestId,
        timezone: resolved.timezone.value,
        clientDate: pollResponse.clientDate,
      },
    };
  }
}
