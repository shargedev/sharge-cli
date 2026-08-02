import { CliFailure } from "./errors.js";

export const OPEN_PLATFORM_SCOPES = [
  "quick_notes:read",
  "quick_notes:write",
  "calendar:read",
  "calendar:write",
  "voicemaster:read",
  "ai_daily:read",
] as const;

export function canonicalScopes(scopes: Iterable<string>): string[] {
  const requested = new Set(scopes);
  const known = OPEN_PLATFORM_SCOPES.filter((scope) => requested.delete(scope));
  return [...known, ...[...requested].sort()];
}

export function scopeRequiredFailure(
  currentScopes: string[],
  requiredScopes: string[],
): CliFailure {
  const currentScopeSet = new Set(currentScopes);
  const normalizedRequired = canonicalScopes(requiredScopes).filter(
    (scope) => !currentScopeSet.has(scope),
  );
  const completeScopes = canonicalScopes([
    ...currentScopes,
    ...normalizedRequired,
  ]);
  return new CliFailure({
    type: "SCOPE_REQUIRED",
    exitCode: 4,
    message: `当前凭证缺少 scope：${normalizedRequired.join(", ")}`,
    requiredScopes: normalizedRequired,
    nextAction: {
      description: "重新授权完整 scope 集合",
      command: `sharge login ${completeScopes
        .map((scope) => `--scope ${scope}`)
        .join(" ")}`,
    },
  });
}
