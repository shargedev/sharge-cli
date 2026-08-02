import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  normalizeApiKey,
  normalizeBaseUrl,
  validateTimezone,
} from "./config.js";
import type { CliRuntime } from "./context.js";
import { CliFailure } from "./errors.js";
import { hardenPermissions } from "./file-security.js";

export type Credential = {
  baseUrl: string;
  apiKey: string;
};

export type Settings = {
  schemaVersion: 1;
  installationId: string;
  baseUrl?: string;
  apiKey?: string;
  timezone?: string;
  previousCredential?: Credential;
};

export type SettingsStore = {
  directoryPath: string;
  settingsPath: string;
  logPath: string;
  settings: Settings;
};

const credentialSchema = z
  .object({
    baseUrl: z.string().min(1),
    apiKey: z.string().min(1),
  })
  .strict();

const settingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    installationId: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    previousCredential: credentialSchema.optional(),
  })
  .strict();

export function settingsPaths(runtime: CliRuntime) {
  const directoryPath = join(runtime.homeDir, ".sharge");
  return {
    directoryPath,
    settingsPath: join(directoryPath, "settings.json"),
    logPath: join(directoryPath, "sharge.log"),
  };
}

function unsafePath(path: string, field: string): CliFailure {
  return new CliFailure({
    message: `拒绝使用不安全的文件路径：${path}`,
    field,
    nextAction: {
      description: "移除符号链接后重新运行",
      command: "sharge config show --json",
    },
  });
}

async function ensureSecureDirectory(
  runtime: CliRuntime,
  directoryPath: string,
): Promise<void> {
  try {
    const metadata = await lstat(directoryPath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw unsafePath(directoryPath, "settingsPath");
    }
  } catch (error) {
    if (
      error instanceof CliFailure ||
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    await mkdir(directoryPath, {
      recursive: true,
      mode: 0o700,
    });
  }
  await hardenPermissions(runtime, directoryPath, "directory");
}

async function settingsFileExists(settingsPath: string): Promise<boolean> {
  try {
    const metadata = await lstat(settingsPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw unsafePath(settingsPath, "settingsPath");
    }
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readSettingsFile(
  runtime: CliRuntime,
  settingsPath: string,
): Promise<string> {
  const noFollow = runtime.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  const handle = await open(settingsPath, constants.O_RDONLY | noFollow);
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function invalidSettings(settingsPath: string, message: string): CliFailure {
  return new CliFailure({
    message: `${message} 路径：${settingsPath}`,
    field: "settingsPath",
    nextAction: {
      description: "修复 settings.json 后重新查看配置",
      command: "sharge config show --json",
    },
  });
}

export async function writeSettings(
  runtime: CliRuntime,
  settingsPath: string,
  settings: Settings,
): Promise<void> {
  const temporaryPath = `${settingsPath}.tmp-${process.pid}-${randomUUID()}`;
  const contents = `${JSON.stringify(settings, null, 2)}\n`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await hardenPermissions(runtime, temporaryPath, "file");
    if (runtime.env.SHARGE_INTERNAL_TEST_FAIL_SETTINGS_RENAME === "1") {
      throw new Error("injected settings rename failure");
    }
    await rename(temporaryPath, settingsPath);
    await hardenPermissions(runtime, settingsPath, "file");
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function loadOrCreateSettings(
  runtime: CliRuntime,
  options: { validateCredentials?: boolean } = {},
): Promise<SettingsStore> {
  const paths = settingsPaths(runtime);
  await ensureSecureDirectory(runtime, paths.directoryPath);

  let settings: Settings;
  if (await settingsFileExists(paths.settingsPath)) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readSettingsFile(runtime, paths.settingsPath));
    } catch {
      throw invalidSettings(
        paths.settingsPath,
        "settings.json 不是有效 JSON。",
      );
    }
    const parsed = settingsSchema.safeParse(raw);
    if (!parsed.success) {
      throw invalidSettings(
        paths.settingsPath,
        `settings.json 不符合 schema：${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    settings = {
      ...parsed.data,
      installationId: parsed.data.installationId ?? `install_${randomUUID()}`,
    };
    let normalized = !parsed.data.installationId;
    if (settings.baseUrl) {
      const value = normalizeBaseUrl(settings.baseUrl);
      normalized ||= value !== settings.baseUrl;
      settings.baseUrl = value;
    }
    if (settings.apiKey && options.validateCredentials !== false) {
      const value = normalizeApiKey(settings.apiKey);
      normalized ||= value !== settings.apiKey;
      settings.apiKey = value;
    }
    if (settings.timezone) {
      settings.timezone = validateTimezone(settings.timezone);
    }
    if (settings.previousCredential) {
      const previousBaseUrl = normalizeBaseUrl(
        settings.previousCredential.baseUrl,
      );
      const previousApiKey =
        options.validateCredentials === false
          ? settings.previousCredential.apiKey
          : normalizeApiKey(settings.previousCredential.apiKey);
      normalized ||=
        previousBaseUrl !== settings.previousCredential.baseUrl ||
        previousApiKey !== settings.previousCredential.apiKey;
      settings.previousCredential = {
        baseUrl: previousBaseUrl,
        apiKey: previousApiKey,
      };
    }
    if (normalized) {
      await writeSettings(runtime, paths.settingsPath, settings);
    }
    await hardenPermissions(runtime, paths.settingsPath, "file");
  } else {
    settings = {
      schemaVersion: 1,
      installationId: `install_${randomUUID()}`,
    };
    await writeSettings(runtime, paths.settingsPath, settings);
  }

  return {
    ...paths,
    settings,
  };
}
