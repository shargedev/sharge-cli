# sharge CLI

[![npm version](https://img.shields.io/npm/v/@sharge/cli.svg)](https://www.npmjs.com/package/@sharge/cli)
[![CI](https://github.com/shargedev/sharge-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/shargedev/sharge-cli/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Sharge Open Platform 的官方命令行客户端，面向 AI Agent 设计，也为人类提供清晰的登录、配置与故障处理体验。

它目前覆盖 Quick Note、Calendar、Recordings 和 Diary，提供机器可读 help、稳定 JSON 契约、显式 dry run、安全下载与可恢复错误。

[官网](https://shargedev.github.io/sharge-cli/) · [在线文档](https://shargedev.github.io/sharge-cli/docs/) · [快速开始](#安装与快速开始) · [Agent 使用](#agent-快速开始) · [核心能力](#核心能力) · [命令](#命令概览) · [安全](#安全与风险) · [仓库文档](./docs/README.md)

## 为什么使用 sharge

- **Agent-first**：每一级命令都提供 `--help --json`，包含参数、schema、scope、副作用、错误与示例。
- **行为可预测**：默认中文文本；只有显式 `--json` 才输出稳定的 `schemaVersion: "1"` envelope。
- **安全可控**：业务命令不会隐式登录、自动重试或自动翻页；破坏性操作要求 `--yes`。
- **写入可预演**：写命令支持零网络 `--dry-run`，复杂输入可先离线生成 JSON 模板。
- **下载安全**：媒体只写入本地文件，支持安全命名、冲突处理、原子替换与 SHA-256。
- **便于恢复**：错误包含稳定类型、退出码、retry/outcome 语义与可直接执行的下一步。

## 核心能力

| 领域           | 能力                                                       |
| -------------- | ---------------------------------------------------------- |
| Notes          | 列表、搜索、详情、更新、删除和媒体下载                     |
| Calendar       | 月视图、范围读取、搜索、详情、创建、更新、删除和 Todo 状态 |
| Recordings     | 列表、搜索、富详情和音频下载                               |
| Diary          | 按月读取、搜索和日记详情                                   |
| Auth & Runtime | 浏览器登录、scope、诊断、配置和脱敏日志                    |

## 安装与快速开始

### 环境要求

- Node.js 20 或更高版本；
- npm。

### 人类快速开始

```sh
npm install --global @sharge/cli@latest
sharge login
```

登录会尝试打开浏览器。无图形界面或无法自动打开浏览器时：

```sh
sharge login --no-browser
```

完成授权后验证安装与身份：

```sh
sharge version
sharge auth status
sharge --help
```

如果你会让 AI Agent 使用 sharge，再安装仓库提供的 Skills：

```sh
npx skills add shargedev/sharge-cli -y -g
```

### 从源码构建

```sh
git clone git@github.com:shargedev/sharge-cli.git
cd sharge-cli
npm ci
npm run build
npm link
```

## Agent 快速开始

部分步骤需要人类在浏览器中完成授权。Agent 应按下面的顺序安装 CLI 与 Skills：

```sh
# 1. 安装 CLI
npm install --global @sharge/cli@latest

# 2. 为当前用户的 Agent 安装全部 sharge Skills
npx skills add shargedev/sharge-cli -y -g

# 3. 发起登录；把输出的完整 URL 交给人类，这个将在前台轮询等待用户授权
sharge login --no-browser

# 4. 人类完成授权后验证身份
sharge auth status --json
```

之后显式请求 JSON，并根据任务风险决定是否读取具体命令 help：

```sh
# 1. 读取一页 Quick Note
sharge notes list --limit 20 --json

# 2. 在首次执行写操作前读取机器契约
sharge calendar create --help --json

# 3. 生成输入并预演
sharge calendar create --generate-input > calendar-create.json
sharge calendar create --input @calendar-create.json --dry-run --json

# 4. 人类确认计划后执行
sharge calendar create --input @calendar-create.json --json
```

不知道能力位于哪个 namespace 时，从机器目录开始：

```sh
sharge --help --json
sharge calendar --help --json
sharge calendar create --help --json
```

不要猜测参数，也不要盲目重试写请求。网络或超时错误可能返回 `outcome: "unknown"`，此时应先读取资源确认最终状态。

## 命令概览

```text
sharge
├── login
├── logout
├── version
├── doctor
├── auth status|scopes
├── config show|set|unset
├── logs path|clear
├── notes list|search|get|update|delete|download
├── calendar month|list|search|get|create|update|delete
├── calendar todos set-status
├── recordings list|search|get|download
└── diary list|search|get
```

常用示例：

```sh
sharge notes search "发布计划" --json

sharge calendar list \
  --start 2026-08-03T00:00:00+08:00 \
  --end 2026-08-04T00:00:00+08:00 \
  --json

sharge recordings search "项目复盘" --limit 10 --json
sharge diary list 2026-08 --json
```

完整参数以 CLI 自身的 JSON help 为最终机器契约：

```sh
sharge <namespace> <command> --help --json
```

## 输出、分页与写入契约

- 默认输出是中文文本，TTY 与 pipe 行为一致。
- `--json` 成功和失败都输出到 stdout；普通文本错误输出到 stderr。
- `--jq` 只过滤成功 envelope，且必须与 `--json` 一起使用。
- 列表和搜索命令一次只读取一页；使用响应中的 opaque cursor 显式续页。
- 写命令每次只发送一次请求，不自动重试。
- 只有 `--input -` 会读取 stdin；其他调用不会隐式等待输入。
- 下载永远不会把二进制写到 stdout。

详见 [JSON 契约](./docs/json-contract.md)、[错误与退出码](./docs/errors.md)和[下载契约](./docs/downloads.md)。

## 鉴权与配置

默认 Open Platform 地址是 `https://ai.shargetech.com`。CLI 从 `~/.sharge/settings.json` 或环境变量读取配置，其中 settings 优先。

```sh
sharge login --scope quick_notes:read --scope calendar:read
sharge auth status --json
sharge auth scopes --json
sharge config show
sharge doctor --json
```

API Key 只接受 `lms-...`，不会通过命令行参数传入或完整输出。需要切换环境时使用 `sharge config set base-url ...`，随后重新验证登录状态。

详见[鉴权](./docs/authentication.md)与[配置](./docs/configuration.md)。

## Agent Skills

仓库在 [`skills/`](./skills) 提供五个与当前 CLI 对齐的 Agent Skill：

- `sharge-core`
- `sharge-notes`
- `sharge-calendar`
- `sharge-recordings`
- `sharge-diary`

它们以 CLI 的 `--help --json` 为命令事实源，并通过以下门禁检查结构、链接、安全覆盖与命令一致性：

```sh
npm run skills:validate
```

Skills 通过源码仓库分发，不进入 CLI 的 npm tarball：

```sh
# 全局安装全部 Skills
npx skills add shargedev/sharge-cli -y -g

# 只查看仓库可用的 Skills
npx skills add shargedev/sharge-cli --list
```

## 安全与风险

通过浏览器授权后，CLI 会在已授予 scope 内以当前用户身份访问数据。将它交给 Agent 使用前，请遵循最小权限原则，并审阅涉及写入、删除和文件覆盖的计划。

- 优先用重复的 `--scope` 只申请任务需要的权限。
- 写操作先执行 `--dry-run`；删除等破坏性操作必须显式添加 `--yes`。
- 写请求发生 timeout/network error 后不要直接重试，先根据 `outcome` 与读取命令确认状态。
- 不要把 API Key 放入命令行、prompt、日志、Issue 或聊天记录。
- 本地 settings 与 JSONL 日志位于 `~/.sharge/`；日志自动脱敏并轮转。
- 下载重定向不会向跨 origin 目标转发 Authorization。
- CLI 不收集产品使用遥测；诊断信息仅写入用户本地的脱敏日志。

## 文档

| 文档                                    | 内容                                     |
| --------------------------------------- | ---------------------------------------- |
| [快速开始](./docs/getting-started.md)   | 安装、登录和第一次读取                   |
| [Agent 使用指南](./docs/agent-guide.md) | 最短安全调用、输入、恢复与分页           |
| [命令参考](./docs/commands/README.md)   | 全部命令、参数、scope 与示例             |
| [JSON 契约](./docs/json-contract.md)    | envelope、JSON help、输入 schema 与 jq   |
| [错误与退出码](./docs/errors.md)        | 稳定错误、unknown outcome 与 nextActions |
| [下载](./docs/downloads.md)             | 路径、重名、覆盖、重定向与校验           |

## 开发与贡献

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run contract:test
npm run skills:validate
npm run build
npm pack --dry-run --json
```

提交问题或建议前，请先搜索现有 [Issues](https://github.com/shargedev/sharge-cli/issues)。代码贡献可通过 [Pull Request](https://github.com/shargedev/sharge-cli/pulls) 提交；涉及公共命令、输入输出或安全语义的改动，应先更新 `docs/` 并补充测试。

参见 [贡献指南](./CONTRIBUTING.md)、[安全策略](./SECURITY.md)、[变更记录](./CHANGELOG.md)和 [MIT License](./LICENSE)。
