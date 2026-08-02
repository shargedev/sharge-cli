import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const urlIndex = process.argv.indexOf("--url");
const sourceUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : undefined;
if (!sourceUrl) {
  throw new Error(
    "用法：npm run contract:export -- --url <runtime-openapi-url>",
  );
}

const response = await fetch(sourceUrl);
if (!response.ok) {
  throw new Error(`OpenAPI 导出失败：HTTP ${response.status}`);
}
const schema = await response.json();
if (
  schema.openapi === undefined ||
  schema.paths?.["/auth/status"]?.get === undefined ||
  schema.paths?.["/auth/scopes"]?.get === undefined
) {
  throw new Error("响应不是预期的 Open Platform public OpenAPI");
}
const outputPath = resolve(repositoryRoot, "contracts", "openapi-v1.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
process.stdout.write(`${outputPath}\n`);
