---
title: 下载
description: 下载路径、重名、覆盖、重定向、哈希校验与文件安全。
---

# 下载

Sharge CLI 支持：

- Quick Note 的 audio、image、video；
- Recording 音频。

下载内容不会写入 stdout。

## 默认路径

未指定 `--file` 时保存到当前工作目录：

```sh
sharge recordings download 456 --json
```

文件名优先使用服务端 `Content-Disposition`；没有时使用稳定 fallback：

```text
recording-456.m4a
note-123-image.jpg
```

服务端文件名会去除目录、控制字符和危险字符，不能改变保存目录。
如果 `Content-Disposition` 不能得到安全的 basename，CLI 使用 fallback。

## 重名

自动生成文件名已存在时，CLI 选择下一个可用名称：

```text
recording-456.m4a
recording-456-1.m4a
recording-456-2.m4a
```

CLI 在读取正文前原子占用文件名，不会下载完成后才因为重名失败。

显式路径不同：

```sh
sharge recordings download 456 --file ./meeting.m4a
```

目标存在时返回 `FILE_EXISTS`。允许覆盖：

```sh
sharge recordings download 456 \
  --file ./meeting.m4a \
  --overwrite \
  --json
```

`--overwrite` 已经表达精确覆盖意图，不再要求 `--yes`。

`--file -` 不受支持。显式目标或它的任一父目录如果是符号链接都会失败；CLI 在网络前和响应头后都会检查，不沿符号链接覆盖其他文件。

如果另一个进程抢占了 CLI 计划使用的自动文件名，CLI 不会覆盖或重新下载正文，而是直接用同一个临时文件选择下一个安全后缀。

如果显式 no-overwrite 目标在下载期间被抢占，CLI 保留该文件并以 `FILE_EXISTS` 失败。

## 原子写入

下载流程：

1. 获取响应头和安全文件名。
2. 原子创建独立 reservation marker，在目标目录创建临时文件。
3. 流式写入并计算 SHA-256。
4. 默认/非覆盖模式用原子 no-replace hard link 发布完整文件；只有显式 `--overwrite` 使用原子 rename。
5. 失败时清理临时文件。

不会留下看似完整的半文件。

## 结果

文本模式输出绝对路径：

```text
/workspace/recording-456.m4a
```

JSON：

```json
{
  "schemaVersion": "1",
  "ok": true,
  "command": "recordings.download",
  "data": {
    "filePath": "/workspace/recording-456.m4a",
    "bytes": 1048576,
    "mediaType": "audio/mp4",
    "sha256": "..."
  },
  "warnings": [],
  "meta": {
    "runId": "run_...",
    "requestId": "req_..."
  }
}
```

Agent 必须读取 `filePath`，不要猜测最终文件名。

## Redirect 安全

下载接口可能返回 `307` 到短期签名 URL。

CLI：

- 只对初始 Open Platform 请求发送 API Key；
- 后续 redirect 请求不发送 Authorization，跨 origin 尤其不会转发；
- 最多跟随 5 次 redirect；
- 只接受没有 username/password 的 HTTP(S) redirect URL；
- 不把签名 URL 写入持久化日志；
- 不把签名 URL作为业务结果输出；
- 验证 redirect scheme 和目标有效性。

除标准 HTTP redirect 外，下载管线也接受 Open Platform JSON redirect：

```json
{
  "code": 0,
  "data": {
    "url": "https://short-lived.example/download?signature=..."
  }
}
```

其他 JSON success shape 不会被当作文件写入磁盘。

## Dry run

```sh
sharge notes download 123 \
  --media image \
  --dry-run \
  --json
```

dry run：

- 不请求网络；
- 不创建文件；
- 显示 endpoint、绝对计划路径、命名来源、覆盖策略、required scope 和未验证条件；
- 不保证远端媒体存在。

## Timeout

下载默认总超时 `10m`：

```sh
sharge recordings download 456 --timeout 20m --json
```

必须带单位。超时不自动重试。

如果正文传输未完成，临时文件会清理；Agent 根据错误的 `retryable` 决定是否重新下载。

## 命令

Quick Note：

```sh
sharge notes download 123 --media audio
sharge notes download 123 --media image --file ./photo.jpg
sharge notes download 123 --media video --json
```

Recording：

```sh
sharge recordings download 456
sharge recordings download 456 --file ./meeting.m4a --json
```

不支持 `--file -`，因此二进制不会污染 stdout 或 JSON。
