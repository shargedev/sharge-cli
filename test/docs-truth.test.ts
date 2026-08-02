import { access, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { main } from "../src/cli.js";

const root = resolve(import.meta.dirname, "..");

async function rootHelpCommands(): Promise<string[]> {
  let stdout = "";
  const exitCode = await main(
    ["node", "sharge", "--help", "--json"],
    {
      env: {},
      homeDir: tmpdir(),
      cwd: tmpdir(),
      platform: process.platform,
    },
    { stdout: (value) => (stdout += value), stderr: () => {} },
  );
  expect(exitCode).toBe(0);
  return JSON.parse(stdout).data.commands.map(
    (entry: { command: string }) => entry.command,
  );
}

async function textFiles(relativePath: string): Promise<string[]> {
  const absolutePath = resolve(root, relativePath);
  if ((await stat(absolutePath)).isFile()) {
    return [absolutePath];
  }
  const children = await readdir(absolutePath);
  return (
    await Promise.all(
      children.map((child) => textFiles(`${relativePath}/${child}`)),
    )
  ).flat();
}

describe("repository truth", () => {
  it("has one documented reference heading for every executable command", async () => {
    const commandFiles = [
      "system.md",
      "notes.md",
      "calendar.md",
      "recordings.md",
      "diary.md",
    ];
    const documented = new Set<string>();
    for (const filename of commandFiles) {
      const source = await readFile(
        resolve(root, "docs", "commands", filename),
        "utf8",
      );
      for (const match of source.matchAll(/^## `sharge ([a-z][a-z -]*)`$/gm)) {
        documented.add(match[1].replaceAll(" ", "."));
      }
    }
    const namespaceOnly = new Set([
      "notes",
      "calendar",
      "calendar.todos",
      "recordings",
      "diary",
      "auth",
      "config",
      "logs",
    ]);
    const executable = (await rootHelpCommands()).filter(
      (command) => !namespaceOnly.has(command),
    );
    expect([...documented].sort()).toEqual(executable.sort());
  });

  it("does not claim that the shipped v1 command tree is still pending", async () => {
    for (const path of [
      "README.md",
      "AGENTS.md",
      "docs/README.md",
      "docs/getting-started.md",
      "docs/commands/README.md",
    ]) {
      const source = await readFile(resolve(root, path), "utf8");
      for (const stale of [
        "当前旧实现",
        "尚待实现",
        "sharge schema",
        "sharge calendar months",
        "sharge calendar events",
        "sharge notes create --",
      ]) {
        expect(source, `${path} contains ${stale}`).not.toContain(stale);
      }
    }
  });

  it("documents the repository-backed Skills installation path", async () => {
    for (const path of ["README.md", "docs/getting-started.md", "AGENTS.md"]) {
      const source = await readFile(resolve(root, path), "utf8");
      expect(source).toContain("npx skills add shargedev/sharge-cli -y -g");
    }
  });

  it("does not expose private service hostnames", async () => {
    const forbiddenHosts = [
      ["dev-ai", "shargetech", "com"].join("."),
      ["app", "loomos", "ai"].join("."),
    ];
    const files = (
      await Promise.all(
        [
          "README.md",
          "AGENTS.md",
          "package.json",
          "src",
          "docs",
          "test",
          "e2e",
          "contracts",
          "scripts",
          "skills",
        ].map(textFiles),
      )
    ).flat();

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const hostname of forbiddenHosts) {
        expect(source, `${file} contains a private hostname`).not.toContain(
          hostname,
        );
      }
    }
  });

  it("documents the package-backed CLI version instead of a stale example", async () => {
    const source = await readFile(
      resolve(root, "docs", "commands", "system.md"),
      "utf8",
    );

    expect(source).toContain(`"version": "${packageJson.version}"`);
    expect(source).not.toContain('"version": "1.0.0"');
  });

  it("has removed unpublished compatibility and planning assets", async () => {
    for (const path of [
      "src/runtime.ts",
      "src/normalize.ts",
      "src/types.ts",
      "src/schema-registry.ts",
      "plans/PLAN.md",
      "plans/SKILLS.md",
      ".cursor/plans/skills_user-facing_cleanup_1ec5a89b.plan.md",
    ]) {
      await expect(access(resolve(root, path))).rejects.toThrow();
    }
  });
});
