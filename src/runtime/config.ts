import type { CliRuntime } from "./context.js";
import { CliFailure } from "./errors.js";
import type { SettingsStore } from "./settings.js";

export const DEFAULT_BASE_URL = "https://ai.shargetech.com";

export type ValueSource =
  | "cli"
  | "settings"
  | "env"
  | "default"
  | "system"
  | "none";

function invalidConfig(field: string, message: string): CliFailure {
  return new CliFailure({
    message,
    field,
    nextAction: {
      description: "查看 resolved 配置与来源",
      command: "sharge config show --json",
    },
  });
}

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidConfig("baseUrl", "Base URL 不是有效 URL。");
  }
  const localhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localhost)) {
    throw invalidConfig(
      "baseUrl",
      "Base URL 必须使用 HTTPS；localhost 可以使用 HTTP。",
    );
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw invalidConfig(
      "baseUrl",
      "Base URL 必须是纯 origin，不能包含 credential、path、query 或 fragment。",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

export function normalizeApiKey(value: string): string {
  const normalized = value.trim().replace(/^Bearer\s+/i, "");
  if (!normalized.startsWith("lms-") || /\s/.test(normalized)) {
    throw invalidConfig("apiKey", "API Key 必须是 lms-...；不接受 JWT。");
  }
  return normalized;
}

export function validateTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw invalidConfig("timezone", "Timezone 必须是有效 IANA 名称。");
  }
  return value;
}

export function environmentName(baseUrl: string): string {
  return baseUrl === DEFAULT_BASE_URL ? "default" : "custom";
}

function keyPrefix(apiKey: string | null): string | null {
  return apiKey ? `${apiKey.slice(0, 8)}…` : null;
}

export function resolveConfig(
  runtime: CliRuntime,
  store: SettingsStore,
  timezoneOverride?: string,
  options: { validateCredential?: boolean } = {},
) {
  const rawBaseUrl =
    store.settings.baseUrl ?? runtime.env.SHARGE_BASE_URL ?? DEFAULT_BASE_URL;
  const baseUrlSource: ValueSource = store.settings.baseUrl
    ? "settings"
    : runtime.env.SHARGE_BASE_URL
      ? "env"
      : "default";
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  const rawApiKey = store.settings.apiKey ?? runtime.env.SHARGE_API_KEY ?? null;
  const credentialSource: ValueSource = store.settings.apiKey
    ? "settings"
    : runtime.env.SHARGE_API_KEY
      ? "env"
      : "none";
  const apiKey =
    options.validateCredential === false
      ? null
      : rawApiKey
        ? normalizeApiKey(rawApiKey)
        : null;

  const systemTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const rawTimezone =
    timezoneOverride ??
    store.settings.timezone ??
    runtime.env.SHARGE_TIMEZONE ??
    systemTimezone;
  const timezoneSource: ValueSource = timezoneOverride
    ? "cli"
    : store.settings.timezone
      ? "settings"
      : runtime.env.SHARGE_TIMEZONE
        ? "env"
        : "system";
  const timezone = validateTimezone(rawTimezone);

  return {
    baseUrl: {
      value: baseUrl,
      source: baseUrlSource,
      environment: environmentName(baseUrl),
    },
    credential: {
      source: credentialSource,
      keyPrefix: keyPrefix(apiKey),
    },
    timezone: {
      value: timezone,
      source: timezoneSource,
    },
    apiKey,
  };
}
