---
title: 快速开始
description: 安装 sharge CLI 与 Agent Skills，完成登录并读取第一条数据。
---

# 快速开始

## 1. 安装

需要 Node.js 20 或更高版本与 npm。

从 npm 安装 CLI：

```sh
npm install --global @sharge/cli@latest
```

如果你会让 AI Agent 使用 sharge，再全局安装仓库提供的五个 Skills：

```sh
npx skills add shargedev/sharge-cli -y -g
```

然后登录：

```sh
sharge login
```

确认命令可用：

```sh
sharge version
sharge --help
```

Agent 协助安装时，应先执行 CLI 和 Skills 安装，再运行 `sharge login --no-browser`，把完整授权 URL 交给人类完成浏览器授权。Agent 不应代替人类确认浏览器页面。

## 2. 登录

```sh
sharge login
```

CLI 会尝试打开浏览器，同时输出完整授权 URL 和视觉核对码：

```text
请在浏览器中完成登录：
https://…

核对码：D9TF-20X4
此授权将在 600 秒后过期。请保持命令运行。
登录完成。
```

命令会静默等待授权完成，不会重复输出等待状态。

如果当前环境不能自动打开浏览器：

```sh
sharge login --no-browser
```

复制 CLI 输出的完整 URL 到任意浏览器即可。核对码只用于确认浏览器页面与当前 CLI 会话一致，不需要输入回终端。

验证登录：

```sh
sharge auth status
sharge auth status --json
```

## 3. 第一次读取数据

读取一页闪记：

```sh
sharge notes list --limit 20 --json
```

读取指定日历范围：

```sh
sharge calendar list \
  --start 2026-07-30T00:00:00+08:00 \
  --end 2026-07-31T00:00:00+08:00 \
  --json
```

搜索录音：

```sh
sharge recordings search "项目复盘" --limit 10 --json
```

读取某个月的日记：

```sh
sharge diary list 2026-07 --json
```

## 4. 让 Agent 自己发现命令

不要让 Agent 猜参数。先读取根机器帮助，再逐层缩小：

```sh
sharge --help --json
sharge calendar --help --json
sharge calendar create --help --json
```

写命令可以离线生成输入模板：

```sh
sharge calendar create --generate-input > calendar-create.json
```

修改模板后先 dry run：

```sh
sharge calendar create \
  --input @calendar-create.json \
  --dry-run \
  --json
```

确认执行计划后再执行：

```sh
sharge calendar create \
  --input @calendar-create.json \
  --json
```

## 5. 获取下一页

列表命令不会自动读取全部数据。响应示例：

```json
{
  "schemaVersion": "1",
  "ok": true,
  "command": "notes.list",
  "data": {
    "items": [],
    "has_more": true,
    "next_cursor": 123
  },
  "warnings": [],
  "meta": {
    "runId": "run_...",
    "requestId": "req_..."
  }
}
```

显式续页：

```sh
sharge notes list --cursor 123 --limit 20 --json
```

cursor 是不透明 token。不要计算、修改或猜测下一个 cursor。

## 6. 切换环境

默认环境是中国生产环境：

```text
https://ai.shargetech.com
```

查看实际配置：

```sh
sharge config show
```

覆盖服务地址：

```sh
sharge config set base-url https://api.example.test
sharge login
```

示例使用 RFC 保留测试域名；实际使用时替换为你被授权访问的 HTTPS origin。

API Key 与 base URL 绑定。切换 URL 时 CLI 可能恢复上一份缓存凭证；没有可用缓存时需要重新登录。

## 7. 出错时

文本模式会在 stderr 给出精确下一步。Agent 应使用 JSON：

```sh
sharge notes list --json
```

重点读取：

- `error.type`；
- `error.retryable`；
- `error.outcome`；
- `error.requiredScopes`；
- `error.nextActions`；
- `meta.requestId`；
- 进程退出码。

CLI 不自动重试。只有 Agent 在检查 `retryable` 和操作安全性后才能决定是否重新调用。

## 下一步

- [Agent 使用指南](./agent-guide.md)
- [鉴权](./authentication.md)
- [命令参考](./commands/README.md)
