# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [0.2.1] - 2026-08-03

### Added

- 新增延续 Sharge Web App 视觉语言的中文落地页与文档站。
- 新增 Agent Native 安装 Prompt，引导 Agent 从 README 安装 CLI 与仓库 Skills。
- 新增基于 GitHub Actions 的 GitHub Pages 构建、校验与部署流程。

### Changed

- 扩充 Notes 产品别名说明，并保持公开文档以用户任务为中心。

### Fixed

- 登录轮询期间不再输出进度噪声，避免污染 Agent 可解析的命令结果。

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

[0.2.1]: https://github.com/shargedev/sharge-cli/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/shargedev/sharge-cli/releases/tag/v0.2.0
