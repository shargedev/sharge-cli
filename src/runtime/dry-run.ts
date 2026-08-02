export type DryRunPlan = {
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  path: string;
  body: unknown;
  requiredScopes: string[];
  sideEffects: string[];
  retrySafe: boolean;
  unverified: string[];
};

export function createDryRunPlan(options: {
  method: DryRunPlan["method"];
  baseUrl: string;
  path: string;
  body: unknown;
  requiredScopes: readonly string[];
  sideEffects: string[];
  retrySafe: boolean;
  unverified: string[];
}): DryRunPlan {
  return {
    method: options.method,
    url: `${options.baseUrl}${options.path}`,
    path: options.path,
    body: options.body,
    requiredScopes: [...options.requiredScopes],
    sideEffects: options.sideEffects,
    retrySafe: options.retrySafe,
    unverified: options.unverified,
  };
}

export function renderDryRunPlanText(plan: DryRunPlan): string {
  return [
    `method: ${plan.method}`,
    `url: ${plan.url}`,
    `path: ${plan.path}`,
    `body: ${JSON.stringify(plan.body)}`,
    `requiredScopes: ${plan.requiredScopes.join(", ")}`,
    `sideEffects: ${plan.sideEffects.join(", ")}`,
    `retrySafe: ${String(plan.retrySafe)}`,
    `unverified: ${plan.unverified.join(", ")}`,
    "未发送网络请求。",
  ]
    .join("\n")
    .concat("\n");
}
