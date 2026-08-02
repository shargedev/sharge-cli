import { describe, expect, it } from "vitest";
import { scopeRequiredFailure } from "../src/runtime/scopes.js";

describe("scope recovery", () => {
  it("builds one complete canonical current-union-required login command", () => {
    const failure = scopeRequiredFailure(
      ["calendar:read", "quick_notes:read"],
      ["calendar:write"],
    );

    expect(failure.type).toBe("SCOPE_REQUIRED");
    expect(failure.exitCode).toBe(4);
    expect(failure.requiredScopes).toEqual(["calendar:write"]);
    expect(failure.nextAction).toEqual({
      description: "重新授权完整 scope 集合",
      command:
        "sharge login --scope quick_notes:read --scope calendar:read --scope calendar:write",
    });
  });

  it("reports only scopes that are actually missing", () => {
    const failure = scopeRequiredFailure(
      ["calendar:read", "quick_notes:read"],
      ["calendar:read", "calendar:write"],
    );

    expect(failure.requiredScopes).toEqual(["calendar:write"]);
    expect(failure.message).toBe("当前凭证缺少 scope：calendar:write");
    expect(failure.nextAction?.command).toBe(
      "sharge login --scope quick_notes:read --scope calendar:read --scope calendar:write",
    );
  });
});
