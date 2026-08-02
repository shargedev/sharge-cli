import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

describe("config set/unset", () => {
  it("swaps the active and previous credentials when switching to the cached URL", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-config-set-"));
    const configDir = join(homeDir, ".sharge");
    const settingsPath = join(configDir, "settings.json");
    let stdout = "";

    try {
      await mkdir(configDir, { mode: 0o700 });
      await writeFile(
        settingsPath,
        JSON.stringify({
          schemaVersion: 1,
          installationId: "install_existing",
          baseUrl: "https://ai.shargetech.com",
          apiKey: "lms-cn-secret",
          previousCredential: {
            baseUrl: "https://api.example.test",
            apiKey: "lms-test-secret",
          },
        }),
        { mode: 0o600 },
      );

      const exitCode = await runCli(
        ["config", "set", "base-url", "https://api.example.test", "--json"],
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
        command: "config.set",
        data: {
          changed: true,
          key: "base-url",
          value: "https://api.example.test",
          environment: "custom",
          credentialRestored: true,
        },
      });
      expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
        baseUrl: "https://api.example.test",
        apiKey: "lms-test-secret",
        previousCredential: {
          baseUrl: "https://ai.shargetech.com",
          apiKey: "lms-cn-secret",
        },
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("applies the same credential swap when unsetting base-url changes the resolved URL", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-config-unset-"));
    const configDir = join(homeDir, ".sharge");
    const settingsPath = join(configDir, "settings.json");
    let stdout = "";

    try {
      await mkdir(configDir, { mode: 0o700 });
      await writeFile(
        settingsPath,
        JSON.stringify({
          schemaVersion: 1,
          installationId: "install_existing",
          baseUrl: "https://api.example.test",
          apiKey: "lms-test-secret",
          previousCredential: {
            baseUrl: "https://ai.shargetech.com",
            apiKey: "lms-cn-secret",
          },
        }),
        { mode: 0o600 },
      );

      const exitCode = await runCli(
        ["config", "unset", "base-url", "--json"],
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
        command: "config.unset",
        data: {
          changed: true,
          key: "base-url",
          value: "https://ai.shargetech.com",
          source: "default",
          credentialRestored: true,
        },
      });
      const settings = JSON.parse(await readFile(settingsPath, "utf8"));
      expect(settings).not.toHaveProperty("baseUrl");
      expect(settings).toMatchObject({
        apiKey: "lms-cn-secret",
        previousCredential: {
          baseUrl: "https://api.example.test",
          apiKey: "lms-test-secret",
        },
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
