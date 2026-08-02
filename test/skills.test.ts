import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runProcess } from "../e2e/helpers/run-cli.mjs";

const root = resolve(import.meta.dirname, "..");
const validator = resolve(root, "scripts", "validate-skills.mjs");
const requiredSkills = [
  "sharge-core",
  "sharge-notes",
  "sharge-calendar",
  "sharge-recordings",
  "sharge-diary",
];

async function writeMinimalSkills(skillsRoot: string) {
  await Promise.all(
    requiredSkills.map(async (skill) => {
      const skillRoot = resolve(skillsRoot, skill);
      await mkdir(skillRoot);
      await writeFile(
        resolve(skillRoot, "SKILL.md"),
        `---\nname: ${skill}\ndescription: 用于测试 ${skill}；不负责其他领域。\n---\n\n# ${skill}\n`,
      );
    }),
  );
}

async function writeCliStub(directory: string) {
  const path = resolve(directory, "fake-sharge.mjs");
  await writeFile(
    path,
    `const args = process.argv.slice(2);\nconst root = args[0] === "--help";\nconst notesDelete = args[0] === "notes" && args[1] === "delete";\nconst data = root\n  ? { commands: [{ command: "diary", path: ["diary"] }, { command: "diary.get", path: ["diary", "get"] }, { command: "notes.delete", path: ["notes", "delete"] }] }\n  : notesDelete\n    ? { command: "notes.delete", arguments: [{ name: "note-id", required: true }], options: [{ name: "--help", type: "boolean" }, { name: "--json", type: "boolean" }, { name: "--yes", type: "boolean" }, { name: "--dry-run", type: "boolean" }], destructive: true, dryRun: true }\n    : { command: "diary", arguments: [], options: [{ name: "--help", type: "boolean" }, { name: "--json", type: "boolean" }], destructive: false, dryRun: false };\nprocess.stdout.write(JSON.stringify({ schemaVersion: "1", ok: true, command: root ? "sharge" : data.command, data, warnings: [], meta: { runId: "test", requestId: null } }) + "\\n");\n`,
  );
  return path;
}

describe("Sharge Skills", () => {
  it("rejects a skills root without the required initial skills", async () => {
    const emptyRoot = await mkdtemp(resolve(tmpdir(), "sharge-skills-empty-"));

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", emptyRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr)).toMatchObject({
        ok: false,
        errors: expect.arrayContaining([
          expect.stringContaining("missing required skill: sharge-core"),
        ]),
      });
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });

  it("rejects an unreviewed sixth skill in the initial delivery", async () => {
    const skillsRoot = await mkdtemp(resolve(tmpdir(), "sharge-skills-extra-"));
    await writeMinimalSkills(skillsRoot);
    await mkdir(resolve(skillsRoot, "sharge-workflow"));

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "unexpected skill: sharge-workflow",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("requires every skill directory to contain a SKILL.md entry", async () => {
    const skillsRoot = await mkdtemp(resolve(tmpdir(), "sharge-skills-entry-"));
    await Promise.all(
      requiredSkills.map((skill) => mkdir(resolve(skillsRoot, skill))),
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-core: missing SKILL.md",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("rejects frontmatter names that do not match their directory", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-frontmatter-"),
    );
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-core", "SKILL.md"),
      "---\nname: wrong-name\ndescription: 用于测试；不负责其他领域。\n---\n",
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-core: frontmatter name must match the directory",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("keeps frontmatter limited to name and description", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-frontmatter-keys-"),
    );
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-core", "SKILL.md"),
      "---\nname: sharge-core\ndescription: 用于测试；不负责其他领域。\ntriggers:\n  - test\n---\n",
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-core: frontmatter only allows name and description",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("requires descriptions to state positive triggers and exclusions", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-description-"),
    );
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-core", "SKILL.md"),
      "---\nname: sharge-core\ndescription: 通用 CLI 帮助。\n---\n",
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-core: description must include positive triggers and exclusions",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("accepts the folded description style from the specification skeleton", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-folded-description-"),
    );
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-core", "SKILL.md"),
      "---\nname: sharge-core\ndescription: >-\n  用于测试 core；\n  不负责其他领域。\n---\n",
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).not.toContain(
        "sharge-core: description must include positive triggers and exclusions",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid or duplicate YAML frontmatter", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-invalid-yaml-"),
    );
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-core", "SKILL.md"),
      "---\nname: sharge-core\nname: duplicate\ndescription: '未闭合\n---\n",
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-core: invalid YAML frontmatter",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed UTF-8 Skill content", async () => {
    const skillsRoot = await mkdtemp(resolve(tmpdir(), "sharge-skills-utf8-"));
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-core", "SKILL.md"),
      new Uint8Array([0xff, 0xfe, 0xfd]),
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-core/SKILL.md: invalid UTF-8",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("requires frontmatter description to be a string", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-description-type-"),
    );
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-core", "SKILL.md"),
      "---\nname: sharge-core\ndescription:\n  - 用于测试\n  - 不负责其他领域\n---\n",
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-core: frontmatter description must be a string",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("rejects broken local Markdown links", async () => {
    const skillsRoot = await mkdtemp(resolve(tmpdir(), "sharge-skills-link-"));
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-core", "SKILL.md"),
      "---\nname: sharge-core\ndescription: 用于测试；不负责其他领域。\n---\n\n[missing](references/missing.md)\n",
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-core/SKILL.md: broken local link references/missing.md",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("rejects recursive reference graphs", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-reference-"),
    );
    await writeMinimalSkills(skillsRoot);
    const referenceRoot = resolve(skillsRoot, "sharge-calendar", "references");
    await mkdir(referenceRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-calendar", "SKILL.md"),
      "---\nname: sharge-calendar\ndescription: 用于测试；不负责其他领域。\n---\n\n[write](references/write.md)\n",
    );
    await writeFile(resolve(referenceRoot, "write.md"), "[more](more.md)\n");
    await writeFile(resolve(referenceRoot, "more.md"), "# More\n");

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-calendar/references/write.md: reference must not link to another reference",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("rejects cross-skill deep links that bypass the target entry", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-cross-reference-"),
    );
    await writeMinimalSkills(skillsRoot);
    const referenceRoot = resolve(skillsRoot, "sharge-notes", "references");
    await mkdir(referenceRoot);
    await writeFile(resolve(referenceRoot, "deep.md"), "# Deep\n");
    await writeFile(
      resolve(skillsRoot, "sharge-core", "SKILL.md"),
      "---\nname: sharge-core\ndescription: 用于测试；不负责其他领域。\n---\n\n[deep](../sharge-notes/references/deep.md)\n",
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-core/SKILL.md: cross-skill links must target SKILL.md: ../sharge-notes/references/deep.md",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("requires the core skill to cover every shared safety contract", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-safety-"),
    );
    await writeMinimalSkills(skillsRoot);

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toEqual(
        expect.arrayContaining([
          "sharge-core: missing safety contract: no-implicit-login",
          "sharge-core: missing safety contract: no-auto-pagination",
          "sharge-core: missing safety contract: unknown-write-outcome",
        ]),
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("requires core to define conditional help routing", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-conditional-help-"),
    );
    await writeMinimalSkills(skillsRoot);

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toEqual(
        expect.arrayContaining([
          "sharge-core: missing safety contract: stable-read-direct",
          "sharge-core: missing safety contract: capability-help-conditional",
          "sharge-core: missing safety contract: explicit-exclusion-stop",
        ]),
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("requires every domain skill to enter through core and expose handoff", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-handoff-"),
    );
    await writeMinimalSkills(skillsRoot);

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toEqual(
        expect.arrayContaining([
          "sharge-notes: must link to sharge-core",
          "sharge-calendar: missing required section ## Handoff",
        ]),
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it.each([
    "先从 namespace help 选择本次动作，再读取具体命令 help。",
    "无论任务类型，一律读取 namespace help，然后查看具体命令 help。",
  ])("rejects an unconditional namespace-to-command help ritual: %s", async (rule) => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-help-ritual-"),
    );
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-notes", "SKILL.md"),
      `---\nname: sharge-notes\ndescription: 用于测试；不负责其他领域。\n---\n\n${rule}\n`,
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-notes: unconditional namespace-to-command help sequence is forbidden",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("requires every domain skill to expose a shortest-path section", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-shortest-path-"),
    );
    await writeMinimalSkills(skillsRoot);

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-notes: missing required section ## 最短路径",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("requires a direct JSON example for every stable read command", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-stable-path-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    const cli = resolve(fixtureRoot, "fake-stable-sharge.mjs");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-notes", "SKILL.md"),
      "---\nname: sharge-notes\ndescription: 用于测试；不负责其他领域。\n---\n\n## 最短路径\n\n```sh\nsharge notes search --help --json\n```\n",
    );
    await writeFile(
      cli,
      `const args = process.argv.slice(2);\nconst root = args[0] === "--help";\nconst data = root\n  ? { commands: [{ command: "notes.search", path: ["notes", "search"] }] }\n  : { command: "notes.search", arguments: [{ name: "query", required: true }], options: [{ name: "--help", type: "boolean" }, { name: "--json", type: "boolean" }], sideEffects: [], destructive: false, dryRun: false };\nprocess.stdout.write(JSON.stringify({ ok: true, data }) + "\\n");\n`,
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot, "--cli", cli],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-notes: stable command notes search requires a direct --json example",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("requires a specific JSON help example for every risk command", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-risk-help-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    const cli = resolve(fixtureRoot, "fake-risk-sharge.mjs");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-notes", "SKILL.md"),
      "---\nname: sharge-notes\ndescription: 用于测试；不负责其他领域。\n---\n\n## 最短路径\n\n```sh\nsharge notes update 123 --json\n```\n",
    );
    await writeFile(
      cli,
      `const args = process.argv.slice(2);\nconst root = args[0] === "--help";\nconst data = root\n  ? { commands: [{ command: "notes.update", path: ["notes", "update"] }] }\n  : { command: "notes.update", arguments: [{ name: "note-id", required: true }], options: [{ name: "--help", type: "boolean" }, { name: "--json", type: "boolean" }], sideEffects: ["remote-write"], destructive: false, dryRun: true };\nprocess.stdout.write(JSON.stringify({ ok: true, data }) + "\\n");\n`,
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot, "--cli", cli],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-notes: risk command notes update requires a specific --help --json example",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects a declared unavailable command that exists in current CLI help", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-unavailable-command-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    const cli = resolve(fixtureRoot, "fake-create-sharge.mjs");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-notes", "SKILL.md"),
      "---\nname: sharge-notes\ndescription: 用于测试；不负责其他领域。\n---\n\n## 最短路径\n\n当前不存在 `notes create`；直接说明不支持且未执行。\n",
    );
    await writeFile(
      cli,
      `const args = process.argv.slice(2);\nconst root = args[0] === "--help";\nconst data = root\n  ? { commands: [{ command: "notes.create", path: ["notes", "create"] }] }\n  : { command: "notes.create", arguments: [], options: [{ name: "--help", type: "boolean" }, { name: "--json", type: "boolean" }], sideEffects: [], destructive: false, dryRun: false };\nprocess.stdout.write(JSON.stringify({ ok: true, data }) + "\\n");\n`,
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot, "--cli", cli],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-notes: declared unavailable command exists in CLI: notes create",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("does not require a business example for a nested namespace", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-nested-namespace-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    const cli = resolve(fixtureRoot, "fake-namespace-sharge.mjs");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-calendar", "SKILL.md"),
      "---\nname: sharge-calendar\ndescription: 用于测试；不负责其他领域。\n---\n\n## 最短路径\n",
    );
    await writeFile(
      cli,
      `const args = process.argv.slice(2);\nconst root = args[0] === "--help";\nconst data = root\n  ? { commands: [{ command: "calendar.todos", path: ["calendar", "todos"] }] }\n  : { command: "calendar.todos", arguments: [], options: [{ name: "--help", type: "boolean" }, { name: "--json", type: "boolean" }], commands: [{ command: "calendar.todos.set-status", path: ["calendar", "todos", "set-status"] }], sideEffects: [], destructive: false, dryRun: false };\nprocess.stdout.write(JSON.stringify({ ok: true, data }) + "\\n");\n`,
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot, "--cli", cli],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(JSON.parse(result.stderr).errors).not.toContain(
        "sharge-calendar: stable command calendar todos requires a direct --json example",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects commands that are absent from the CLI JSON help contract", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-command-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-diary", "SKILL.md"),
      "---\nname: sharge-diary\ndescription: 用于测试；不负责其他领域。\n---\n\n```sh\nsharge diary future --json\n```\n",
    );
    const cli = await writeCliStub(fixtureRoot);

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot, "--cli", cli],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-diary/SKILL.md: unknown CLI command: sharge diary future --json",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects the removed schema discovery command explicitly", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-schema-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-core", "SKILL.md"),
      "---\nname: sharge-core\ndescription: 用于测试；不负责其他领域。\n---\n\n```sh\nsharge schema notes\n```\n",
    );
    const cli = await writeCliStub(fixtureRoot);

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot, "--cli", cli],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-core/SKILL.md: forbidden schema command: sharge schema notes",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects dry-run on commands whose help does not support it", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-dry-run-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-diary", "SKILL.md"),
      "---\nname: sharge-diary\ndescription: 用于测试；不负责其他领域。\n---\n\n```sh\nsharge diary --dry-run --json\n```\n",
    );
    const cli = await writeCliStub(fixtureRoot);

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot, "--cli", cli],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-diary/SKILL.md: unsupported option --dry-run: sharge diary --dry-run --json",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects examples that omit required positional arguments", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-required-argument-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-notes", "SKILL.md"),
      "---\nname: sharge-notes\ndescription: 用于测试；不负责其他领域。\n---\n\n```sh\nsharge notes delete --dry-run --json\n```\n",
    );
    const cli = await writeCliStub(fixtureRoot);

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot, "--cli", cli],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-notes/SKILL.md: missing required positional argument: sharge notes delete --dry-run --json",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("allows help discovery without the command's business arguments", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-help-argument-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-notes", "SKILL.md"),
      "---\nname: sharge-notes\ndescription: 用于测试；不负责其他领域。\n---\n\n```sh\nsharge notes delete --help --json\n```\n",
    );
    const cli = await writeCliStub(fixtureRoot);

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot, "--cli", cli],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(JSON.parse(result.stderr).errors).not.toContain(
        "sharge-notes/SKILL.md: missing required positional argument: sharge notes delete --help --json",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("allows stdin marker as the value of a string option", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-stdin-value-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    const cli = resolve(fixtureRoot, "fake-input-sharge.mjs");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-notes", "SKILL.md"),
      "---\nname: sharge-notes\ndescription: 用于测试；不负责其他领域。\n---\n\n```sh\nsharge notes update 123 --input - --dry-run --json\n```\n",
    );
    await writeFile(
      cli,
      `const args = process.argv.slice(2);\nconst root = args[0] === "--help";\nconst data = root\n  ? { commands: [{ command: "notes.update", path: ["notes", "update"] }] }\n  : { command: "notes.update", arguments: [{ name: "note-id", required: true }], options: [{ name: "--input", type: "string" }, { name: "--dry-run", type: "boolean" }, { name: "--json", type: "boolean" }, { name: "--help", type: "boolean" }], destructive: false, dryRun: true };\nprocess.stdout.write(JSON.stringify({ ok: true, data }) + "\\n");\n`,
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot, "--cli", cli],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(JSON.parse(result.stderr).errors).not.toContain(
        "sharge-notes/SKILL.md: missing value for option --input: sharge notes update 123 --input - --dry-run --json",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects destructive execution examples that bypass --yes", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-destructive-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      resolve(skillsRoot, "sharge-notes", "SKILL.md"),
      "---\nname: sharge-notes\ndescription: 用于测试；不负责其他领域。\n---\n\n```sh\nsharge notes delete 123 --json\n```\n",
    );
    const cli = await writeCliStub(fixtureRoot);

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot, "--cli", cli],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "sharge-notes/SKILL.md: destructive command example must include --yes or --dry-run: sharge notes delete 123 --json",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("requires positive, exclusion and recovery scenarios for every skill", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-scenarios-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    const scenarios = resolve(fixtureRoot, "scenarios.json");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      scenarios,
      `${JSON.stringify([
        {
          id: "core-positive",
          skill: "sharge-core",
          kind: "positive",
          prompt: "检查登录状态",
          allowedSideEffects: [],
          completion: "报告结构化结果",
        },
      ])}\n`,
    );

    try {
      const result = await runProcess(
        [
          "node",
          validator,
          "--skills-root",
          skillsRoot,
          "--scenarios",
          scenarios,
        ],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toEqual(
        expect.arrayContaining([
          "scenarios: sharge-core missing exclusion scenario",
          "scenarios: sharge-diary missing recovery scenario",
        ]),
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("validates the repository initial skill set and scenario matrix", async () => {
    const result = await runProcess(
      [
        "node",
        validator,
        "--skills-root",
        resolve(root, "skills"),
        "--scenarios",
        resolve(root, "test", "fixtures", "skills-scenarios.json"),
      ],
      { cwd: root, timeoutMs: 5_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      skills: 5,
      scenarios: 15,
    });
  });

  it("rejects repeated instruction lines as deslop", async () => {
    const skillsRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-deslop-"),
    );
    await writeMinimalSkills(skillsRoot);
    const duplicate = "- 这是一条完全重复且没有语义差异的长规则。";
    await writeFile(
      resolve(skillsRoot, "sharge-core", "SKILL.md"),
      `---\nname: sharge-core\ndescription: 用于测试；不负责其他领域。\n---\n\n${duplicate}\n${duplicate}\n`,
    );

    try {
      const result = await runProcess(
        ["node", validator, "--skills-root", skillsRoot],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        `sharge-core/SKILL.md: duplicate instruction line: ${duplicate}`,
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  it("rejects scenario fixtures that contain credential-shaped values", async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), "sharge-skills-scenario-secret-"),
    );
    const skillsRoot = resolve(fixtureRoot, "skills");
    const scenarios = resolve(fixtureRoot, "scenarios.json");
    await mkdir(skillsRoot);
    await writeMinimalSkills(skillsRoot);
    await writeFile(
      scenarios,
      `${JSON.stringify([
        {
          id: "unsafe-secret",
          skill: "sharge-core",
          kind: "positive",
          prompt: "检查 lms-test-secret",
          allowedSideEffects: [],
          completion: "拒绝泄漏",
        },
      ])}\n`,
    );

    try {
      const result = await runProcess(
        [
          "node",
          validator,
          "--skills-root",
          skillsRoot,
          "--scenarios",
          scenarios,
        ],
        { cwd: root, timeoutMs: 5_000 },
      );

      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr).errors).toContain(
        "unsafe-secret: contains forbidden credential material",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
