# Contributing

感谢你帮助改进 sharge CLI。

## 开始之前

- 先搜索现有 Issue，避免重复工作。
- 行为变更应先更新对应的 `docs/` 契约，再更新测试与实现。
- 不要提交 API Key、用户数据、`.env.*`、运行日志或本机绝对路径。
- 不要公开未发布的服务地址或内部测试环境信息。

## 本地开发

需要 Node.js 20 或更高版本。

```sh
npm ci
npm run lint
npm run typecheck
npm test
```

涉及契约、Skills 或发布包时，再运行：

```sh
npm run contract:test
npm run skills:validate
npm run build
npm pack --dry-run --json
```

## Pull Request

- 保持改动聚焦并说明用户可见影响。
- 为修复和新行为补充测试。
- 不提交测试中间结果、评估结果或验收产物。
- PR 只要求快速质量门禁；完整契约、打包和兼容性验证由 `main` 与 Release 工作流执行。
