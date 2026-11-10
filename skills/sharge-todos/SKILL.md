---
name: sharge-todos
description: 通过 sharge CLI 读取、查看、创建、局部修改、批量完成或恢复、批量删除待办。用于用户要记一件要做的事、看还有哪些没做完、改待办标题或时间、标记完成或删除待办，或提到 Todo ID 时；要占时段、重复或到点提醒的安排交给 sharge-calendar；不负责解析自然语言时间或确认录音草稿待办。
---

# Sharge Todos

开始任何 CLI 动作前完整读取 [sharge-core](../sharge-core/SKILL.md)，并继承其中的发现、安全和恢复规则。

## 范围

待办是一件要做完的事：只有标题，时间可有可无（只有开始时间，没有结束时间），有完成和未完成两种状态；不重复、不提醒。处理单页 list、get、create、局部 update、批量 complete 和批量 delete。要占时段、重复或到点提醒的安排是日程，交给 [sharge-calendar](../sharge-calendar/SKILL.md)。

## 最短路径

意图明确时直接执行稳定读取，不先读取 namespace 或具体命令 help：

```sh
sharge todos list --json
sharge todos list --status all --json
sharge todos get 123 --json
```

## 执行

创建、修改、完成或删除前，只读取对应的具体命令 help，确认 input schema、`dryRun`、`destructive`、`retrySafe` 和 required scopes：

```sh
sharge todos create --help --json
sharge todos update --help --json
sharge todos complete --help --json
sharge todos delete --help --json
```

需要时先执行零网络 dry run；不要混用业务 flags 与 `--input`。随后按 core 的统一序列执行并解析 envelope。

## 领域规则

- list 默认只读未完成的一页；`--status all` 才包含已完成。没有按标题或日期筛选；续页只用当前响应的精确 cursor。
- Todo ID 和 cursor 保持原始十进制字符串，不转成 Number；在 `--input` 里也写成字符串。
- 用户没说时间就不传开始时间，不要自己补；说了时间要换成带 offset 的 RFC 3339，不猜“今天”或 timezone。
- update 是局部修改，只传要改的字段；清除时间用 `--clear-start-time`。
- complete 和 delete 返回 `changed_count`，是实际变化的条数：已是该状态、不存在或不属于当前用户的会被跳过，0 也算成功。不要说成每个 ID 都改了；要逐条确认就用 get。
- 真实 delete 先确认目标，再加 `--yes`。
- 写请求出现 unknown outcome 时不自动重发：create 用 list 找最新的同标题条目核对，无法唯一确认就如实说明；update/complete/delete 用 get 查看对应 ID。

## Handoff

- 鉴权、scope、配置、envelope 和通用恢复交给 [sharge-core](../sharge-core/SKILL.md)，恢复后回到本 Skill。
- 要占时段、重复或到点提醒的安排交给 [sharge-calendar](../sharge-calendar/SKILL.md)。
- 任务要求从闪记、录音或日记提取内容时，先交给 [sharge-notes](../sharge-notes/SKILL.md)、[sharge-recordings](../sharge-recordings/SKILL.md) 或 [sharge-diary](../sharge-diary/SKILL.md) 获取最小必要结果；回到本 Skill 后重新确认要记的待办。
