---
title: 命令参考
description: sharge CLI 全部公开命令、全局选项与行为入口。
---

# 命令参考

直接执行 `sharge` 会打印根文本 help 并返回 `0`。执行 `sharge --help --json` 返回完整机器命令目录。未知命令返回 `INVALID_COMMAND` 和退出码 `2`。

## 全局 options

| Option | 说明 |
| --- | --- |
| `--help` | 文本 help，不登录、不联网 |
| `--json` | 输出稳定 JSON envelope |
| `--jq <expression>` | 过滤完整 success envelope，要求 `--json` |
| `--debug` | 将终端诊断写入 stderr |
| `--timeout <duration>` | 总超时，必须带 `s` 或 `m` |
| `--timezone <iana>` | 本次调用使用的 IANA timezone |

写命令还会按需提供：

| Option | 说明 |
| --- | --- |
| `--input <json|@file|->` | 使用 OpenAPI JSON 请求 |
| `--generate-input` | 离线输出可编辑 JSON 模板 |
| `--dry-run` | 零网络输出执行计划 |
| `--yes` | 确认破坏性操作 |

下载命令提供：

| Option | 说明 |
| --- | --- |
| `--file <path>` | 明确保存路径 |
| `--overwrite` | 覆盖明确路径 |
| `--dry-run` | 零网络检查下载计划 |

不存在：

- `--api-key`；
- `--base-url`；
- `--output`；
- `--retry`；
- `--all` / `--page-all`；
- `--params`；
- `--fields`；
- `--non-interactive`。

## 根命令

- [系统、鉴权、配置与日志](./system.md)
  - `login`
  - `logout`
  - `version`
  - `doctor`
  - `auth status|scopes`
  - `config show|set|unset`
  - `logs path|clear`

## 产品命令

- [Notes](./notes.md)
  - `list`
  - `search`
  - `get`
  - `update`
  - `delete`
  - `download`
- [Calendar](./calendar.md)
  - `month`
  - `list`
  - `search`
  - `get`
  - `create`
  - `update`
  - `delete`
  - `todos set-status`
- [Recordings](./recordings.md)
  - `list`
  - `search`
  - `get`
  - `download`
- [Diary](./diary.md)
  - `list`
  - `search`
  - `get`

## Scope 对照

| Namespace | Read | Write |
| --- | --- | --- |
| Notes | `quick_notes:read` | `quick_notes:write` |
| Calendar | `calendar:read` | `calendar:write` |
| Recordings | `voicemaster:read` | 不支持 |
| Diary | `ai_daily:read` | 不支持 |

## 网络与重复执行

- 普通读命令发送一次业务请求。
- 列表命令一次只读取一页。
- 写命令发送一次业务请求。
- CLI 不自动重试。
- download 可能包含 Open Platform 请求和服务端 redirect。
- login 包含创建会话、状态检查和协议轮询。
- help、version、config、logs path、输入模板和 dry run 可以完全离线执行。

每个具体命令的 JSON help 是最终机器契约：

```sh
sharge <namespace> <command> --help --json
```
