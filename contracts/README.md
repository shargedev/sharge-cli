# 固定 OpenAPI 契约

`openapi-v1.json` 从隔离的 `ai_glass` Agent Runtime public endpoint 导出，供 CLI 开发与 CI 校验 method、path、scope、请求和响应，运行时不下载 OpenAPI。

导出命令：

```sh
npm run contract:export -- \
  --url http://127.0.0.1:<runtime-web-port>/open-api/v1/openapi.json
```

契约来源是指定 Agent Runtime 暴露的 `/open-api/v1/openapi.json`。仓库只保留导出的固定契约、导出脚本和对应契约测试，不依赖贡献者机器上的固定目录。
