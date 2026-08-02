import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

describe("config show", () => {
  it("discovers config subcommands from offline namespace JSON help", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-config-help-"));
    let stdout = "";

    try {
      const exitCode = await runCli(
        ["config", "--help", "--json"],
        {
          stdout: (value: string) => {
            stdout += value;
          },
          stderr: () => {},
        },
        undefined,
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
      );

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        ok: true,
        command: "config",
        data: {
          commands: expect.arrayContaining([
            expect.objectContaining({ command: "config.show" }),
            expect.objectContaining({ command: "config.set" }),
            expect.objectContaining({ command: "config.unset" }),
          ]),
        },
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("resolves the default service from an isolated HOME and persists only the fixed settings path", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-config-show-"));
    let stdout = "";
    let stderr = "";

    try {
      const exitCode = await runCli(
        ["config", "show", "--json"],
        {
          stdout: (value: string) => {
            stdout += value;
          },
          stderr: (value: string) => {
            stderr += value;
          },
        },
        undefined,
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
      );

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        ok: true,
        command: "config.show",
        data: {
          settingsPath: join(homeDir, ".sharge", "settings.json"),
          installationId: expect.stringMatching(/^install_/),
          baseUrl: {
            value: "https://ai.shargetech.com",
            source: "default",
            environment: "default",
          },
          credential: {
            source: "none",
            keyPrefix: null,
          },
          previousCredential: {
            present: false,
            baseUrl: null,
          },
          logPath: join(homeDir, ".sharge", "sharge.log"),
        },
      });
      expect(stderr).toBe("");
      expect(
        JSON.parse(
          await readFile(join(homeDir, ".sharge", "settings.json"), "utf8"),
        ),
      ).toMatchObject({
        schemaVersion: 1,
        installationId: expect.stringMatching(/^install_/),
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("prefers settings over env and never prints the full API key", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-config-priority-"));
    const configDir = join(homeDir, ".sharge");
    const secret = "lms-settings-super-secret";
    let stdout = "";

    try {
      await mkdir(configDir, { mode: 0o700 });
      await writeFile(
        join(configDir, "settings.json"),
        JSON.stringify({
          schemaVersion: 1,
          installationId: "install_existing",
          baseUrl: "https://api.example.test/",
          apiKey: `Bearer ${secret}`,
          timezone: "Asia/Shanghai",
          previousCredential: {
            baseUrl: "https://ai.shargetech.com",
            apiKey: "lms-previous-secret",
          },
        }),
        { mode: 0o600 },
      );

      const exitCode = await runCli(
        ["config", "show", "--json"],
        {
          stdout: (value: string) => {
            stdout += value;
          },
          stderr: () => {},
        },
        undefined,
        {
          env: {
            SHARGE_API_KEY: "lms-env-secret",
            SHARGE_BASE_URL: "https://auth.example.test",
            SHARGE_TIMEZONE: "Europe/London",
          },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
      );

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        data: {
          installationId: "install_existing",
          baseUrl: {
            value: "https://api.example.test",
            source: "settings",
            environment: "custom",
          },
          credential: {
            source: "settings",
            keyPrefix: expect.stringMatching(/^lms-/),
          },
          timezone: {
            value: "Asia/Shanghai",
            source: "settings",
          },
          previousCredential: {
            present: true,
            baseUrl: "https://ai.shargetech.com",
          },
        },
      });
      expect(stdout).not.toContain(secret);
      expect(stdout).not.toContain("lms-env-secret");
      expect(stdout).not.toContain("lms-previous-secret");
      expect(
        JSON.parse(await readFile(join(configDir, "settings.json"), "utf8")),
      ).toMatchObject({
        baseUrl: "https://api.example.test",
        apiKey: secret,
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("rejects a settings symlink without following it", async () => {
    if (process.platform === "win32") {
      return;
    }
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-config-symlink-"));
    const configDir = join(homeDir, ".sharge");
    const targetPath = join(homeDir, "outside-settings.json");
    let stdout = "";
    let stderr = "";

    try {
      await mkdir(configDir, { mode: 0o700 });
      await writeFile(
        targetPath,
        JSON.stringify({
          schemaVersion: 1,
          installationId: "install_outside",
        }),
      );
      await symlink(targetPath, join(configDir, "settings.json"));

      const exitCode = await runCli(
        ["config", "show", "--json"],
        {
          stdout: (value: string) => {
            stdout += value;
          },
          stderr: (value: string) => {
            stderr += value;
          },
        },
        undefined,
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
      );

      expect(exitCode).toBe(2);
      expect(JSON.parse(stdout)).toMatchObject({
        ok: false,
        command: "config.show",
        error: {
          type: "INVALID_INPUT",
          field: "settingsPath",
          retryable: false,
        },
      });
      expect(stderr).toBe("");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("uses explicit --timezone before settings and environment values", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-config-timezone-"));
    let stdout = "";

    try {
      const exitCode = await runCli(
        ["config", "show", "--timezone", "Asia/Shanghai", "--json"],
        {
          stdout: (value: string) => {
            stdout += value;
          },
          stderr: () => {},
        },
        undefined,
        {
          env: {
            SHARGE_TIMEZONE: "Europe/London",
          },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
      );

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        data: {
          timezone: {
            value: "Asia/Shanghai",
            source: "cli",
          },
        },
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("fast-fails on a selected settings JWT without falling back to env", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-config-jwt-"));
    const configDir = join(homeDir, ".sharge");
    let stdout = "";

    try {
      await mkdir(configDir, { mode: 0o700 });
      await writeFile(
        join(configDir, "settings.json"),
        JSON.stringify({
          schemaVersion: 1,
          installationId: "install_existing",
          apiKey: "header.payload.signature",
        }),
        { mode: 0o600 },
      );

      const exitCode = await runCli(
        ["config", "show", "--json"],
        {
          stdout: (value: string) => {
            stdout += value;
          },
          stderr: () => {},
        },
        undefined,
        {
          env: {
            SHARGE_API_KEY: "lms-valid-env-key",
          },
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
      );

      expect(exitCode).toBe(2);
      expect(JSON.parse(stdout)).toMatchObject({
        ok: false,
        command: "config.show",
        error: {
          type: "INVALID_INPUT",
          field: "apiKey",
          retryable: false,
        },
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("adds a stable installationId to a valid hand-written settings file", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-config-install-"));
    const configDir = join(homeDir, ".sharge");
    const settingsPath = join(configDir, "settings.json");
    let stdout = "";

    try {
      await mkdir(configDir, { mode: 0o700 });
      await writeFile(
        settingsPath,
        JSON.stringify({
          schemaVersion: 1,
          baseUrl: "https://ai.shargetech.com",
        }),
        { mode: 0o600 },
      );

      const runtime = {
        env: {},
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      };
      await runCli(
        ["config", "show", "--json"],
        {
          stdout: (value: string) => {
            stdout += value;
          },
          stderr: () => {},
        },
        undefined,
        runtime,
      );
      const firstId = JSON.parse(stdout).data.installationId;
      expect(firstId).toMatch(/^install_/);
      expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
        schemaVersion: 1,
        installationId: firstId,
        baseUrl: "https://ai.shargetech.com",
      });

      stdout = "";
      await runCli(
        ["config", "show", "--json"],
        {
          stdout: (value: string) => {
            stdout += value;
          },
          stderr: () => {},
        },
        undefined,
        runtime,
      );
      expect(JSON.parse(stdout).data.installationId).toBe(firstId);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("repairs overly broad POSIX directory and settings permissions", async () => {
    if (process.platform === "win32") {
      return;
    }
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-config-mode-"));
    const configDir = join(homeDir, ".sharge");
    const settingsPath = join(configDir, "settings.json");

    try {
      await mkdir(configDir, { mode: 0o777 });
      await writeFile(
        settingsPath,
        JSON.stringify({
          schemaVersion: 1,
          installationId: "install_existing",
        }),
        { mode: 0o666 },
      );
      await chmod(configDir, 0o777);
      await chmod(settingsPath, 0o666);

      await runCli(
        ["config", "show", "--json"],
        {
          stdout: () => {},
          stderr: () => {},
        },
        undefined,
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
      );

      expect((await stat(configDir)).mode & 0o777).toBe(0o700);
      expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
