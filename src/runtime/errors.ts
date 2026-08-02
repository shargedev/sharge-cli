export type RecoveryAction = {
  description: string;
  command: string;
};

export const CLI_ERROR_TYPES = [
  "AUTH_REQUIRED",
  "AUTHORIZATION_DENIED",
  "AUTHORIZATION_CONSUMED",
  "AUTHORIZATION_EXPIRED",
  "AUTHORIZATION_SUPERSEDED",
  "CANCELLED",
  "CREDENTIAL_INVALID",
  "FILE_EXISTS",
  "FILE_IO_ERROR",
  "CONFLICT",
  "INTERNAL_ERROR",
  "INVALID_COMMAND",
  "INVALID_INPUT",
  "NETWORK_ERROR",
  "NOT_FOUND",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "SCOPE_REQUIRED",
  "SERVER_ERROR",
  "TIMEOUT",
] as const;

export type CliErrorType = (typeof CLI_ERROR_TYPES)[number];

export class CliFailure extends Error {
  readonly type: CliErrorType;
  readonly exitCode: number;
  readonly field?: string;
  readonly path?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly nextAction: RecoveryAction;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly httpStatus: number | null;
  readonly retryAfterMs: number | null;
  readonly requiredScopes?: string[];
  readonly outcome?: "unknown";

  constructor(options: {
    message: string;
    field?: string;
    path?: string;
    expected?: string;
    actual?: string;
    nextAction: RecoveryAction;
    type?: CliErrorType;
    exitCode?: number;
    retryable?: boolean;
    requestId?: string | null;
    httpStatus?: number | null;
    retryAfterMs?: number | null;
    requiredScopes?: string[];
    outcome?: "unknown";
  }) {
    super(options.message);
    this.name = "CliFailure";
    this.type = options.type ?? "INVALID_INPUT";
    this.exitCode = options.exitCode ?? 2;
    this.field = options.field;
    this.path = options.path;
    this.expected = options.expected;
    this.actual = options.actual;
    this.nextAction = options.nextAction;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId ?? null;
    this.httpStatus = options.httpStatus ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.requiredScopes = options.requiredScopes;
    this.outcome = options.outcome;
  }
}
