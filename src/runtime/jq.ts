import { type ProgAst, parse as parseJq } from "@jq-tools/jq";
import { builtinJqFilters } from "@jq-tools/jq/src/lib/evaluate/filters/builtinJqFilters.js";
import { builtinNativeFilters } from "@jq-tools/jq/src/lib/evaluate/filters/builtinNativeFilters.js";

const BUILTIN_FILTERS = new Set([
  ...Object.keys(builtinJqFilters),
  ...Object.keys(builtinNativeFilters),
]);
const SUPPORTED_FORMATS = new Set(["@base64", "@base64d"]);

function validateNode(
  value: unknown,
  definedFilters: ReadonlySet<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      validateNode(item, definedFilters);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }

  const node = value as Record<string, unknown>;
  if (node.type === "def" && typeof node.name === "string") {
    const nestedFilters = new Set(definedFilters);
    nestedFilters.add(node.name);
    validateNode(node.body, nestedFilters);
    validateNode(node.next, nestedFilters);
    return;
  }
  if (
    node.type === "filter" &&
    typeof node.name === "string" &&
    !definedFilters.has(node.name) &&
    !BUILTIN_FILTERS.has(node.name)
  ) {
    throw new Error(`jq filter is not supported: ${node.name}`);
  }
  if (
    node.type === "format" &&
    typeof node.name === "string" &&
    !SUPPORTED_FORMATS.has(node.name)
  ) {
    throw new Error(`jq format is not supported: ${node.name}`);
  }

  for (const [key, child] of Object.entries(node)) {
    if (key !== "type") {
      validateNode(child, definedFilters);
    }
  }
}

export function compileJq(expression: string): ProgAst {
  const program = parseJq(expression);
  validateNode(program, new Set());
  return program;
}
