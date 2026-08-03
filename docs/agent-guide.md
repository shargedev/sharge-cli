---
title: Agent 使用指南
description: Agent 发现命令、构造输入、安全执行并从错误中恢复的推荐流程。
---

# Agent 使用指南

本文定义 Agent 调用 `sharge` 的推荐流程。目标是让一个没有仓库上下文的 Agent 从已安装 Skill 或 CLI 自身发现入口，并以最短安全路径完成计划、执行和恢复。

## 1. 最短安全调用循环

### 1.1 先判断是否需要 help

CLI help 是当前安装版本的最终机器契约，但不是每个任务的固定前置步骤。按当前任务选择：

| 当前任务 | 推荐路径 |
| --- | --- |
| 已知稳定读命令，且输入明确 | 直接执行并显式使用 `--json` |
| 写入、删除、下载、结构化输入或 dry-run | 读取一次具体命令的 `--help --json` |
| 不知道命令属于哪个领域 | 读取根 `sharge --help --json` |
| 已安装 Skill 已明确排除某项能力 | 直接说明不支持和未执行；不要只为复述边界而查 help |
| 已知领域但不知道动作，或 Skill 未明确能力是否存在 | 读取 namespace help |
| 参数报错或 Skill 疑似过期 | 按 error envelope 查看对应具体命令 help |

不要机械执行 root → namespace → command 三级 help。每次 help 都应回答一个尚未解决的问题。

例如，明确搜索闪记时可以直接执行：

```sh
sharge notes search "发布计划" --json
```

准备修改闪记时则先读取具体契约：

```sh
sharge notes update --help --json
```

读取其中与本次任务有关的 arguments、options、required scopes、input schema、side effects、
destructive、dry-run 和 retry safety；无需为了同一动作先读取 `sharge notes --help --json`。

### 1.2 生成输入

复杂写命令优先生成模板：

```sh
sharge calendar create --generate-input > request.json
```

不要把业务 flags 与 `--input` 混用。

### 1.3 本地预演

```sh
sharge calendar create \
  --input @request.json \
  --dry-run \
  --json
```

dry run 不登录、不联网、不写文件、不修改远端。

### 1.4 执行

```sh
sharge calendar create --input @request.json --json
```

只依据退出码、`ok`、`error.type` 和结构化字段判断结果。不要解析中文 `message`。

### 1.5 恢复

错误存在 `nextActions` 时，优先使用其中的完整命令。执行前仍需判断该动作是否符合原任务。

## 2. 不要猜

Agent 不应猜测：

- 命令别名；
- 参数名称；
- 默认月份或“今天”；
- cursor；
- API Key 来源；
- scope；
- 写请求超时后是否执行成功；
- 删除是否需要确认；
- 下载最终文件名。

对应的可靠来源：

| 信息 | 来源 |
| --- | --- |
| 已知稳定读入口 | 对应领域 Skill 中经过校验的命令示例 |
| 完整命令与参数契约 | 对应层级的 `--help --json` |
| 写入 schema | `--help --json` 或 `--generate-input` |
| 当前凭证 | `auth status --json` |
| scope 目录 | `auth scopes --json` |
| 当前配置 | `config show --json` |
| 下一页 | 当前响应的分页字段 |
| 下载路径 | 下载成功结果的 `data.filePath` |
| 故障细节 | error envelope、request ID、本地日志 |

## 3. 输出选择

所有命令默认文本。Agent 应显式使用：

```sh
sharge notes list --json
```

只需要部分结果时可以使用内置 jq：

```sh
sharge notes list --json --jq '.data.items[] | {id, title}'
```

`--jq` 会改变成功 stdout 的形状；错误仍返回完整 error envelope。

## 4. 输入选择

### 简单写入

少量标量字段可以使用 flags：

```sh
sharge notes update 123 \
  --title "新的标题" \
  --content "新的正文" \
  --json
```

### 复杂写入

嵌套、nullable 或需要复用的请求使用 `--input`：

```sh
sharge calendar create --input @event.json --json
```

### stdin

只有 `--input -` 读取 stdin：

```sh
printf '%s\n' '{"title":"更新","content":null}' |
  sharge notes update 123 --input - --json
```

直接运行没有 `--input -` 的命令不会等待 stdin。

## 5. 写操作安全

### Dry run

所有写命令都应先考虑 dry run，尤其是：

- Calendar create/update；
- Calendar 重复实例修改；
- Calendar todo 批量状态；
- Notes update；
- 任何 delete。

dry run 只保证本地输入合法和请求计划可构造。远端资源、权限和冲突状态会标记为 `unverified`。

### 删除

真实删除需要：

```sh
sharge notes delete 123 --yes --json
```

缺少 `--yes` 时 CLI 在本地失败，不发送请求。

### Unknown outcome

写请求发送后发生超时或网络中断时：

```json
{
  "error": {
    "type": "TIMEOUT",
    "retryable": false,
    "outcome": "unknown"
  }
}
```

此时不能直接重发。应先执行相应读取命令确认远端状态，再决定下一步。后端没有通用幂等键协议。

## 6. 不自动重试

每个业务命令只发送一次业务请求。CLI 不会自动重试：

- 网络错误；
- timeout；
- `429`；
- `5xx`。

Agent 可以在以下条件全部满足时重新调用：

1. `retryable` 为 `true`；
2. help 声明重复执行安全；
3. 当前错误没有 `outcome: "unknown"`，或已经通过读取确认状态；
4. 重试仍符合用户意图。

登录 poll 和下载 redirect 是协议步骤，不算业务自动重试。

## 7. 分页

一次列表命令只读取一页：

```sh
sharge recordings list --page-size 20 --json
```

读取 `data.next_cursor`、`data.prev_cursor` 和 `data.has_more`，再显式调用下一页：

```sh
sharge recordings list \
  --cursor 456 \
  --direction forward \
  --page-size 20 \
  --json
```

不同产品保留各自查询模型；不存在通用 `--all`。

## 8. Scope 不足

业务命令不会打开浏览器。错误会返回完整重新授权命令：

```json
{
  "error": {
    "type": "SCOPE_REQUIRED",
    "requiredScopes": ["calendar:write"],
    "nextActions": [
      {
        "description": "重新授权完整 scope 集合",
        "command": "sharge login --scope quick_notes:read --scope calendar:read --scope calendar:write"
      }
    ]
  }
}
```

`login --scope` 表示完整目标集合。不要只保留新 scope 而意外丢掉已有 scope。

## 9. 时间

- datetime 必须是带 offset 的 RFC 3339。
- 月份必须显式提供为 `YYYY-MM`。
- 日记 identifier 必须显式提供为 `YYYYMMDD`。
- v1 不解析自然语言时间。
- 不把 cursor、identifier 或本地日期转换为 UTC。

```sh
sharge calendar list \
  --start 2026-07-30T09:00:00+08:00 \
  --end 2026-07-30T18:00:00+08:00 \
  --timezone Asia/Shanghai \
  --json
```

## 10. 下载

未指定 `--file` 时，必须从结果读取真实绝对路径：

```sh
sharge recordings download 456 --json
```

```json
{
  "data": {
    "filePath": "/workspace/recording-456.m4a",
    "bytes": 1048576,
    "mediaType": "audio/mp4",
    "sha256": "..."
  }
}
```

不要根据资源 ID 猜测最终文件名；服务端文件名和重名后缀都可能影响路径。

## 11. 日志与诊断

每次运行都能通过 `runId` 关联：

```sh
sharge logs path
```

显式 debug：

```sh
sharge notes list --json --debug
```

stdout 仍是最终 envelope；stderr 是 JSON Lines debug。日志不会包含 API Key、原始业务输入或响应正文。

## 12. Agent 自检清单

执行前：

- [ ] 仅在存在真实不确定性、风险操作或能力发现时读取了对应层级的 JSON help。
- [ ] 没有为已知稳定读入口机械执行 root → namespace → command help。
- [ ] 已明确任务需要的时间、月份和分页边界；不为稳定读操作额外调用 help 预查 scope，遇到 `SCOPE_REQUIRED` 时按 envelope 恢复。
- [ ] 写命令已选择 flags 或 `--input`，没有混用。
- [ ] 复杂写入已生成模板并 dry run。
- [ ] 删除包含 `--yes`。

执行后：

- [ ] 检查了进程退出码和 `ok`。
- [ ] 没有解析中文 message 做逻辑判断。
- [ ] 需要续页时只使用响应 cursor。
- [ ] 下载使用返回的 `filePath`。
- [ ] unknown outcome 已通过读取确认，没有盲目重发。
