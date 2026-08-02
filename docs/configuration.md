# 配置

## 配置目录

Sharge CLI 使用固定目录：

```text
~/.sharge/
├── settings.json
├── sharge.log
├── sharge.log.1
└── ...
```

不支持自定义 settings 路径。

POSIX 权限：

- `~/.sharge/`：`0700`；
- settings 和日志：`0600`。

Windows 使用等价的当前用户 ACL。

CLI 拒绝跟随 settings 和日志符号链接，并在安全时修复过宽权限。

## settings.json

```json
{
  "schemaVersion": 1,
  "installationId": "opaque-installation-id",
  "baseUrl": "https://ai.shargetech.com",
  "apiKey": "lms-REDACTED",
  "timezone": "Asia/Shanghai",
  "previousCredential": {
    "baseUrl": "https://api.example.test",
    "apiKey": "lms-REDACTED"
  }
}
```

字段：

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | settings schema 版本 |
| `installationId` | CLI 安装实例 ID |
| `baseUrl` | 当前 Open Platform URL |
| `apiKey` | 当前 URL 对应的 API Key |
| `timezone` | 默认 IANA 时区 |
| `previousCredential` | 上一个 URL 与 Key 的单槽缓存 |

API Key 明文保存在 settings。不要提交、同步或复制该文件到不可信位置。

所有修改使用同目录临时文件和原子 rename。

## 环境变量

| 环境变量 | 说明 |
| --- | --- |
| `SHARGE_API_KEY` | settings 没有 Key 时使用 |
| `SHARGE_BASE_URL` | settings 没有 base URL 时使用 |
| `SHARGE_TIMEZONE` | settings 没有 timezone 时使用 |

不存在：

- `SHARGE_SETTINGS_FILE`；
- `SHARGE_YES`；
- 环境变量形式的自动重试或全量分页开关。

## 优先级

API Key：

```text
settings.json apiKey > SHARGE_API_KEY
```

Base URL：

```text
settings.json baseUrl > SHARGE_BASE_URL > https://ai.shargetech.com
```

Timezone：

```text
--timezone > settings.json timezone > SHARGE_TIMEZONE > 操作系统时区
```

settings 中字段存在但无效时 fast fail，不静默回退到较低优先级。

## Base URL

默认使用 `https://ai.shargetech.com`。通过 settings 或 `SHARGE_BASE_URL` 覆盖的其他地址统一显示为 `custom`。

规则：

- 移除结尾 `/`；
- 只允许 HTTPS；
- 显式 localhost 开发地址可以使用 HTTP；
- 必须是纯 origin，不允许 username、password、path、query 或 fragment；
- 默认 URL 显示 `default`；
- 其他 URL 显示为 `custom`；
- 不支持运行时 `--base-url`。

查看：

```sh
sharge config show
sharge config show --json
```

设置：

```sh
sharge config set base-url https://api.example.test
```

移除 settings 值，恢复环境变量或默认值：

```sh
sharge config unset base-url
```

## 单槽凭证缓存

API Key 与 base URL 绑定。切换 URL 时：

1. 目标 URL 等于 `previousCredential.baseUrl`：交换当前与上一份凭证。
2. 目标 URL 不匹配：当前凭证移入 `previousCredential`。
3. 新 URL 没有缓存：活动 Key 被移除，下一步是 `sharge login`。
4. 只保留最近一份旧凭证。

示例：

```text
切换前：
  current  = default + key-default
  previous = custom + key-custom

切换到 custom 后：
  current  = custom + key-custom
  previous = default + key-default
```

缓存不参与普通优先级。缓存 Key 返回 401 时 fast fail，不尝试环境变量。

这不是 profile 系统：没有命名 profile、凭证列表或多环境永久 Key map。

## Timezone

设置：

```sh
sharge config set timezone Asia/Shanghai
```

移除：

```sh
sharge config unset timezone
```

只接受 IANA timezone，例如：

- `Asia/Shanghai`；
- `America/Los_Angeles`；
- `Europe/London`。

无效 timezone 在网络请求前失败。

每个业务请求发送带 offset 的 `X-Client-Date`；JSON `meta.timezone` 和 `meta.clientDate` 显示实际值。

## 手动配置 API Key

推荐使用 `sharge login`。确需手动配置时，可以编辑 settings：

```json
{
  "schemaVersion": 1,
  "baseUrl": "https://ai.shargetech.com",
  "apiKey": "lms-..."
}
```

或只使用环境变量：

```sh
export SHARGE_API_KEY="lms-..."
```

不要把 Key 作为命令参数。CLI 不提供 `config set api-key`。

CLI 可以剥离误加的 `Bearer ` 前缀，但不接受 JWT。

## Config 命令

```text
sharge config show
sharge config set <base-url|timezone> <value>
sharge config unset <base-url|timezone>
```

`config show --json` 返回：

- resolved value；
- source；
- environment name；
- settings path；
- Key 脱敏摘要；
- 是否存在上一份凭证及其 base URL；
- 日志路径。

不返回完整 Key。

## 日志

每次运行都会追加脱敏 JSON Lines：

```text
~/.sharge/sharge.log
```

查看路径：

```sh
sharge logs path
```

清理：

```sh
sharge logs clear --yes
```

轮转：

- 单文件最大 5 MiB；
- 保留当前文件和 4 个历史文件；
- 权限与 settings 相同；
- 日志失败不影响业务命令。

日志记录 run ID、命令路径、配置来源、HTTP method/path/status、request ID、耗时和错误类型。

日志不记录：

- API Key 或 Authorization；
- polling token；
- 原始 argv；
- `--input` 内容；
- 请求/响应正文；
- 闪记、日历、录音、日记内容；
- 签名下载和授权 URL。

终端 debug：

```sh
sharge doctor --debug
sharge doctor --json --debug
```

文本模式 debug 写中文 stderr；JSON 模式写 JSON Lines stderr。
