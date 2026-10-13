import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { main } from "../src/cli.js";

const exec = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const cleanupPaths: string[] = [];
const requiredSkills = [
  "sharge-calendar",
  "sharge-core",
  "sharge-diary",
  "sharge-notes",
  "sharge-recordings",
];
const skillPaths = requiredSkills.map((skill) => `skills/${skill}/SKILL.md`);

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(path);
  return path;
}

describe("release package", () => {
  it("declares the supported runtime and minimal published files", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      name: "@sharge/cli",
      version: packageJson.version,
      description: "面向 Agent 的 Sharge Open Platform CLI",
      engines: { node: ">=20" },
      bin: { sharge: "dist/index.js" },
      files: ["dist", "README.md", "install.sh", "skills"],
      scripts: { prepack: "npm run build" },
    });
    expect(
      Object.keys(manifest.scripts).filter((name) => name.startsWith("e2e")),
    ).toEqual(["e2e"]);
    expect(manifest.scripts.e2e).toBe("node e2e/run.mjs");
  });

  it("keeps product aliases in user docs rather than machine help", async () => {
    let stdout = "";
    expect(
      await main(
        ["node", "sharge", "--help", "--json"],
        {
          env: {},
          homeDir: tmpdir(),
          cwd: tmpdir(),
          platform: process.platform,
        },
        { stdout: (value) => (stdout += value), stderr: () => {} },
      ),
    ).toBe(0);
    for (const alias of [
      "闪记",
      "Live Photo",
      "AI Live Photo",
      "日程",
      "闪极日程",
      "Loomos Calendar",
      "闪极录音",
      "Loomos Recording",
      "AI 日记",
      "闪极日记",
      "Loomos Diary",
    ]) {
      expect(stdout).not.toContain(alias);
    }
  });

  it("packs and installs the CLI and matching five Skills into an isolated prefix", async () => {
    const workspace = await temporaryDirectory("sharge-package-");
    const prefix = join(workspace, "prefix");
    const home = join(workspace, "home");
    const npmCli = process.env.npm_execpath;
    expect(npmCli).toBeDefined();
    if (!npmCli) throw new Error("npm_execpath is required for package tests");
    const { stdout } = await exec(
      process.execPath,
      [npmCli, "pack", "--json", "--pack-destination", workspace],
      {
        cwd: repositoryRoot,
        env: { ...process.env, HOME: home },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const [manifest] = JSON.parse(stdout);
    const paths = manifest.files.map((file: { path: string }) => file.path);
    expect(paths).toEqual([
      "LICENSE",
      "README.en.md",
      "README.md",
      "dist/index.d.ts",
      "dist/index.js",
      "install.sh",
      "package.json",
      ...skillPaths,
    ]);
    expect(paths.some((path: string) => path.startsWith("plans/"))).toBe(false);
    expect(paths.some((path: string) => path.endsWith(".map"))).toBe(false);

    const tarball = join(workspace, manifest.filename);
    await exec(
      process.execPath,
      [
        npmCli,
        "install",
        "--global",
        "--prefix",
        prefix,
        "--ignore-scripts",
        tarball,
      ],
      {
        cwd: workspace,
        env: { ...process.env, HOME: home },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const binary =
      process.platform === "win32"
        ? join(prefix, "sharge.cmd")
        : join(prefix, "bin", "sharge");
    if (process.platform !== "win32") {
      expect((await stat(binary)).mode & 0o111).not.toBe(0);
    }
    const version = await exec(binary, ["version"], {
      cwd: workspace,
      env: { ...process.env, HOME: home },
      shell: process.platform === "win32",
    });
    expect(version.stdout.trim()).toBe(packageJson.version);
    const help = await exec(binary, ["--help"], {
      cwd: workspace,
      env: { ...process.env, HOME: home },
      shell: process.platform === "win32",
    });
    expect(help.stdout).toContain("面向 Agent 的 Sharge 开放平台命令行工具");
    const installedPackage =
      process.platform === "win32"
        ? join(prefix, "node_modules", "@sharge", "cli")
        : join(prefix, "lib", "node_modules", "@sharge", "cli");
    for (const path of skillPaths) {
      expect(await readFile(join(installedPackage, path), "utf8")).toBe(
        await readFile(join(repositoryRoot, path), "utf8"),
      );
    }
    const validation = await exec(
      process.execPath,
      [
        resolve(repositoryRoot, "scripts/validate-skills.mjs"),
        "--skills-root",
        join(installedPackage, "skills"),
        "--cli",
        join(installedPackage, "dist/index.js"),
        "--scenarios",
        resolve(repositoryRoot, "test/fixtures/skills-scenarios.json"),
      ],
      {
        cwd: workspace,
        env: { ...process.env, HOME: home },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    expect(JSON.parse(validation.stdout)).toMatchObject({
      ok: true,
      skills: 5,
    });
  }, 60_000);

  it("ships an executable installer without install-code support", async () => {
    const installer = resolve(repositoryRoot, "install.sh");
    const source = await readFile(installer, "utf8");
    expect(source.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(source).toContain("--no-login");
    expect(source).toContain("CLI 已安装但登录未完成");
    expect(source).toContain("export PATH=");
    expect(source).not.toContain("install-code");
    if (process.platform !== "win32") {
      expect((await stat(installer)).mode & 0o111).not.toBe(0);
    }
  });
});
