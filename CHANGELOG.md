# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [0.2.0] - 2026-08-02

### Added

- 面向 Agent 的分层 JSON help、稳定 envelope 与 `--jq` 过滤。
- Quick Note、Calendar、Recordings 和 Diary 命令。
- 浏览器授权、显式 scope、诊断、配置与本地脱敏日志。
- 写操作 dry run、破坏性确认、未知结果保护与安全文件下载。
- 五个可通过 `npx skills` 安装的仓库级 Agent Skills。

### Changed

- 默认服务地址统一为 `https://ai.shargetech.com`，仍可通过配置或环境变量覆盖。
- 仓库、文档和 npm 元数据迁移至 `shargedev/sharge-cli`。

### Security

- 凭据不会完整输出或进入持久日志。
- 下载重定向隔离 Authorization，并使用原子文件发布与 SHA-256 校验。

[0.2.0]: https://github.com/shargedev/sharge-cli/releases/tag/v0.2.0
