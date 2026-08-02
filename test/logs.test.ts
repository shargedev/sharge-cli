import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

describe("logs commands", () => {
  it("returns the fixed absolute log path without network access", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-logs-path-"));
    let stdout = "";

    try {
      const exitCode = await runCli(
        ["logs", "path", "--json"],
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
        command: "logs.path",
        data: {
          filePath: join(homeDir, ".sharge", "sharge.log"),
        },
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("fails locally when logs clear omits --yes", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-logs-clear-"));
    let stdout = "";

    try {
      const exitCode = await runCli(
        ["logs", "clear", "--json"],
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

      expect(exitCode).toBe(2);
      expect(JSON.parse(stdout)).toMatchObject({
        ok: false,
        command: "logs.clear",
        error: {
          type: "INVALID_INPUT",
          field: "--yes",
          nextActions: [
            {
              command: "sharge logs clear --yes --json",
            },
          ],
        },
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("clears the current and four rotated logs when --yes is explicit", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sharge-logs-clear-"));
    const configDir = join(homeDir, ".sharge");
    let stdout = "";

    try {
      await mkdir(configDir, { mode: 0o700 });
      for (const suffix of ["", ".1", ".2", ".3", ".4"]) {
        await writeFile(join(configDir, `sharge.log${suffix}`), "{}\n", {
          mode: 0o600,
        });
      }

      const exitCode = await runCli(
        ["logs", "clear", "--yes", "--json"],
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
        command: "logs.clear",
        data: {
          cleared: true,
          removedFiles: 5,
        },
      });
      expect(await readdir(configDir)).toEqual([]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
