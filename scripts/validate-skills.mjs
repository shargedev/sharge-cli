#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";

const execFileAsync = promisify(execFile);

const REQUIRED_SKILLS = [
  "sharge-core",
  "sharge-notes",
  "sharge-calendar",
  "sharge-recordings",
  "sharge-diary",
];

const CORE_SAFETY_CONTRACTS = [
  ["help-json", (source) => source.includes("`--help --json`")],
  [
    "stable-read-direct",
    (source) => source.includes("稳定读入口") && source.includes("直接执行"),
  ],
  [
    "capability-help-conditional",
    (source) => source.includes("namespace help") && source.includes("未明确"),
  ],
  [
    "specific-risk-help",
    (source) => source.includes("风险操作") && source.includes("具体命令 help"),
  ],
  [
    "explicit-exclusion-stop",
    (source) => source.includes("明确排除") && source.includes("未执行"),
  ],
  ["no-schema-command", (source) => source.includes("没有 `schema` 命令")],
  ["no-implicit-login", (source) => source.includes("业务命令不会隐式登录")],
  [
    "scope-recovery",
    (source) =>
      source.includes("`SCOPE_REQUIRED`") &&
      source.includes("`requiredScopes` 和 `nextActions.command`"),
  ],
  ["machine-json", (source) => source.includes("机器消费显式使用 `--json`")],
  [
    "opaque-identifiers",
    (source) => source.includes("opaque ID、identifier、instance ID 和 cursor"),
  ],
  ["no-auto-pagination", (source) => source.includes("不自动翻页")],
  [
    "conditional-dry-run",
    (source) => source.includes("只有 JSON help 声明 `dryRun: true`"),
  ],
  [
    "explicit-delete",
    (source) =>
      source.includes("明确的用户删除意图") && source.includes("`--yes`"),
  ],
  [
    "explicit-overwrite",
    (source) =>
      source.includes("明确允许覆盖") && source.includes("`--overwrite`"),
  ],
  [
    "credential-safety",
    (source) =>
      source.includes("API Key、polling token") && source.includes("不得暴露"),
  ],
  [
    "unknown-write-outcome",
    (source) =>
      source.includes('`outcome: "unknown"`') &&
      source.includes("绝不自动重发"),
  ],
  [
    "respect-retryable",
    (source) => source.includes("`retryable` 是考虑重试的必要条件"),
  ],
  [
    "no-auto-retry",
    (source) => source.includes("不自动重试 network、timeout、429 或 5xx"),
  ],
];

const DOMAIN_SECTIONS = ["范围", "最短路径", "执行", "领域规则", "Handoff"];
const UNCONDITIONAL_HELP_SEQUENCE =
  /(?:先|总是|一律|必须|每次)[^\n。；]{0,80}namespace help[^\n。；]{0,120}(?:再|然后)[^\n。；]{0,80}具体命令(?:的)?[^\n。；]{0,40}help/u;

function optionValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readUtf8(path) {
  return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
}

function linksToReferenceInAnotherSkill(skillsRoot, skill, target) {
  const parts = relative(skillsRoot, target).split(sep);
  return parts[0] !== skill && parts[1] === "references";
}

function linksToAnySkillReference(skillsRoot, target) {
  return relative(skillsRoot, target).split(sep)[1] === "references";
}

async function referenceFiles(skillRoot, skill, errors) {
  const referencesRoot = resolve(skillRoot, "references");
  if (!(await pathExists(referencesRoot))) {
    return [];
  }
  const entries = await readdir(referencesRoot, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      errors.push(
        `${skill}/references: nested reference directories are forbidden`,
      );
    } else if (entry.name.endsWith(".md")) {
      files.push(resolve(referencesRoot, entry.name));
    }
  }
  return files;
}

function parseFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return null;
  }
  try {
    const value = parseYaml(match[1], { uniqueKeys: true });
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value;
  } catch {
    return undefined;
  }
}

function markdownLinks(source) {
  const links = [];
  let fenced = false;
  for (const line of source.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }
    for (const match of line.matchAll(/\]\(([^)]+)\)/g)) {
      links.push(match[1]);
    }
  }
  return links;
}

function shargeCommandLines(source) {
  const commands = [];
  let fenced = false;
  for (const line of source.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    const trimmed = line.trim();
    if (fenced && trimmed.startsWith("sharge ")) {
      commands.push(trimmed);
    }
  }
  return commands;
}

function duplicateInstructionLines(source) {
  const counts = new Map();
  let fenced = false;
  for (const line of source.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    const trimmed = line.trim();
    if (
      fenced ||
      trimmed.length < 20 ||
      (!trimmed.startsWith("- ") && !/^\d+\. /.test(trimmed))
    ) {
      continue;
    }
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([line]) => line);
}

function shellTokens(command) {
  return (command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((token) =>
    token.replace(/^(["'])(.*)\1$/, "$2"),
  );
}

function documentedCommandTokens(source) {
  return shargeCommandLines(source).map((line) => shellTokens(line).slice(1));
}

function startsWithPath(tokens, path) {
  return path.every((part, index) => tokens[index] === part);
}

function unavailableCommandPaths(source) {
  return source
    .split("\n")
    .filter((line) => line.includes("不存在") && line.includes("未执行"))
    .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)])
    .map((match) => match[1].trim().split(/\s+/u))
    .filter((path) => path.length >= 2 && path.every(Boolean));
}

async function cliHelp(cliPath, args, homeDir) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, ...args, "--help", "--json"],
    {
      env: { ...process.env, HOME: homeDir },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const envelope = JSON.parse(stdout);
  if (envelope.ok !== true || !envelope.data) {
    throw new Error(`CLI help failed for ${args.join(" ") || "root"}`);
  }
  return envelope.data;
}

async function validateCliCommands(cliPath, documents, errors) {
  const homeDir = await mkdtemp(resolve(tmpdir(), "sharge-skills-help-"));
  try {
    const rootHelp = await cliHelp(cliPath, [], homeDir);
    const commands = rootHelp.commands ?? [];
    const helpCache = new Map();
    for (const document of documents) {
      for (const line of shargeCommandLines(document.source)) {
        const tokens = shellTokens(line).slice(1);
        if (tokens[0] === "schema") {
          errors.push(`${document.label}: forbidden schema command: ${line}`);
          continue;
        }
        const candidates = commands
          .filter(
            (command) =>
              Array.isArray(command.path) &&
              command.path.every((part, index) => tokens[index] === part),
          )
          .sort((left, right) => right.path.length - left.path.length);
        const command = candidates[0];
        if (!command) {
          errors.push(`${document.label}: unknown CLI command: ${line}`);
          continue;
        }
        const cacheKey = command.path.join(" ");
        let help = helpCache.get(cacheKey);
        if (!help) {
          help = await cliHelp(cliPath, command.path, homeDir);
          helpCache.set(cacheKey, help);
        }
        const options = new Map();
        for (const option of help.options ?? []) {
          options.set(option.name, option);
          for (const alias of option.aliases ?? []) {
            options.set(alias, option);
          }
        }
        let positionalCount = 0;
        const remaining = tokens.slice(command.path.length);
        for (let index = 0; index < remaining.length; index += 1) {
          const token = remaining[index];
          if (!token.startsWith("-")) {
            positionalCount += 1;
            continue;
          }
          const option = options.get(token);
          if (!option) {
            errors.push(
              `${document.label}: unsupported option ${token}: ${line}`,
            );
            continue;
          }
          if (option.type === "string") {
            if (
              index + 1 >= remaining.length ||
              (remaining[index + 1].startsWith("-") &&
                remaining[index + 1] !== "-")
            ) {
              errors.push(
                `${document.label}: missing value for option ${token}: ${line}`,
              );
              continue;
            }
            index += 1;
          }
        }
        const requiredArguments = (help.arguments ?? []).filter(
          (argument) => argument.required === true,
        ).length;
        if (positionalCount < requiredArguments && !tokens.includes("--help")) {
          errors.push(
            `${document.label}: missing required positional argument: ${line}`,
          );
        } else if (positionalCount > (help.arguments ?? []).length) {
          errors.push(`${document.label}: unknown CLI command: ${line}`);
        }
        if (tokens.includes("--dry-run") && help.dryRun !== true) {
          errors.push(
            `${document.label}: command does not declare dryRun: true: ${line}`,
          );
        }
        if (
          help.destructive === true &&
          !tokens.includes("--help") &&
          !tokens.includes("--yes") &&
          !tokens.includes("--dry-run")
        ) {
          errors.push(
            `${document.label}: destructive command example must include --yes or --dry-run: ${line}`,
          );
        }
      }
    }
  } catch (error) {
    errors.push(`CLI help validation failed: ${error.message}`);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

async function validateHelpPaths(cliPath, skillSources, errors) {
  const homeDir = await mkdtemp(resolve(tmpdir(), "sharge-skills-paths-"));
  try {
    const rootHelp = await cliHelp(cliPath, [], homeDir);
    for (const [skill, source] of skillSources) {
      if (skill === "sharge-core") continue;
      const domain = skill.slice("sharge-".length);
      const examples = documentedCommandTokens(source);
      const commands = rootHelp.commands ?? [];
      for (const path of unavailableCommandPaths(source)) {
        if (
          commands.some(
            (command) =>
              Array.isArray(command.path) &&
              command.path.length === path.length &&
              startsWithPath(command.path, path),
          )
        ) {
          errors.push(
            `${skill}: declared unavailable command exists in CLI: ${path.join(" ")}`,
          );
        }
      }
      for (const command of commands) {
        if (
          !Array.isArray(command.path) ||
          command.path.length < 2 ||
          command.path[0] !== domain
        ) {
          continue;
        }
        const help = await cliHelp(cliPath, command.path, homeDir);
        if (Array.isArray(help.commands) && help.commands.length > 0) continue;
        const risky =
          help.destructive === true ||
          help.dryRun === true ||
          (Array.isArray(help.sideEffects) && help.sideEffects.length > 0);
        const covered = examples.some(
          (tokens) =>
            startsWithPath(tokens, command.path) &&
            tokens.includes("--json") &&
            (risky
              ? tokens.includes("--help")
              : !tokens.includes("--help") && !tokens.includes("--dry-run")),
        );
        if (!covered) {
          const path = command.path.join(" ");
          errors.push(
            risky
              ? `${skill}: risk command ${path} requires a specific --help --json example`
              : `${skill}: stable command ${path} requires a direct --json example`,
          );
        }
      }
    }
  } catch (error) {
    errors.push(`CLI help path validation failed: ${error.message}`);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

async function validateScenarios(path, errors) {
  let scenarios;
  try {
    scenarios = JSON.parse(await readUtf8(path));
  } catch (error) {
    errors.push(`scenarios: cannot read valid JSON: ${error.message}`);
    return 0;
  }
  if (!Array.isArray(scenarios)) {
    errors.push("scenarios: root must be an array");
    return 0;
  }
  const seenIds = new Set();
  for (const scenario of scenarios) {
    if (!scenario || typeof scenario !== "object") {
      errors.push("scenarios: every entry must be an object");
      continue;
    }
    const serializedScenario = JSON.stringify(scenario);
    if (
      /\blms-[A-Za-z0-9._~-]{4,}\b/.test(serializedScenario) ||
      /\bBearer\s+[A-Za-z0-9._~-]{4,}\b/i.test(serializedScenario) ||
      /[?&](?:api[_-]?key|token|sig|signature)=[^&\s"']+/i.test(
        serializedScenario,
      )
    ) {
      errors.push(
        `${scenario.id ?? "unknown"}: contains forbidden credential material`,
      );
    }
    if (typeof scenario.id !== "string" || !scenario.id) {
      errors.push("scenarios: every entry requires an id");
    } else if (seenIds.has(scenario.id)) {
      errors.push(`scenarios: duplicate id ${scenario.id}`);
    } else {
      seenIds.add(scenario.id);
    }
    if (!REQUIRED_SKILLS.includes(scenario.skill)) {
      errors.push(`${scenario.id ?? "unknown"}: invalid skill`);
    }
    if (!["positive", "exclusion", "recovery"].includes(scenario.kind)) {
      errors.push(`${scenario.id ?? "unknown"}: invalid kind`);
    }
    if (typeof scenario.prompt !== "string" || !scenario.prompt.trim()) {
      errors.push(`${scenario.id ?? "unknown"}: missing prompt`);
    }
    if (!Array.isArray(scenario.allowedSideEffects)) {
      errors.push(
        `${scenario.id ?? "unknown"}: allowedSideEffects must be an array`,
      );
    }
    if (
      typeof scenario.completion !== "string" ||
      !scenario.completion.trim()
    ) {
      errors.push(`${scenario.id ?? "unknown"}: missing completion`);
    }
  }
  for (const skill of REQUIRED_SKILLS) {
    for (const kind of ["positive", "exclusion", "recovery"]) {
      if (
        !scenarios.some(
          (scenario) => scenario.skill === skill && scenario.kind === kind,
        )
      ) {
        errors.push(`scenarios: ${skill} missing ${kind} scenario`);
      }
    }
  }
  return scenarios.length;
}

async function main(argv = process.argv.slice(2)) {
  const skillsRoot = resolve(
    optionValue(argv, "--skills-root", resolve(process.cwd(), "skills")),
  );
  const cliPath = optionValue(argv, "--cli", undefined);
  const scenariosPath = optionValue(argv, "--scenarios", undefined);
  const errors = [];
  const documents = [];
  const skillSources = new Map();
  let scenarioCount = 0;

  const skillEntries = await readdir(skillsRoot, { withFileTypes: true });
  for (const entry of skillEntries) {
    if (entry.isDirectory() && !REQUIRED_SKILLS.includes(entry.name)) {
      errors.push(`unexpected skill: ${entry.name}`);
    }
  }

  for (const skill of REQUIRED_SKILLS) {
    const skillRoot = resolve(skillsRoot, skill);
    if (!(await pathExists(skillRoot))) {
      errors.push(`missing required skill: ${skill}`);
      continue;
    }
    const skillPath = resolve(skillRoot, "SKILL.md");
    if (!(await pathExists(skillPath))) {
      errors.push(`${skill}: missing SKILL.md`);
      continue;
    }
    let source;
    try {
      source = await readUtf8(skillPath);
    } catch {
      errors.push(`${skill}/SKILL.md: invalid UTF-8`);
      continue;
    }
    documents.push({ label: `${skill}/SKILL.md`, source });
    skillSources.set(skill, source);
    for (const duplicate of duplicateInstructionLines(source)) {
      errors.push(
        `${skill}/SKILL.md: duplicate instruction line: ${duplicate}`,
      );
    }
    const frontmatter = parseFrontmatter(source);
    if (!frontmatter) {
      errors.push(`${skill}: invalid YAML frontmatter`);
      continue;
    }
    if (frontmatter.name !== skill) {
      errors.push(`${skill}: frontmatter name must match the directory`);
    }
    const description = frontmatter.description;
    if (typeof description !== "string") {
      errors.push(`${skill}: frontmatter description must be a string`);
    } else if (
      !description.includes("用于") ||
      !description.includes("不负责")
    ) {
      errors.push(
        `${skill}: description must include positive triggers and exclusions`,
      );
    }
    if (
      Object.keys(frontmatter).some(
        (key) => !["name", "description"].includes(key),
      )
    ) {
      errors.push(`${skill}: frontmatter only allows name and description`);
    }
    for (const link of markdownLinks(source)) {
      const target = link.split("#", 1)[0];
      if (
        !target ||
        target.startsWith("https://") ||
        target.startsWith("http://") ||
        target.startsWith("mailto:")
      ) {
        continue;
      }
      const resolvedTarget = resolve(dirname(skillPath), target);
      if (linksToReferenceInAnotherSkill(skillsRoot, skill, resolvedTarget)) {
        errors.push(
          `${skill}/SKILL.md: cross-skill links must target SKILL.md: ${target}`,
        );
      } else if (!(await pathExists(resolvedTarget))) {
        errors.push(`${skill}/SKILL.md: broken local link ${target}`);
      }
    }
    for (const referencePath of await referenceFiles(
      skillRoot,
      skill,
      errors,
    )) {
      let referenceSource;
      try {
        referenceSource = await readUtf8(referencePath);
      } catch {
        errors.push(
          `${skill}/references/${basename(referencePath)}: invalid UTF-8`,
        );
        continue;
      }
      for (const duplicate of duplicateInstructionLines(referenceSource)) {
        errors.push(
          `${skill}/references/${basename(referencePath)}: duplicate instruction line: ${duplicate}`,
        );
      }
      for (const link of markdownLinks(referenceSource)) {
        const target = link.split("#", 1)[0];
        if (
          !target ||
          target.startsWith("https://") ||
          target.startsWith("http://") ||
          target.startsWith("mailto:")
        ) {
          continue;
        }
        const resolvedTarget = resolve(dirname(referencePath), target);
        if (linksToAnySkillReference(skillsRoot, resolvedTarget)) {
          errors.push(
            `${skill}/references/${basename(referencePath)}: reference must not link to another reference`,
          );
        } else if (!(await pathExists(resolvedTarget))) {
          errors.push(
            `${skill}/references/${basename(referencePath)}: broken local link ${target}`,
          );
        }
      }
      documents.push({
        label: `${skill}/references/${basename(referencePath)}`,
        source: referenceSource,
      });
    }
    if (skill === "sharge-core") {
      for (const [label, covered] of CORE_SAFETY_CONTRACTS) {
        if (!covered(source)) {
          errors.push(`${skill}: missing safety contract: ${label}`);
        }
      }
    } else {
      if (UNCONDITIONAL_HELP_SEQUENCE.test(source)) {
        errors.push(
          `${skill}: unconditional namespace-to-command help sequence is forbidden`,
        );
      }
      if (!markdownLinks(source).includes("../sharge-core/SKILL.md")) {
        errors.push(`${skill}: must link to sharge-core`);
      }
      for (const section of DOMAIN_SECTIONS) {
        if (!source.includes(`\n## ${section}\n`)) {
          errors.push(`${skill}: missing required section ## ${section}`);
        }
      }
    }
  }

  if (cliPath) {
    await validateCliCommands(resolve(cliPath), documents, errors);
    await validateHelpPaths(resolve(cliPath), skillSources, errors);
  }
  if (scenariosPath) {
    scenarioCount = await validateScenarios(resolve(scenariosPath), errors);
  }

  if (errors.length > 0) {
    process.stderr.write(`${JSON.stringify({ ok: false, errors })}\n`);
    return 1;
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, skills: REQUIRED_SKILLS.length, scenarios: scenarioCount })}\n`,
  );
  return 0;
}

process.exitCode = await main();
