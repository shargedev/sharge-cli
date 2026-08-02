# 系统、鉴权、配置与日志命令

## `sharge version`

输出 CLI 版本。无需登录，不访问网络。

```sh
sharge version
sharge version --json
```

JSON `data`：

```json
{
  "version": "0.2.0"
}
```

重复执行安全。

## `sharge login`

启动或验证浏览器登录。

```text
sharge login [--scope <scope>...] [--force] [--no-browser]
             [--timeout <duration>] [--json] [--debug]
```

Options：

| Option | 说明 |
| --- | --- |
| `--scope <scope>` | 可重复；一旦提供即表示完整目标 scope 集合 |
| `--force` | 即使当前凭证有效也重新授权并轮换 Key |
| `--no-browser` | 不自动打开浏览器，只输出完整 URL |
| `--timeout <duration>` | 缩短本地等待，不延长服务端过期时间 |
| `--json` | stdout 最终 envelope，stderr JSONL 状态事件 |

默认 scopes：

```text
quick_notes:read
quick_notes:write
calendar:read
calendar:write
voicemaster:read
ai_daily:read
```

有效凭证已经覆盖目标集合时：

```json
{
  "changed": false,
  "credentialSource": "settings",
  "scopes": [
    "quick_notes:read",
    "quick_notes:write",
    "calendar:read",
    "calendar:write",
    "voicemaster:read",
    "ai_daily:read"
  ]
}
```

完成授权时：

```json
{
  "changed": true,
  "credentialSource": "settings",
  "keyId": 123,
  "scopes": ["quick_notes:read", "calendar:read"],
  "expiresAt": null
}
```

副作用：

- 可能打开浏览器；
- 创建后端授权会话；
- 可能轮换远端逻辑 API Key；
- 原子更新 settings。

不支持 `--input` 和 `--dry-run`。

详见[鉴权](../authentication.md)。

## `sharge logout`

删除本地文件凭证：

```sh
sharge logout
sharge logout --json
```

删除：

- settings 中活动 `apiKey`；
- `previousCredential`。

保留：

- `installationId`；
- `baseUrl`；
- `timezone`；
- 服务端 API Key。

JSON `data`：

```json
{
  "changed": true,
  "settingsCredentialRemoved": true,
  "previousCredentialRemoved": true,
  "environmentCredentialActive": false
}
```

如果 `SHARGE_API_KEY` 存在，`environmentCredentialActive` 为 `true`，success
envelope 的 `warnings` 包含：

```json
{
  "type": "ENVIRONMENT_CREDENTIAL_ACTIVE",
  "message": "SHARGE_API_KEY 环境变量仍然有效；logout 只删除文件凭证。",
  "nextActions": [
    {
      "description": "清除当前 shell 中的环境变量凭证",
      "command": "unset SHARGE_API_KEY"
    }
  ]
}
```

命令不要求 `--yes`。

## `sharge auth status`

验证最终选中的凭证并显示身份：

```sh
sharge auth status
sharge auth status --json
```

Scope：有效凭证即可。

网络：一次 `GET /open-api/v1/auth/status`。

JSON `data` 是 CLI 本地上下文与 OpenAPI 结果的组合：

```json
{
  "credential": {
    "source": "settings",
    "settingsPath": "/Users/user/.sharge/settings.json",
    "keyPrefix": "lms-abcd",
    "baseUrl": "https://ai.shargetech.com",
    "environment": "default"
  },
  "auth": {
    "user_id": "user_...",
    "auth_type": "api_key",
    "scopes": ["quick_notes:read"],
    "scope_mode": "api_key_snapshot",
    "api_key": {
      "id": 123,
      "name": "Sharge CLI",
      "key_prefix": "lms-abcd",
      "creation_source": "cli_authorization",
      "client_id": "sharge-cli",
      "installation_id": "install_...",
      "client_info": {},
      "expires_at": null,
      "last_used_at": "2026-07-31T01:00:00Z"
    },
    "server_time": "2026-07-31T01:00:00Z"
  }
}
```

不返回完整 API Key。

## `sharge auth scopes`

读取完整 scope 目录和当前授权状态：

```sh
sharge auth scopes
sharge auth scopes --json
```

网络：一次 `GET /open-api/v1/auth/scopes`。

业务 `data` 保持 OpenAPI 数组：

```json
[
  {
    "scope": "quick_notes:read",
    "business_namespace": "user_memory",
    "access": "read",
    "name": "读取 Quick Note",
    "description": "读取、搜索 Quick Note 及下载其媒体文件",
    "granted": true
  }
]
```

## `sharge doctor`

诊断本地配置与 Open Platform 连通性：

```sh
sharge doctor
sharge doctor --json
sharge doctor --json --debug
```

检查顺序：

1. CLI version 和 Node runtime；
2. `~/.sharge/` 类型与权限；
3. settings JSON、schema、符号链接和权限；
4. base URL 与 environment；
5. timezone；
6. API Key 来源和脱敏格式；
7. 日志目录可写性；
8. Open Platform 网络；
9. auth status；
10. scope 目录。

`doctor` 不修改业务数据，不轮换凭证，不自动登录。安全的权限修复可以发生；其他问题只报告。

JSON `data`：

```json
{
  "healthy": false,
  "checks": [
    {
      "name": "settings.permissions",
      "status": "pass",
      "message": "settings 权限为 0600"
    },
    {
      "name": "auth",
      "status": "fail",
      "message": "尚未登录",
      "nextActions": [
        {"command": "sharge login"}
      ]
    }
  ]
}
```

如果必需检查失败，命令返回对应非零退出码。

## `sharge config show`

显示 resolved 配置和来源：

```sh
sharge config show
sharge config show --json
```

无需网络。

JSON `data`：

```json
{
  "settingsPath": "/Users/user/.sharge/settings.json",
  "installationId": "install_...",
  "baseUrl": {
    "value": "https://ai.shargetech.com",
    "source": "settings",
    "environment": "default"
  },
  "credential": {
    "source": "settings",
    "keyPrefix": "lms-abcd"
  },
  "timezone": {
    "value": "Asia/Shanghai",
    "source": "settings"
  },
  "previousCredential": {
    "present": true,
    "baseUrl": "https://api.example.test"
  },
  "logPath": "/Users/user/.sharge/sharge.log"
}
```

完整 Key 不会输出。

## `sharge config set`

```text
sharge config set <base-url|timezone> <value>
```

示例：

```sh
sharge config set base-url https://api.example.test
sharge config set timezone Asia/Shanghai
```

无需网络。修改 settings 时使用原子写入。

设置不同 base URL 可能交换或缓存当前凭证。没有对应缓存时，活动 Key 会被移除并提示登录。

不支持：

```text
sharge config set api-key ...
```

## `sharge config unset`

```text
sharge config unset <base-url|timezone>
```

示例：

```sh
sharge config unset base-url
sharge config unset timezone
```

移除 settings 字段后，使用环境变量或默认值。实际 base URL 变化时执行同样的凭证交换/缓存规则。

## `sharge logs path`

输出当前日志绝对路径：

```sh
sharge logs path
sharge logs path --json
```

无需登录、无需网络。

JSON `data`：

```json
{
  "filePath": "/Users/user/.sharge/sharge.log"
}
```

## `sharge logs clear`

清除当前与轮转日志：

```sh
sharge logs clear --yes
sharge logs clear --yes --json
```

缺少 `--yes` 时本地失败。

JSON `data`：

```json
{
  "cleared": true,
  "removedFiles": 5
}
```

命令不会删除 settings。
