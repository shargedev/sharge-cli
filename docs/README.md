# Sharge CLI 文档

`sharge` 是 Sharge Open Platform 的官方命令行客户端。它以 Agent 为主要用户，同时为登录、配置和故障处理提供清晰的人类体验。

CLI 覆盖四类产品数据：

| Namespace | 产品名称 |
| --- | --- |
| `notes` | Quick Note、闪记、Live Photo |
| `calendar` | Calendar、日程、闪极日程、Loomos Calendar |
| `recordings` | 录音、Voice Recording、闪极录音、Loomos Recording |
| `diary` | 日记、AI 日记、闪极日记、Loomos Diary |

这些产品名称只用于文档说明。可执行命令始终使用表格中的规范 namespace。

## 从这里开始

- [快速开始](./getting-started.md)：安装、登录和第一次读取数据。
- [Agent 使用指南](./agent-guide.md)：发现命令、构造输入、处理错误和安全执行。
- [鉴权](./authentication.md)：浏览器登录、API Key、scope 和 logout。
- [配置](./configuration.md)：settings、环境变量、base URL、时区和日志。
- [JSON 契约](./json-contract.md)：envelope、JSON help、`--input`、模板和 `--jq`。
- [错误与退出码](./errors.md)：稳定错误类型、恢复动作和 unknown outcome。
- [下载](./downloads.md)：文件路径、重名、覆盖、重定向和校验。
- [命令参考](./commands/README.md)：全部命令、参数、scope、schema 和示例。

## 最短使用路径

```sh
# 1. 发现全部命令
sharge --help

# 2. 登录
sharge login

# 3. 验证身份
sharge auth status --json

# 4. 读取一页闪记
sharge notes list --limit 20 --json
```

Agent 应优先使用机器帮助：

```sh
sharge --help --json
sharge notes --help --json
sharge notes list --help --json
```

## 核心保证

- 所有命令默认输出中文文本；结构化输出必须显式使用 `--json`。
- CLI 在离线状态下也能输出文本 help、JSON help、输入 schema 和输入模板。
- 业务命令不会隐式登录。
- CLI 不自动重试业务请求。
- 列表命令一次只读取一页。
- 只有 `--input -` 会读取 stdin。
- 写命令支持零网络 `--dry-run`。
- 删除命令要求 `--yes`，不会弹出交互确认。
- JSON 成功和失败使用稳定 envelope。
- stdout 不会混入日志、进度或二进制。
- API Key 不接受命令行参数，不会出现在 shell history 或进程参数中。
- 本地运行日志始终脱敏并自动轮转。

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

Open API 不允许创建 Quick Note，因此不存在 `sharge notes create`。当前产品只开放日记，因此 `diary` 不暴露周报和月报。

## stdout 与 stderr

| 模式 | stdout | stderr |
| --- | --- | --- |
| 默认文本成功 | 中文业务结果 | 空 |
| 默认文本失败 | 空 | 中文错误与下一步命令 |
| `--json` 成功 | 一个 success envelope | 空，除非使用 `--debug` |
| `--json` 失败 | 一个 error envelope | 空，除非使用 `--debug` |
| `login --json` | 最终一个 envelope | JSON Lines 状态事件 |
| 下载 | 文本路径或 JSON envelope | debug 诊断 |

## 文档中的值

示例中的下列值都是占位符，使用时需要替换：

- `123`、`456`：资源 ID；
- `D9TF-20X4`：授权页面视觉核对码；
- `lms-REDACTED`：脱敏 API Key；
- 时间和月份：应替换成任务需要的明确值。

JSON 业务字段保持 Open API 原始命名，通常是 `snake_case`；CLI 自有 envelope 字段使用 `camelCase`。
